"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { SendHorizontal } from "lucide-react";
import Button from "@/components/_ui/button";

type Msg = { de: "voce" | "htc"; texto: string; meta?: string; erro?: boolean };

type Evento =
  | { type: "run_start"; sessionId?: string }
  | { type: "agent_event"; event?: { type?: string; text?: string; name?: string } }
  | { type: "stdout" | "stderr"; line?: string }
  | { type: "error"; message?: string }
  | Record<string, unknown>;

export default function Chat({ alvos }: { alvos: string[] }) {
  const [msgs, setMsgs] = useState<Msg[]>([
    {
      de: "htc",
      texto:
        "Escolha o alvo, escreva a diretiva e envie. O turno roda no mesmo runtime do CLI (payload, doutrina e missao); o alvo abre ou reaproveita a missao.",
    },
  ]);
  const [texto, setTexto] = useState("");
  const [alvo, setAlvo] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [sessao, setSessao] = useState("");
  const fim = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!alvo && alvos.length) setAlvo(alvos[0]);
  }, [alvos, alvo]);

  useEffect(() => {
    fim.current?.scrollIntoView({ block: "end" });
  }, [msgs]);

  function aplicar(evento: Evento) {
    if (evento.type === "run_start") {
      const id = (evento as { sessionId?: string }).sessionId;
      if (id) setSessao(id);
      return;
    }
    if (evento.type === "agent_event") {
      const ev = (evento as { event?: { type?: string; text?: string; name?: string } }).event;
      if (!ev) return;
      if (ev.type === "text" && typeof ev.text === "string") {
        setMsgs((m) => {
          const copia = [...m];
          const ultimo = copia[copia.length - 1];
          if (ultimo?.de === "htc" && !ultimo.erro) {
            copia[copia.length - 1] = { ...ultimo, texto: ultimo.texto + ev.text };
          } else {
            copia.push({ de: "htc", texto: ev.text ?? "" });
          }
          return copia;
        });
      }
      if (ev.type === "tool" && ev.name) {
        setMsgs((m) => {
          const copia = [...m];
          const ultimo = copia[copia.length - 1];
          if (ultimo?.de === "htc") copia[copia.length - 1] = { ...ultimo, meta: `tool ${ev.name}` };
          return copia;
        });
      }
      return;
    }
    if (evento.type === "stderr" || evento.type === "stdout") {
      const linha = (evento as { line?: string }).line ?? "";
      if (/auto-continue|\[model\]|\[free\]/.test(linha)) {
        setMsgs((m) => {
          const copia = [...m];
          const ultimo = copia[copia.length - 1];
          if (ultimo?.de === "htc") copia[copia.length - 1] = { ...ultimo, meta: linha.slice(0, 120) };
          return copia;
        });
      }
      return;
    }
    if (evento.type === "error") {
      setMsgs((m) => [
        ...m,
        { de: "htc", texto: String((evento as { message?: string }).message ?? "erro"), erro: true },
      ]);
    }
  }

  async function enviar() {
    const t = texto.trim();
    if (!t || ocupado) return;
    setOcupado(true);
    setMsgs((m) => [...m, { de: "voce", texto: t, meta: alvo || undefined }, { de: "htc", texto: "" }]);
    setTexto("");
    try {
      const resp = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: t, alvo: alvo || undefined, sessao: sessao || undefined }),
      });
      if (!resp.ok || !resp.body) {
        setMsgs((m) => [...m, { de: "htc", texto: `falha no turno (${resp.status})`, erro: true }]);
        return;
      }
      const leitor = resp.body.getReader();
      const dec = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await leitor.read();
        if (done) break;
        buffer += dec.decode(value, { stream: true });
        const blocos = buffer.split("\n\n");
        buffer = blocos.pop() ?? "";
        for (const bloco of blocos) {
          const linha = bloco.split("\n").find((l) => l.startsWith("data: "));
          if (!linha) continue;
          try {
            aplicar(JSON.parse(linha.slice(6)) as Evento);
          } catch {
            // bloco parcial: o proximo fecha
          }
        }
      }
    } catch (erro) {
      setMsgs((m) => [...m, { de: "htc", texto: String(erro), erro: true }]);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col p-4">
      <div className="scroll-thin flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pb-4 [overscroll-behavior:contain]">
        {msgs.map((m, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 12, filter: "blur(4px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ duration: 0.3, ease: [0.2, 0, 0, 1] }}
            className={`max-w-[min(760px,88%)] rounded-lg border px-3 py-2 ${
              m.de === "voce" ? "bubble-user self-end" : "border-border bg-card"
            }`}
          >
            <div className="mb-1 flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
              {m.de}
              {m.meta && <span className="text-[9px] normal-case tracking-normal text-[color:var(--info)]">{m.meta}</span>}
            </div>
            <pre
              className={`m-0 font-mono text-[12px] leading-relaxed whitespace-pre-wrap break-words ${
                m.erro ? "text-[color:var(--danger)]" : ""
              }`}
            >
              {m.texto || (ocupado && i === msgs.length - 1 ? "..." : "")}
            </pre>
          </motion.div>
        ))}
        <div ref={fim} />
      </div>

      <div className="flex shrink-0 items-end gap-2 border-t border-border pt-3">
        <select
          value={alvo}
          onChange={(e) => setAlvo(e.target.value)}
          className="h-9 max-w-[230px] rounded-md border border-input bg-card px-2 font-mono text-[11px] outline-none transition-colors duration-150 focus:border-ring"
        >
          <option value="">sem alvo</option>
          {alvos.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) enviar();
          }}
          placeholder="diretiva para o agente... (Ctrl+Enter envia)"
          className="h-[64px] min-w-0 flex-1 resize-none rounded-lg border border-input bg-card px-3 py-2 font-mono text-[12px] outline-none transition-colors duration-150 focus:border-ring"
        />
        <Button variant="primary" size="lg" onClick={enviar} disabled={ocupado} className="h-[64px] px-4">
          <SendHorizontal className="size-3.5" />
          {ocupado ? "..." : "Enviar"}
        </Button>
      </div>
      {sessao ? (
        <div className="mt-2 font-mono text-[9px] text-muted-foreground">sessao {sessao}</div>
      ) : null}
    </div>
  );
}
