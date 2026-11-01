import React, { useEffect, useState } from "react";
import "opentui-spinner/react";
import { useTerminalDimensions } from "@opentui/react";
import type { Message, ToolEntry } from "../ai.js";

// Cores do tema dark do claude-code (hex — OpenTUI não suporta rgb())
const C = {
  orange:     "#d77757",  // claude brand rgb(215,119,87)
  text:       "#ffffff",  // branco
  inactive:   "#999999",  // cinza médio rgb(153,153,153)
  subtle:     "#505050",  // cinza escuro rgb(80,80,80)
  success:    "#4eba65",  // verde rgb(78,186,101)
  error:      "#ff6b80",  // vermelho rgb(255,107,128)
  suggestion: "#b1b9f9",  // azul-roxo claro rgb(177,185,249)
  userBg:     "#373737",  // fundo user msg rgb(55,55,55)
} as const;

const LOADING_MSGS = [
  "Pensando…",
  "Analisando…",
  "Processando…",
  "Consultando…",
  "Calculando…",
  "Verificando…",
  "Construindo resposta…",
  "Um momento…",
];

// ─── Word-wrap manual (OpenTUI não quebra texto automaticamente) ──────────────
function wrapText(text: string, maxW: number): string[] {
  if (!text) return [" "];
  if (text.length <= maxW) return [text];
  const words  = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const word of words) {
    if (!word) continue;
    if (cur.length + word.length + (cur ? 1 : 0) <= maxW) {
      cur = cur ? `${cur} ${word}` : word;
    } else {
      if (cur) lines.push(cur);
      if (word.length > maxW) {
        for (let i = 0; i < word.length; i += maxW) lines.push(word.slice(i, i + maxW));
        cur = "";
      } else {
        cur = word;
      }
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [" "];
}

// ─── Inline markdown parser ───────────────────────────────────────────────────
type Seg = { text: string; fg?: string; bold?: boolean };

function parseInline(raw: string): Seg[] {
  const segs: Seg[] = [];
  let i = 0; let cur = "";

  while (i < raw.length) {
    // blockquote prefix
    if (i === 0 && raw.startsWith("> ")) {
      cur += "  › "; i += 2; continue;
    }
    // inline code: `code`
    if (raw[i] === "`") {
      const end = raw.indexOf("`", i + 1);
      if (end > i) {
        if (cur) { segs.push({ text: cur }); cur = ""; }
        segs.push({ text: raw.slice(i + 1, end), fg: C.success });
        i = end + 1;
        continue;
      }
      // unmatched backtick — treat as literal
    }
    // bold: **text** or __text__
    const isBoldStar = raw[i] === "*" && raw[i + 1] === "*";
    const isBoldUnd  = raw[i] === "_" && raw[i + 1] === "_";
    if (isBoldStar || isBoldUnd) {
      const delim = isBoldStar ? "**" : "__";
      if (cur) { segs.push({ text: cur }); cur = ""; }
      const end = raw.indexOf(delim, i + 2);
      if (end > i) { segs.push({ text: raw.slice(i + 2, end), bold: true }); i = end + 2; continue; }
    }
    // italic: *text* (single, not part of **)
    if (raw[i] === "*" && raw[i + 1] !== "*" && (i === 0 || raw[i - 1] !== "*")) {
      if (cur) { segs.push({ text: cur }); cur = ""; }
      const end = raw.indexOf("*", i + 1);
      if (end > i && raw[end + 1] !== "*") {
        segs.push({ text: raw.slice(i + 1, end), fg: C.inactive }); i = end + 1; continue;
      }
    }
    // link: [text](url) → show text in suggestion color
    if (raw[i] === "[") {
      const closeBracket = raw.indexOf("]", i + 1);
      if (closeBracket > i && raw[closeBracket + 1] === "(") {
        const closeParen = raw.indexOf(")", closeBracket + 1);
        if (closeParen > closeBracket) {
          if (cur) { segs.push({ text: cur }); cur = ""; }
          segs.push({ text: raw.slice(i + 1, closeBracket), fg: C.suggestion });
          i = closeParen + 1; continue;
        }
      }
    }
    cur += raw[i]; i++;
  }
  if (cur) segs.push({ text: cur });
  return segs.length ? segs : [{ text: raw }];
}

// Word-wrap preserving segment boundaries
function wrapSegs(segs: Seg[], maxW: number): Seg[][] {
  if (maxW <= 0) maxW = 40;
  // Expand segments into per-char records
  const chars: Array<{ ch: string; si: number }> = [];
  segs.forEach((s, si) => { for (const ch of s.text) chars.push({ ch, si }); });

  const lines: Seg[][] = [];
  let pos = 0;

  while (pos < chars.length) {
    let end = Math.min(pos + maxW, chars.length);
    // Back up to last space (word-wrap)
    if (end < chars.length) {
      let sp = end;
      while (sp > pos && chars[sp]?.ch !== " ") sp--;
      if (sp > pos) end = sp;
    }
    // Build segments for this sub-line
    const lineSegs: Seg[] = [];
    let cur: Seg | null = null;
    for (let ci = pos; ci < end; ci++) {
      const { ch, si } = chars[ci]!;
      const src = segs[si]!;
      if (cur && cur.fg === src.fg && cur.bold === src.bold) {
        cur.text += ch;
      } else {
        if (cur) lineSegs.push(cur);
        cur = { text: ch, fg: src.fg, bold: src.bold };
      }
    }
    if (cur) lineSegs.push(cur);
    lines.push(lineSegs.length ? lineSegs : [{ text: " " }]);
    pos = end;
    while (pos < chars.length && chars[pos]?.ch === " ") pos++;
  }

  return lines.length ? lines : [[{ text: " " }]];
}

// Render one set of segments as a single <text> element
function segsToNode(
  segs: Seg[], key: number, cursor = false
): React.ReactNode {
  return (
    <text key={key} selectable>
      {segs.map((s, i) => {
        if (s.bold && s.fg) return <span key={i} fg={s.fg}><strong>{s.text}</strong></span>;
        if (s.bold) return <span key={i} fg="#ffffff"><strong>{s.text}</strong></span>;
        if (s.fg)   return <span key={i} fg={s.fg}>{s.text}</span>;
        return <span key={i} fg={C.text}>{s.text}</span>;
      })}
      {cursor && <span fg={C.orange}>▍</span>}
    </text>
  );
}

// Strip for table/header contexts where we still need plain text width
function stripInline(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g,     "$1")
    .replace(/\*(.+?)\*/g,     "$1")
    .replace(/`(.+?)`/g,       "$1")
    .replace(/\[(.+?)\]\(.+?\)/g, "$1")
    .replace(/^>\s*/,          "  › ");
}

// Parseia células de uma linha de tabela markdown `| a | b | c |`
function parseCells(line: string): string[] {
  return line.split("|").slice(1, -1).map(c => c.trim()).filter(Boolean);
}

function isSeparatorRow(line: string): boolean {
  return /^\|[-:| ]+\|$/.test(line.trim());
}

function isTableRow(line: string): boolean {
  const t = line.trim();
  return t.startsWith("|") && t.endsWith("|") && t.includes("|", 1);
}

// ─── Cada função de render retorna React.ReactNode[] ───────────────────────

function renderHeader(line: string, base: number): React.ReactNode[] {
  const lvl  = (line.match(/^(#{1,3})\s/) ?? [])[1]?.length ?? 1;
  const text  = line.replace(/^#{1,3}\s*/, "").replace(/\*\*/g, "");
  const fg    = lvl <= 2 ? C.orange : C.suggestion;
  return [<text key={base} fg={fg}><strong>{text}</strong></text>];
}

function renderSep(base: number): React.ReactNode[] {
  return [<text key={base} fg={C.subtle}>{"  " + "─".repeat(50)}</text>];
}

function renderBullet(line: string, base: number, maxW: number): React.ReactNode[] {
  const content = line.replace(/^[-*+]\s+/, "");
  const segs: Seg[] = [{ text: "  • " }, ...parseInline(content)];
  return wrapSegs(segs, maxW).map((ls, i) => segsToNode(ls, base + i));
}

function renderNumbered(line: string, base: number, maxW: number): React.ReactNode[] {
  const num  = (line.match(/^(\d+)\.\s/) ?? [])[1] ?? "1";
  const content = line.replace(/^\d+\.\s+/, "");
  const segs: Seg[] = [{ text: `  ${num}. ` }, ...parseInline(content)];
  return wrapSegs(segs, maxW).map((ls, i) => segsToNode(ls, base + i));
}

function renderCodeLine(line: string, base: number): React.ReactNode[] {
  return [<text key={base} fg={C.success}>{"  "}{line}</text>];
}

function renderTableRow(line: string, base: number, maxW: number): React.ReactNode[] {
  const cells = parseCells(line);
  if (cells.length === 0) return [];

  if (cells.length === 1) {
    return wrapText("  " + stripInline(cells[0]!), maxW).map((l, i) =>
      <text key={base + i} fg={C.text}>{l}</text>
    );
  }

  if (cells.length === 2) {
    const key   = cells[0]!;
    const val   = stripInline(cells[1]!);
    const valW  = Math.max(20, maxW - key.length - 6);
    const lines = wrapText(val, valW);
    const result: React.ReactNode[] = [];
    result.push(
      <box key={base} flexDirection="row">
        <text fg={C.suggestion}>{`  ${key}`}</text>
        <text fg={C.subtle}>{" › "}</text>
        <text fg={C.text}>{lines[0] ?? ""}</text>
      </box>
    );
    lines.slice(1).forEach((l, i) => {
      result.push(
        <text key={base + 1 + i} fg={C.text}>{" ".repeat(key.length + 5)}{l}</text>
      );
    });
    return result;
  }

  const perCell = Math.max(5, Math.floor((maxW - 4) / cells.length) - 3);
  const row = cells.map(c => stripInline(c).slice(0, perCell).padEnd(perCell)).join(" │ ");
  return [<text key={base} fg={C.inactive}>{"  "}{row}</text>];
}

function renderNormal(line: string, base: number, maxW: number, cursor = false): React.ReactNode[] {
  if (!line.trim()) return [<text key={base} fg={C.text}>{" "}</text>];
  const segs  = parseInline(line);
  const lines = wrapSegs(segs, maxW);
  return lines.map((ls, i) => segsToNode(ls, base + i, cursor && i === lines.length - 1));
}

// ─── Processador de linha — base deve ser único por linha (lineIdx * 200) ─────
function processLine(
  line:      string,
  base:      number,  // multiplicador único por linha
  maxW:      number,
  isLast:    boolean,
  streaming: boolean,
  inCode:    boolean,
): React.ReactNode[] {
  if (inCode) return renderCodeLine(line, base);

  if (/^#{1,3}\s/.test(line))        return renderHeader(line, base);
  if (isSeparatorRow(line))           return renderSep(base);
  if (isTableRow(line))               return renderTableRow(line, base, maxW);
  if (/^[-*+]\s/.test(line))          return renderBullet(line, base, maxW);
  if (/^\d+\.\s/.test(line))          return renderNumbered(line, base, maxW);
  if (/^[-=]{3,}$/.test(line.trim())) return renderSep(base);

  return renderNormal(line, base, maxW, isLast && streaming);
}

// ─── Componentes ─────────────────────────────────────────────────────────────

function useRotatingMsg(): string {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setIdx(i => (i + 1) % LOADING_MSGS.length), 2000);
    return () => clearInterval(t);
  }, []);
  return LOADING_MSGS[idx]!;
}

function UserBubble({ content }: { content: string }) {
  const lines = content.split("\n");
  return (
    <box flexDirection="column" width="100%" paddingX={1} paddingY={0} backgroundColor={C.userBg} marginBottom={1}>
      {lines.map((line, i) => (
        <text key={i} fg={C.text} selectable>
          {i === 0
            ? <><span fg={C.orange}>❯ </span>{line}</>
            : <span>{"  "}{line || " "}</span>}
        </text>
      ))}
    </box>
  );
}

function ThinkingBubble({ text }: { text: string }) {
  const lines = text.split("\n").filter(Boolean).slice(-2);
  if (lines.length === 0) return null;
  return (
    <box flexDirection="column" marginBottom={0} paddingX={2}>
      <text fg={C.subtle}>{"○ "}<span fg={C.inactive}>{"pensando…"}</span></text>
      {lines.map((line, i) => (
        <text key={i} fg={C.subtle}>{"   "}{line.slice(0, 80)}</text>
      ))}
    </box>
  );
}

function ThinkingBlockPostStream({ text }: { text: string }) {
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const kw        = wordCount >= 1000 ? `${(wordCount / 1000).toFixed(1)}k` : String(wordCount);
  const firstLine = text.split("\n").find(l => l.trim()) ?? "";
  const preview   = firstLine.slice(0, 65);
  return (
    <box flexDirection="column" paddingLeft={0} marginBottom={1}>
      <box flexDirection="row">
        <text fg={C.subtle}>{"◐ "}</text>
        <text fg={C.inactive}>{"thinking "}</text>
        <text fg={C.subtle}>{`${kw} palavras · `}</text>
        <text fg={C.subtle}>{`"${preview}${preview.length >= 65 ? "…" : ""}"`}</text>
      </box>
    </box>
  );
}

function PersistentToolHistory({ tools }: { tools: ToolEntry[] }) {
  if (!tools.length) return null;
  return (
    <box flexDirection="column" marginBottom={1}>
      {tools.map((t, i) => {
        const icon   = t.status === "error" ? "✖" : "✓";
        const iconFg = t.status === "error" ? C.error : C.success;
        const clean  = t.result.replace(/^⎿\s*/, "");
        return (
          <box key={i} flexDirection="column">
            <box flexDirection="row" gap={1}>
              <text fg={iconFg}>{icon}</text>
              <text fg={C.inactive}>{t.name}</text>
              {t.args && t.args !== "…" ? <text fg={C.subtle}>{`(${t.args})`}</text> : null}
            </box>
            {clean ? <text fg={C.subtle}>{"  ⎿ "}{clean.slice(0, 80)}</text> : null}
          </box>
        );
      })}
    </box>
  );
}

function StreamingPlaceholder() {
  const msg = useRotatingMsg();
  return (
    <box flexDirection="column" marginBottom={1} paddingX={2}>
      <box flexDirection="row" gap={1}>
        <spinner name="dots" color={C.orange} />
        <text fg={C.inactive}>{msg}</text>
      </box>
    </box>
  );
}

function AssistantBubble({ msg, maxW }: { msg: Message; maxW: number }) {
  const content    = msg.content || "";
  const hasContent = content.trim().length > 0;

  if (!hasContent && msg.streaming) {
    return (
      <box flexDirection="column" marginBottom={1} paddingX={2}>
        {msg.thinking && <ThinkingBubble text={msg.thinking} />}
        <StreamingPlaceholder />
      </box>
    );
  }

  const rawLines = content.split("\n");
  const nodes: React.ReactNode[] = [];
  let inCode = false;

  if (msg.thinking) {
    if (msg.streaming) {
      nodes.push(<ThinkingBubble key="think" text={msg.thinking} />);
    } else {
      nodes.push(<ThinkingBlockPostStream key="think" text={msg.thinking} />);
    }
  }

  if (!msg.streaming && msg.tools && msg.tools.length > 0) {
    nodes.push(<PersistentToolHistory key="tools" tools={msg.tools} />);
  }

  for (let li = 0; li < rawLines.length; li++) {
    const line   = rawLines[li]!;
    const isLast = li === rawLines.length - 1;
    const base   = li * 200; // espaço para até 200 wrapped lines por linha lógica

    // Fence de bloco de código
    if (line.startsWith("```")) {
      inCode = !inCode;
      if (inCode) {
        const lang = line.slice(3).trim();
        nodes.push(<text key={base} fg={C.success}>{"  ╔ "}{lang || "code"}</text>);
      } else {
        nodes.push(<text key={base} fg={C.success}>{"  ╚═"}</text>);
      }
      continue;
    }

    const produced = processLine(line, base, maxW, isLast, msg.streaming, inCode);
    for (const el of produced) nodes.push(el);
  }

  return (
    <box flexDirection="column" marginBottom={1} paddingX={2}>
      {nodes}
    </box>
  );
}

function SystemMsg({ content }: { content: string }) {
  return (
    <box marginX={2} marginBottom={1} flexDirection="row">
      <text fg={C.subtle}>ℹ </text>
      <text fg={C.inactive}>{content.slice(0, 200)}</text>
    </box>
  );
}

// ─── Tool activity inline (mirror distribuído no chat) ───────────────────────
import type { DisplayLine } from "./mirror-panel.js";

function ToolLine({ line }: { line: DisplayLine }) {
  if (line.kind === "tool") {
    const icon   = line.status === "running" ? "●" : line.status === "error" ? "✖" : "✓";
    const iconFg = line.status === "running" ? C.inactive : line.status === "error" ? C.error : C.success;
    return (
      <box flexDirection="column" paddingLeft={2}>
        <box flexDirection="row" gap={1}>
          <text fg={iconFg}>{icon}</text>
          <text fg={C.inactive}>{line.tool}</text>
          {line.args ? <text fg={C.subtle}>{`(${line.args})`}</text> : null}
        </box>
        {line.result && line.status !== "running" ? (
          <text fg={C.subtle}>{"  ⎿ "}{line.result.slice(0, 80)}</text>
        ) : null}
      </box>
    );
  }
  if (line.kind === "thinking") {
    return <text fg={C.subtle} paddingLeft={2}>{"○ pensando… "}{line.preview.slice(0, 60)}</text>;
  }
  if (line.kind === "usage") {
    return <text fg={C.subtle} paddingLeft={2}>{line.text}</text>;
  }
  if (line.kind === "app") {
    return <text fg={C.subtle} paddingLeft={2}>{line.icon} {line.label}{line.detail ? ` · ${line.detail}` : ""}</text>;
  }
  return null;
}

// ─── MessageList ──────────────────────────────────────────────────────────────

interface MessageListProps {
  messages:    Message[];
  streaming?:  boolean;
  mirrorLines?: DisplayLine[];
}

export function MessageList({ messages, streaming, mirrorLines }: MessageListProps) {
  const { width, height } = useTerminalDimensions();
  if (messages.length === 0) return null;

  const maxW     = Math.max(40, width - 8);
  const maxItems = Math.max(6, Math.floor((height - 8) / 2));
  const visible  = messages.slice(-maxItems);
  // Linhas de tool que ainda não foram integradas ao texto (streaming)
  const activeTools = (mirrorLines ?? []).filter(
    l => l.kind === "tool" || (streaming && (l.kind === "thinking" || l.kind === "app"))
  );

  return (
    <scrollbox flexGrow={1} stickyScroll stickyStart="bottom" paddingY={1}>
      <box flexDirection="column">
        {visible.map((msg, idx) => {
          if (msg.role === "system") return <SystemMsg       key={idx} content={msg.content} />;
          if (msg.role === "user")   return <UserBubble      key={idx} content={msg.content} />;
          const isLast = idx === visible.length - 1;
          return (
            <React.Fragment key={idx}>
              <AssistantBubble msg={msg} maxW={maxW} />
              {isLast && streaming && activeTools.length > 0 && (
                <box flexDirection="column" marginBottom={1}>
                  {activeTools.slice(-4).map((l, i) => <ToolLine key={i} line={l} />)}
                </box>
              )}
            </React.Fragment>
          );
        })}
      </box>
    </scrollbox>
  );
}
