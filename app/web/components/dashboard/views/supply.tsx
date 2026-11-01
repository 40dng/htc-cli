"use client";

import type { Egress } from "@/lib/api";
import { cn } from "@/lib/utils";

type Resumo = { provedor: string; contas: number; vivos: number; mortos: number; latencia: number | null; melhor: number };

const th = "border-b border-border px-2.5 py-2 text-left font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground";
const td = "border-b border-border px-2.5 py-[6px] text-[11px] text-[color:var(--secondary-foreground)]";

function Ponto({ status }: { status?: string }) {
  const s = (status ?? "").toLowerCase();
  const cor = s === "vivo" ? "bg-success" : s === "morto" ? "bg-danger" : "bg-muted-foreground";
  return <span className={cn("inline-block size-1.5 rounded-full", cor)} />;
}

export function Contas({ pool }: { pool: Egress[] }) {
  return (
    <section className="flex min-h-0 flex-col rounded-lg border border-border bg-card shadow-card">
      <h3 className="shrink-0 border-b border-border px-3 py-2 text-[11px] font-semibold">
        Contas
        <span className="ml-2 font-mono text-[10px] font-normal text-muted-foreground">
          uma linha por credencial, ordenado por score
        </span>
      </h3>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto [overscroll-behavior:contain]">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={th}>provedor</th>
              <th className={th}>endpoint</th>
              <th className={th}>conta</th>
              <th className={th}>status</th>
              <th className={th}>lat</th>
              <th className={th}>score</th>
            </tr>
          </thead>
          <tbody>
            {pool.slice(0, 300).map((p, i) => (
              <tr key={i}>
                <td className={td}>{p.provedor ?? "-"}</td>
                <td className={`${td} font-mono text-[10px]`}>
                  {p.host}:{p.porta}
                </td>
                <td className={`${td} font-mono text-[10px]`}>{p.usuario ? `${p.usuario.slice(0, 3)}...` : "-"}</td>
                <td className={td}>
                  <span className="inline-flex items-center gap-1.5">
                    <Ponto status={p.status} />
                    {p.status}
                  </span>
                </td>
                <td className={`${td} font-mono text-[10px]`}>{p.latencia_ms ? `${p.latencia_ms}ms` : "-"}</td>
                <td className={`${td} font-mono text-[10px]`}>{p.score ?? 0}</td>
              </tr>
            ))}
            {!pool.length && (
              <tr>
                <td className={td} colSpan={6}>
                  pool vazio - rode o garcom
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Cartao({ rotulo, valor, destaque, extra }: { rotulo: string; valor: string; destaque?: boolean; extra?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3 shadow-card">
      <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">{rotulo}</div>
      <div className={cn("mt-1 text-[20px] font-semibold leading-none", destaque && "text-primary")}>{valor}</div>
      {extra && <div className="mt-1 font-mono text-[9px] text-muted-foreground">{extra}</div>}
    </div>
  );
}

export default function Supply({ pool, resumo }: { pool: Egress[]; resumo: Resumo[] }) {
  const vivos = pool.filter((p) => p.status === "vivo").length;
  const candidatos = pool.filter((p) => p.status === "candidato").length;
  const porTipo: Record<string, number> = {};
  pool.forEach((p) => {
    const t = p.tipo ?? "?";
    porTipo[t] = (porTipo[t] ?? 0) + 1;
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
      <div className="grid shrink-0 grid-cols-4 gap-2.5">
        <Cartao rotulo="contas" valor={String(pool.length)} extra={`${resumo.length} provedores`} />
        <Cartao rotulo="vivos" valor={String(vivos)} destaque extra={`${candidatos} a classificar`} />
        <Cartao
          rotulo="por tipo"
          valor={Object.keys(porTipo).length ? Object.keys(porTipo).join(" / ") : "-"}
          extra={Object.entries(porTipo)
            .map(([t, n]) => `${t} ${n}`)
            .join("  ")}
        />
        <Cartao
          rotulo="melhor score"
          valor={String(resumo.reduce((m, r) => Math.max(m, r.melhor ?? 0), 0))}
          extra={resumo
            .slice(0, 2)
            .map((r) => `${r.provedor} ${r.vivos}v`)
            .join("  ")}
        />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[260px_1fr] gap-3">
        <section className="flex min-h-0 flex-col rounded-lg border border-border bg-card shadow-card">
          <h3 className="shrink-0 border-b border-border px-3 py-2 text-[11px] font-semibold">Por provedor</h3>
          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto [overscroll-behavior:contain]">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={th}>provedor</th>
                  <th className={th}>vivos</th>
                  <th className={th}>lat</th>
                </tr>
              </thead>
              <tbody>
                {resumo.map((r) => (
                  <tr key={r.provedor}>
                    <td className={td}>
                      <b className="text-foreground">{r.provedor}</b>
                      <span className="ml-1 font-mono text-[9px] text-muted-foreground">/{r.contas}</span>
                    </td>
                    <td className={td}>
                      <b className="text-primary">{r.vivos}</b>
                      <span className="font-mono text-[9px] text-muted-foreground">/{r.mortos ?? 0}m</span>
                    </td>
                    <td className={`${td} font-mono text-[10px]`}>{r.latencia ? `${r.latencia}ms` : "-"}</td>
                  </tr>
                ))}
                {!resumo.length && (
                  <tr>
                    <td className={td} colSpan={3}>
                      sem provedor
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <Contas pool={pool} />
      </div>
    </div>
  );
}
