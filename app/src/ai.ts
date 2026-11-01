// IPC com claude --dangerously-skip-permissions via subprocess Bun
// Nenhuma API key necessária — reutiliza a sessão Claude Code ativa.

export interface ToolEntry {
  name:   string;
  args:   string;
  result: string;
  status: "done" | "error";
}

export interface Message {
  role:       "user" | "assistant" | "system";
  content:    string;
  thinking?:  string;
  streaming?: boolean;
  tools?:     ToolEntry[];
}

// ─── Eventos do stream — espelho completo do claude CLI ───────────────────
export type StreamEvent =
  | { kind: "init";        session_id: string; model: string; tools: string[] }
  | { kind: "thinking";    delta: string }
  | { kind: "text";        delta: string }
  | { kind: "tool_start";  name: string; tool_id: string }
  | { kind: "tool_input";  tool_id: string; partial: string }
  | { kind: "tool_result"; tool_id: string; content: string; is_error: boolean }
  | { kind: "usage";       input_tokens: number; cache_tokens: number; total_tokens: number; output_tokens: number; cost: number; duration_ms: number }
  | { kind: "error";       message: string };

export interface ModelEntry {
  id:      string;
  label:   string;
  group:   string;
  custom?: boolean;
}

export const MODELOS: ModelEntry[] = [
  { id: "claude-sonnet-4-6",         label: "Sonnet 4.6  (padrão)",        group: "Claude Code 4" },
  { id: "claude-opus-4-6",           label: "Opus 4.6",                    group: "Claude Code 4" },
  { id: "claude-sonnet-5",           label: "Sonnet 5  (mais capaz)",      group: "Claude 5"      },
  { id: "claude-opus-5",             label: "Opus 5  (máxima intel)",      group: "Claude 5"      },
  { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5  (rápido)",        group: "Claude 5"      },
  { id: "custom",                    label: "Personalizado  (digitar ID)", group: "Custom", custom: true },
];

function montar_prompt(messages: Message[]): string {
  const partes: string[] = [];
  for (const m of messages) {
    if (m.role === "system") continue;
    const role = m.role === "assistant" ? "ASSISTANT" : "USER";
    partes.push(`[${role}]\n${m.content}`);
  }
  return partes.join("\n\n");
}

// ─── Stream completo — emite TUDO que o claude CLI emite ──────────────────
export async function* stream_claude(
  messages: Message[],
  system = "",
  model  = "",
  signal?: AbortSignal,
): AsyncGenerator<StreamEvent> {
  const prompt = montar_prompt(messages);

  const cmd = [
    "claude",
    "--dangerously-skip-permissions",
    "--output-format", "stream-json",
    "--verbose",
    "--include-partial-messages",
  ];
  if (model)  cmd.push("--model", model);
  if (system) cmd.push("--append-system-prompt", system);
  cmd.push("-p", prompt);

  const proc = Bun.spawn({ cmd, stdout: "pipe", stderr: "ignore" });
  if (signal) {
    signal.addEventListener("abort", () => { proc.kill(); }, { once: true });
  }

  const reader  = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let buffer       = "";
  let texto_emitido  = 0;
  let think_emitido  = 0;

  const blocos: Record<number, { type: string; name?: string; tool_id?: string }> = {};

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const linhas = buffer.split("\n");
    buffer = linhas.pop() ?? "";

    for (const linha of linhas) {
      if (!linha.trim()) continue;
      let ev: Record<string, unknown>;
      try { ev = JSON.parse(linha); } catch { continue; }

      const tipo_ev = ev["type"] as string | undefined;

      // ── Sistema: init ────────────────────────────────────────────────
      if (tipo_ev === "system") {
        const sub = ev["subtype"] as string;
        if (sub === "init") {
          const tools = ((ev["tools"] as unknown[]) ?? [])
            .map(t => (t as Record<string, unknown>)["name"] as string ?? "?");
          yield {
            kind:       "init",
            session_id: (ev["session_id"] as string) ?? "",
            model:      (ev["model"] as string) ?? model,
            tools,
          };
        }
        continue;
      }

      // ── Início de bloco de conteúdo ───────────────────────────────────
      if (tipo_ev === "content_block_start") {
        const idx   = ev["index"] as number;
        const bloco_raw = ev["content_block"] as Record<string, unknown>;
        blocos[idx] = {
          type:    (bloco_raw["type"] as string) ?? "unknown",
          name:    bloco_raw["name"] as string | undefined,
          tool_id: bloco_raw["id"]  as string | undefined,
        };
        if (bloco_raw["type"] === "tool_use") {
          yield {
            kind:    "tool_start",
            name:    (bloco_raw["name"] as string) ?? "?",
            tool_id: (bloco_raw["id"]  as string) ?? "",
          };
        }
        continue;
      }

      // ── Delta de bloco ────────────────────────────────────────────────
      if (tipo_ev === "content_block_delta") {
        const idx   = ev["index"] as number;
        const delta = ev["delta"] as Record<string, unknown> | undefined;
        const bloco = blocos[idx];

        if (!bloco || !delta) continue;

        if (bloco.type === "thinking" && delta["type"] === "thinking_delta") {
          const txt = (delta["thinking"] as string) ?? "";
          if (txt) { yield { kind: "thinking", delta: txt }; think_emitido += txt.length; }

        } else if (bloco.type === "text" && delta["type"] === "text_delta") {
          const txt = (delta["text"] as string) ?? "";
          if (txt) { yield { kind: "text", delta: txt }; texto_emitido += txt.length; }

        } else if (bloco.type === "tool_use" && delta["type"] === "input_json_delta") {
          const partial = (delta["partial_json"] as string) ?? "";
          if (partial) yield { kind: "tool_input", tool_id: bloco.tool_id ?? "", partial };
        }
        continue;
      }

      // ── Resultado de tool (quando o CLI executa e retorna) ─────────────
      if (tipo_ev === "tool_result") {
        const content      = ev["content"] as unknown;
        const is_error     = !!(ev["is_error"] as boolean | undefined);
        const tool_use_id  = (ev["tool_use_id"] as string) ?? "";
        const txt = Array.isArray(content)
          ? content.map((b: unknown) => {
              const bl = b as Record<string, unknown>;
              return bl["type"] === "text" ? (bl["text"] as string ?? "") : "[bin]";
            }).join("\n")
          : typeof content === "string"
          ? content
          : JSON.stringify(content ?? "");
        yield { kind: "tool_result", tool_id: tool_use_id, content: txt, is_error };
        continue;
      }

      // ── Mensagem completa (fallback delta) ────────────────────────────
      if (tipo_ev === "assistant") {
        const msg     = ev["message"] as Record<string, unknown> | undefined;
        const content = (msg?.["content"] as unknown[]) ?? [];
        for (const b of content) {
          const bloco = b as Record<string, unknown>;
          if (bloco["type"] === "thinking" && typeof bloco["thinking"] === "string") {
            const txt = bloco["thinking"] as string;
            if (txt.length > think_emitido) {
              yield { kind: "thinking", delta: txt.slice(think_emitido) };
              think_emitido = txt.length;
            }
          } else if (bloco["type"] === "text" && typeof bloco["text"] === "string") {
            const txt = bloco["text"] as string;
            if (txt.length > texto_emitido) {
              yield { kind: "text", delta: txt.slice(texto_emitido) };
              texto_emitido = txt.length;
            }
          }
        }
        continue;
      }

      // ── Resultado final com usage + cost ─────────────────────────────
      if (tipo_ev === "result") {
        if (texto_emitido === 0 && typeof ev["result"] === "string") {
          yield { kind: "text", delta: ev["result"] as string };
        }
        const usage     = ev["usage"] as Record<string, number> | undefined;
        const input     = usage?.["input_tokens"]                ?? 0;
        const cache_write = usage?.["cache_creation_input_tokens"] ?? 0;
        const cache_read  = usage?.["cache_read_input_tokens"]     ?? 0;
        yield {
          kind:          "usage",
          input_tokens:  input,
          cache_tokens:  cache_write + cache_read,
          total_tokens:  input + cache_write + cache_read,
          output_tokens: usage?.["output_tokens"] ?? 0,
          cost:          (ev["total_cost"] as number) ?? 0,
          duration_ms:   (ev["duration_ms"]  as number) ?? 0,
        };
        continue;
      }
    }
  }

  await proc.exited;
}
