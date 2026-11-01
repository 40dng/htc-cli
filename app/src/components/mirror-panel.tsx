import React from "react";
import { paleta } from "../paleta.js";
import type { StreamEvent } from "../ai.js";

// ─── Tipos de linha — espelho do CLI do claude ────────────────────────────────
export type DisplayLine =
  | { kind: "session";   text: string }
  | { kind: "thinking";  chars: number; preview: string }
  | { kind: "tool";      tool: string; args: string; status: "running" | "done" | "error"; result: string; extraLines?: string[] }
  | { kind: "text_snap"; preview: string }
  | { kind: "usage";     text: string; ctx_pct: number }
  | { kind: "app";       icon: string; label: string; detail: string };

export interface MirrorState {
  lines:       DisplayLine[];
  pending:     Record<string, string>;  // tool_id → partial JSON acumulado
  names:       Record<string, string>;  // tool_id → nome da ferramenta
  lineOf:      Record<string, number>;  // tool_id → índice na array lines
  thinkChars:  number;
  thinkPrev:   string;
  hasText:     boolean;                 // já emitiu text_snap?
}

export const MIRROR_INIT: MirrorState = {
  lines: [], pending: {}, names: {}, lineOf: {},
  thinkChars: 0, thinkPrev: "", hasText: false,
};

// ─── Helpers de formatação ────────────────────────────────────────────────────

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function shortPath(s: string, max = 45): string {
  const base = s.split(/[/\\]/).pop() ?? s;
  if (s.length <= max) return s;
  const parts = s.split(/[/\\]/);
  if (parts.length >= 2) return `…/${parts.slice(-2).join("/")}`;
  return base.length > max ? "…" + base.slice(-(max - 1)) : base;
}

function trunc(s: string, n: number): string {
  const clean = s.replace(/\n/g, " ").trim();
  return clean.length > n ? clean.slice(0, n - 1) + "…" : clean;
}

function extractField(json: string, key: string): string | undefined {
  const re = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)`);
  const m  = json.match(re);
  return m?.[1];
}

// Ícone por tipo de ferramenta
function toolIcon(name: string): string {
  switch (name) {
    case "Bash":
    case "PowerShell":   return "$";
    case "Read":         return "≡";
    case "Edit":
    case "MultiEdit":    return "✎";
    case "Write":        return "✍";
    case "Glob":         return "⊡";
    case "Grep":         return "⊃";
    case "Agent":
    case "Task":
    case "TaskCreate":   return "◈";
    case "WebSearch":    return "⊕";
    case "WebFetch":     return "⊗";
    case "NotebookEdit": return "⊞";
    case "SendMessage":  return "↗";
    default:             return "◎";
  }
}

function fmtToolArgs(name: string, json: string, parsed?: Record<string, unknown>): string {
  const get = (k: string) => parsed?.[k] as string | undefined ?? extractField(json, k);
  switch (name) {
    case "Read":
    case "Edit":
    case "MultiEdit":
    case "Write":
    case "NotebookEdit": {
      const p = get("file_path") ?? get("notebook_path") ?? "";
      return p ? shortPath(p) : "…";
    }
    case "Bash":
    case "PowerShell": {
      const cmd = get("command") ?? "";
      return cmd ? trunc(cmd, 55) : "…";
    }
    case "Glob": return get("pattern") ?? "…";
    case "Grep": return `"${get("pattern") ?? "…"}"`;
    case "Agent":
    case "Task":
    case "TaskCreate":
    case "SendMessage": {
      const t = get("task") ?? get("description") ?? get("prompt") ?? get("message") ?? "";
      return t ? trunc(t, 50) : "…";
    }
    case "WebSearch":
    case "WebFetch": return get("query") ?? get("url") ?? "…";
    default: {
      if (parsed) {
        const first = Object.values(parsed)[0];
        return first ? trunc(String(first), 50) : name;
      }
      const m = json.match(/"[^"]+"\s*:\s*"([^"]{3,})"/);
      return m?.[1]?.slice(0, 50) ?? "…";
    }
  }
}

// Retorna linha principal + linhas extras de preview
function fmtToolResult(
  name: string,
  parsed: Record<string, unknown>,
  result: string,
  is_error: boolean,
): { main: string; extra: string[] } {
  if (is_error) {
    const first = result.split("\n").find(l => l.trim()) ?? result;
    return { main: `⎿  ${trunc(first, 60)}`, extra: [] };
  }
  switch (name) {
    case "Read":
    case "NotebookEdit": {
      const n  = result.split("\n").length;
      const fp = shortPath((parsed["file_path"] ?? parsed["notebook_path"] ?? "") as string, 30);
      return { main: `⎿  ${n} linha${n === 1 ? "" : "s"}${fp ? ` · ${fp}` : ""}`, extra: [] };
    }
    case "Edit":
    case "MultiEdit": {
      const fp = shortPath((parsed["file_path"] ?? "") as string, 35);
      return { main: `⎿  Updated ${fp || "arquivo"}`, extra: [] };
    }
    case "Write": {
      const bytes = result.length;
      const fp    = shortPath((parsed["file_path"] ?? "") as string, 30);
      return { main: `⎿  Wrote ${bytes} bytes${fp ? ` · ${fp}` : ""}`, extra: [] };
    }
    case "Bash":
    case "PowerShell": {
      const lines = result.split("\n").filter(l => l.trim());
      const main  = `⎿  ${lines[0] ? trunc(lines[0], 55) : "Exit 0"}`;
      const extra = lines.slice(1, 3).map(l => `   ${trunc(l, 55)}`);
      return { main, extra };
    }
    case "Glob": {
      const files = result.split("\n").filter(Boolean);
      const extra = files.slice(0, 2).map(f => `   ${shortPath(f, 45)}`);
      return { main: `⎿  ${files.length} arquivo${files.length === 1 ? "" : "s"}`, extra };
    }
    case "Grep": {
      const allLines = result.split("\n").filter(Boolean);
      const extra    = allLines.slice(0, 2).map(l => `   ${trunc(l, 55)}`);
      return { main: `⎿  ${allLines.length} match${allLines.length === 1 ? "" : "es"}`, extra };
    }
    case "WebSearch":
    case "WebFetch": {
      const lines = result.split("\n").filter(Boolean);
      const extra = lines.slice(1, 2).map(l => `   ${trunc(l, 55)}`);
      return { main: `⎿  ${trunc(lines[0] ?? "", 55)}`, extra };
    }
    case "Agent":
    case "Task":
    case "TaskCreate":
      return { main: `⎿  Done`, extra: [] };
    default: {
      const first = result.split("\n").find(l => l.trim()) ?? "";
      return { main: `⎿  ${trunc(first || result.slice(0, 60), 60)}`, extra: [] };
    }
  }
}

type AppEvent =
  | { kind: "code";   label: string; detail: string }
  | { kind: "result"; label: string };

// ─── Atualizador principal ────────────────────────────────────────────────────
export function updateMirror(
  ev: StreamEvent | AppEvent,
  s: MirrorState,
): MirrorState {
  const push = (...items: DisplayLine[]): DisplayLine[] =>
    [...s.lines, ...items].slice(-300);

  switch (ev.kind) {
    case "init": {
      const modelName = ev.model.split("-").slice(-2).join("-");
      return {
        ...s,
        lines: push({ kind: "session", text: `${modelName} · ${ev.tools.length} tools` }),
        thinkChars: 0, thinkPrev: "", hasText: false,
      };
    }

    case "thinking": {
      const chars = s.thinkChars + ev.delta.length;
      const prev  = s.thinkPrev || ev.delta.slice(0, 80).replace(/\n/g, " ");
      const line: DisplayLine = { kind: "thinking", chars, preview: prev };
      const lines = [...s.lines];
      const last  = lines[lines.length - 1];
      if (last?.kind === "thinking") {
        lines[lines.length - 1] = line;
      } else {
        lines.push(line);
      }
      return { ...s, lines: lines.slice(-300), thinkChars: chars, thinkPrev: prev };
    }

    case "text": {
      if (s.hasText) return s;
      const preview = trunc(ev.delta.replace(/\n/g, " "), 60);
      if (!preview) return s;
      return { ...s, lines: push({ kind: "text_snap", preview }), hasText: true };
    }

    case "tool_start": {
      const lines = [...s.lines];
      const idx   = lines.length;
      lines.push({ kind: "tool", tool: ev.name, args: "…", status: "running", result: "" });
      return {
        ...s,
        lines: lines.slice(-300),
        names:   { ...s.names,   [ev.tool_id]: ev.name },
        lineOf:  { ...s.lineOf,  [ev.tool_id]: idx },
        pending: { ...s.pending, [ev.tool_id]: "" },
      };
    }

    case "tool_input": {
      const accum = (s.pending[ev.tool_id] ?? "") + ev.partial;
      const name  = s.names[ev.tool_id] ?? "?";
      const args  = fmtToolArgs(name, accum);
      const lines = [...s.lines];
      const idx   = s.lineOf[ev.tool_id];
      if (idx !== undefined) {
        const cur = lines[idx];
        if (cur?.kind === "tool") lines[idx] = { ...cur, args };
      }
      return { ...s, lines, pending: { ...s.pending, [ev.tool_id]: accum } };
    }

    case "tool_result": {
      const name = s.names[ev.tool_id] ?? "?";
      let parsed: Record<string, unknown> = {};
      try { parsed = JSON.parse(s.pending[ev.tool_id] ?? "{}"); } catch {}
      const args = fmtToolArgs(name, s.pending[ev.tool_id] ?? "", parsed);
      const { main: result, extra: extraLines } = fmtToolResult(name, parsed, ev.content, ev.is_error);
      const lines = [...s.lines];
      const idx   = s.lineOf[ev.tool_id];
      if (idx !== undefined) {
        lines[idx] = {
          kind: "tool", tool: name, args,
          status: ev.is_error ? "error" : "done",
          result, extraLines,
        };
      }
      const pending = { ...s.pending };
      delete pending[ev.tool_id];
      return { ...s, lines: lines.slice(-300), pending };
    }

    case "usage": {
      const ctx_pct = Math.min(99, Math.round(ev.total_tokens / 2000));
      const cost    = ev.cost > 0         ? ` $${ev.cost.toFixed(4)}`                   : "";
      const cache   = ev.cache_tokens > 0 ? ` cache:${fmtNum(ev.cache_tokens)}`         : "";
      const ms      = ev.duration_ms > 0  ? ` ${(ev.duration_ms / 1000).toFixed(1)}s`   : "";
      const text    = `in:${fmtNum(ev.input_tokens)}${cache} out:${fmtNum(ev.output_tokens)}${cost}${ms}`;
      return { ...s, lines: push({ kind: "usage", text, ctx_pct }) };
    }

    case "error": {
      return { ...s, lines: push({ kind: "app", icon: "⚠", label: "error", detail: trunc(ev.message, 55) }) };
    }

    case "code": {
      return { ...s, lines: push({ kind: "app", icon: "⚙", label: ev.label, detail: trunc(ev.detail, 40) }) };
    }
    case "result": {
      return { ...s, lines: push({ kind: "app", icon: "✓", label: ev.label, detail: "" }) };
    }
  }
  return s;
}

// ─── Componente visual ────────────────────────────────────────────────────────

interface MirrorPanelProps {
  state:     MirrorState;
  streaming: boolean;
  width:     number;
  maxLines?: number;
}

function ctxBar(pct: number, w = 8): string {
  const f = Math.round((pct / 100) * w);
  return "█".repeat(f) + "░".repeat(w - f);
}

export function MirrorPanel({ state, streaming, width, maxLines = 7 }: MirrorPanelProps) {
  const { lines } = state;
  if (lines.length === 0 && !streaming) return null;

  const visible  = lines.slice(-maxLines);
  const totalStr = lines.length.toString();

  const lastUsage = [...lines].reverse().find(l => l.kind === "usage") as
    Extract<DisplayLine, { kind: "usage" }> | undefined;

  return (
    <box
      flexDirection="column"
      borderStyle="single"
      borderColor="#2a2a3a"
      paddingX={1}
      flexShrink={0}
    >
      {/* ── Cabeçalho ────────────────────────────────────────────── */}
      <box flexDirection="row">
        <text fg="#6666aa"><strong>mirror</strong></text>
        {streaming && <text fg={paleta.act}>{"  ⣷ live"}</text>}
        <box flexGrow={1} />
        {lastUsage && (
          <text fg="#5566aa">{`ctx:${ctxBar(lastUsage.ctx_pct)} ${lastUsage.ctx_pct}%  `}</text>
        )}
        <text fg="#444466">{totalStr} linhas</text>
      </box>

      {/* ── Linhas ────────────────────────────────────────────────── */}
      {visible.map((line, i) => renderLine(line, i))}

      {streaming && lines.length === 0 && (
        <text fg="#445566">{"  aguardando claude…"}</text>
      )}
    </box>
  );
}

function renderLine(line: DisplayLine, key: number): React.ReactNode {
  switch (line.kind) {

    case "session":
      return (
        <box key={key} flexDirection="row">
          <text fg="#4466aa">{"  ▶ "}</text>
          <text fg="#5577bb">{line.text}</text>
        </box>
      );

    case "thinking": {
      const kStr  = line.chars >= 1000 ? `${(line.chars / 1000).toFixed(1)}k` : String(line.chars);
      const short = line.preview.slice(0, 45);
      return (
        <box key={key} flexDirection="row">
          <text fg="#5566aa">{"  ○ "}</text>
          <text fg="#7788cc">{"Thinking… "}</text>
          <text fg="#556699">{`(${kStr}) `}</text>
          <text fg="#445588">{`"${short}"`}</text>
        </box>
      );
    }

    case "tool": {
      const { tool, args, status, result, extraLines } = line;
      const runIcon = toolIcon(tool);
      const icon    = status === "running" ? runIcon : status === "done" ? "✓" : "✗";
      const iconC   = status === "running" ? paleta.act : status === "done" ? "#00cc60" : "#ff5555";
      return (
        <box key={key} flexDirection="column">
          <box flexDirection="row">
            <text fg="#2a2a44">{"  "}</text>
            <text fg={iconC}><strong>{`${icon} `}</strong></text>
            <text fg="#44bb88"><strong>{tool}</strong></text>
            <text fg="#667788">{`(${args})`}</text>
          </box>
          {result && (
            <box flexDirection="row">
              <text fg="#2a2a44">{"     "}</text>
              <text fg={status === "error" ? "#ff8866" : "#7799bb"}>{result}</text>
            </box>
          )}
          {extraLines?.map((el, ei) => (
            <box key={ei} flexDirection="row">
              <text fg="#2a2a44">{"     "}</text>
              <text fg="#556677">{el}</text>
            </box>
          ))}
        </box>
      );
    }

    case "text_snap":
      return (
        <box key={key} flexDirection="row">
          <text fg="#446644">{"  ◦ "}</text>
          <text fg="#557755">{`"${line.preview}"`}</text>
        </box>
      );

    case "usage": {
      const { text, ctx_pct } = line;
      const bar = ctxBar(ctx_pct);
      return (
        <box key={key} flexDirection="row">
          <text fg="#334455">{"  ─ "}</text>
          <text fg="#667788">{text}</text>
          <text fg="#334455">{"  ctx:"}</text>
          <text fg={ctx_pct > 80 ? "#cc6633" : "#4477aa"}>{bar}</text>
          <text fg="#667788">{` ${ctx_pct}%`}</text>
        </box>
      );
    }

    case "app": {
      const { icon, label, detail } = line;
      return (
        <box key={key} flexDirection="row">
          <text fg="#333344">{"  "}</text>
          <text fg={icon === "✓" ? "#44aa66" : icon === "⚠" ? "#cc8833" : "#667744"}>{`${icon} `}</text>
          <text fg="#778866">{label}</text>
          {detail ? <text fg="#556655">{`  ${detail}`}</text> : null}
        </box>
      );
    }
  }
}
