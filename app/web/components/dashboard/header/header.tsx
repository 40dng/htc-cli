"use client";

import { fmt, type Estado } from "@/lib/api";
import { cn } from "@/lib/utils";

const TITULOS: Record<string, string> = {
  frota: "Frota",
  kanban: "Kanban",
  chat: "Chat",
  controle: "Aprovacoes",
  graficos: "Graficos",
  supply: "Supply",
  leakradar: "LeakRadar",
};

function Kpi({ rotulo, valor, destaque }: { rotulo: string; valor: number; destaque?: boolean }) {
  return (
    <span className="flex flex-col items-end leading-none">
      <b className={cn("text-[13px] font-semibold", destaque && "text-primary")}>{fmt.format(valor)}</b>
      <s className="mt-1 font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground no-underline">
        {rotulo}
      </s>
    </span>
  );
}

export default function Header({ nav, estado }: { nav: string; estado: Estado }) {
  const { resumo, frota, pool } = estado;
  const shells = resumo.shells ?? frota.filter((x) => String(x.fase ?? x.status).toLowerCase() === "shell").length;

  return (
    <header className="flex h-[52px] shrink-0 items-center gap-3.5 border-b border-border bg-background px-4">
      <h1 className="lead-style">{TITULOS[nav] ?? nav}</h1>
      <div className="ml-auto flex items-center gap-4">
        <Kpi rotulo="alvos" valor={resumo.alvos ?? frota.length} />
        <Kpi rotulo="findings" valor={resumo.findings ?? 0} />
        <Kpi rotulo="validados" valor={resumo.validados ?? 0} />
        <Kpi rotulo="shell" valor={shells} destaque />
        <Kpi rotulo="pool" valor={pool.length} />
        <span className="ml-1 flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-success" />
          <span className="font-mono text-[10px] text-muted-foreground">ao vivo</span>
        </span>
      </div>
    </header>
  );
}
