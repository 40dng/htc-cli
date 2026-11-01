"use client";

import { useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import fases from "@/lib/fases.json";
import { mesmoAlvo } from "@/lib/alvo";
import { alvoDe, faseDe, mudarFase, num, type Alvo, type Missao } from "@/lib/api";
import { cn } from "@/lib/utils";

// Colunas e cores vem de lib/fases.json (gerado de src/runtime/missao.ts).
const COLUNAS = fases.map((f) => f.id);
const COR = Object.fromEntries(fases.map((f) => [f.id, f.cor])) as Record<string, string>;
const ROTULO = Object.fromEntries(fases.map((f) => [f.id, f.rotulo])) as Record<string, string>;

type Coluna = string;

/** Cartao da missao: o arquivo manda, o banco da frota complementa. */
function comMissao(x: Alvo, missao: Missao | null): Alvo {
  if (!missao || missao.fechada) return x;
  if (!mesmoAlvo(alvoDe(x), missao.alvo)) return x;
  return {
    ...x,
    fase: missao.fase,
    findings: missao.achados.length,
    validados: missao.achados.filter((a) => a.validado).length,
    shells: missao.shells.length,
  };
}

function Cartao({ alvo, abrir }: { alvo: string; abrir: (a: string) => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: alvo });
  return (
    <button
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={() => abrir(alvo)}
      className={cn(
        "w-full cursor-grab rounded-md border border-border bg-card px-2 py-1.5 text-left text-[11px] shadow-card",
        "transition-[border-color,opacity] duration-150 hover:border-[color:var(--input)] active:cursor-grabbing",
        isDragging && "opacity-40",
      )}
    >
      {alvo}
    </button>
  );
}

function Contadores({ x }: { x: Alvo }) {
  const f = num(x, "findings");
  const v = num(x, "validados");
  const s = num(x, "shells");
  if (!f && !v && !s) return null;
  return (
    <div className="mt-1 flex gap-2 font-mono text-[9px] text-muted-foreground">
      {f ? <span>f {f}</span> : null}
      {v ? <span className="text-[color:var(--success)]">v {v}</span> : null}
      {s ? <span className="text-[color:var(--brand-2)]">sh {s}</span> : null}
    </div>
  );
}

function ColunaView({
  fase,
  itens,
  abrir,
}: {
  fase: Coluna;
  itens: Alvo[];
  abrir: (a: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: fase });
  return (
    <div
      className={cn(
        "flex min-h-0 flex-col rounded-lg border bg-card transition-colors duration-150",
        isOver ? "border-ring" : "border-border",
      )}
    >
      <h3 className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        <span className="size-1.5 rounded-full" style={{ background: COR[fase] }} />
        {ROTULO[fase] ?? fase}
        <b className="ml-auto text-foreground">{itens.length}</b>
      </h3>
      <div
        ref={setNodeRef}
        className="scroll-thin flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-2 [overscroll-behavior:contain]"
      >
        {itens.slice(0, 120).map((x) => (
          <div key={alvoDe(x)}>
            <Cartao alvo={alvoDe(x)} abrir={abrir} />
            <Contadores x={x} />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Kanban({
  frota,
  missao,
  abrir,
  recarregar,
}: {
  frota: Alvo[];
  missao: Missao | null;
  abrir: (a: string) => void;
  recarregar: () => void;
}) {
  const [ativo, setAtivo] = useState<string | null>(null);
  const sensores = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const cartoes = useMemo(() => {
    const base = frota.map((x) => comMissao(x, missao));
    // Missao pode existir sem linha na frota (ex.: aberta pelo CLI agora).
    if (missao && !missao.fechada && !base.some((x) => mesmoAlvo(alvoDe(x), missao.alvo))) {
      base.unshift(comMissao({ alvo: missao.alvo, fase: missao.fase }, missao));
    }
    return base;
  }, [frota, missao]);

  const mapa = useMemo(() => {
    const m: Record<string, Alvo[]> = {};
    COLUNAS.forEach((c) => (m[c] = []));
    cartoes.forEach((x) => {
      const f = faseDe(x);
      (m[f] ?? m[COLUNAS[0]]).push(x);
    });
    return m;
  }, [cartoes]);

  async function aoSoltar(e: DragEndEvent) {
    setAtivo(null);
    const alvo = String(e.active.id);
    const destino = e.over?.id ? String(e.over.id) : null;
    if (!destino || !COLUNAS.includes(destino)) return;
    if (faseDe({ alvo, fase: destino }) === destino) return;
    await mudarFase(alvo, destino);
    recarregar();
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col p-4">
      {missao && !missao.fechada ? (
        <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-border bg-card px-3 py-2 font-mono text-[10px] text-muted-foreground">
          <span className="uppercase tracking-[0.12em] text-[color:var(--brand)]">missao</span>
          <span className="text-foreground">{missao.alvo}</span>
          <span>
            objetivo: <b className="font-normal text-foreground">{missao.objetivo}</b>
          </span>
          <span>
            fase:{" "}
            <b className="font-normal" style={{ color: COR[missao.fase] }}>
              {missao.fase}
            </b>
          </span>
          <span className="ml-auto">
            achados {missao.achados.length} · validados{" "}
            {missao.achados.filter((a) => a.validado).length} · shells {missao.shells.length}
          </span>
        </div>
      ) : null}
      <DndContext
        sensors={sensores}
        onDragStart={(e: DragStartEvent) => setAtivo(String(e.active.id))}
        onDragEnd={aoSoltar}
        onDragCancel={() => setAtivo(null)}
      >
        <div className="grid min-h-0 flex-1 auto-cols-[minmax(196px,1fr)] grid-flow-col gap-2.5">
          {COLUNAS.map((c) => (
            <ColunaView key={c} fase={c} itens={mapa[c] ?? []} abrir={abrir} />
          ))}
        </div>
        <DragOverlay dropAnimation={null}>
          {ativo ? (
            <div className="rounded-md border border-ring bg-card px-2 py-1.5 text-[11px] shadow-popover">{ativo}</div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

