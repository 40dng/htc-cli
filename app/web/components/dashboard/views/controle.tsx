"use client";

import Button from "@/components/_ui/button";
import { decidirAprovacao, type Aprovacao, type Lease } from "@/lib/api";

const th = "border-b border-border px-2.5 py-2 text-left font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground";
const td = "border-b border-border px-2.5 py-[7px] text-[11px] text-[color:var(--secondary-foreground)]";

export default function Controle({
  apr,
  leases,
  recarregar,
}: {
  apr: Aprovacao[];
  leases: Lease[];
  recarregar: () => void;
}) {
  return (
    <div className="grid min-h-0 flex-1 grid-cols-2 gap-3 overflow-hidden p-4">
      <section className="flex min-h-0 flex-col rounded-lg border border-border bg-card shadow-card">
        <h3 className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2 text-[11px] font-semibold">
          Aprovacoes
          <span className="font-mono text-[10px] text-muted-foreground">{apr.length}</span>
        </h3>
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto [overscroll-behavior:contain]">
          {apr.length ? (
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={th}>acao</th>
                  <th className={th}>alvo</th>
                  <th className={th} />
                </tr>
              </thead>
              <tbody>
                {apr.slice(0, 60).map((a) => (
                  <tr key={String(a.id)}>
                    <td className={td}>
                      <b className="text-foreground">{String(a.acao ?? a.tipo ?? a.kind ?? "?")}</b>
                    </td>
                    <td className={td}>{String(a.alvo ?? a.dominio ?? "-")}</td>
                    <td className={`${td} whitespace-nowrap text-right`}>
                      <Button
                        variant="success"
                        size="sm"
                        className="mr-1"
                        onClick={async () => {
                          await decidirAprovacao(a.id, true);
                          recarregar();
                        }}
                      >
                        ok
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={async () => {
                          await decidirAprovacao(a.id, false);
                          recarregar();
                        }}
                      >
                        no
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="p-3 text-[11px] text-muted-foreground">nada pendente</p>
          )}
        </div>
      </section>

      <section className="flex min-h-0 flex-col rounded-lg border border-border bg-card shadow-card">
        <h3 className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2 text-[11px] font-semibold">
          Leases
          <span className="font-mono text-[10px] text-muted-foreground">{leases.length}</span>
        </h3>
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto [overscroll-behavior:contain]">
          {leases.length ? (
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={th}>alvo</th>
                  <th className={th}>egress</th>
                  <th className={th}>expira</th>
                </tr>
              </thead>
              <tbody>
                {leases.slice(0, 60).map((l, i) => (
                  <tr key={i}>
                    <td className={td}>
                      <b className="text-foreground">{l.host ?? l.alvo ?? l.target ?? "-"}</b>
                    </td>
                    <td className={`${td} font-mono text-[10px]`}>{l.proxy ?? "-"}</td>
                    <td className={`${td} font-mono text-[10px]`}>{l.expira_em ?? l.desde ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="p-3 text-[11px] text-muted-foreground">sem leases</p>
          )}
        </div>
      </section>
    </div>
  );
}
