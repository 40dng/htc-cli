"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

type Dominio = {
  dominio: string;
  score: number;
  tipo: string;
  itens: number;
  com_senha: number;
  com_senha_entrada: number;
  hosts_entrada: string[];
};

type Dados = {
  gasto: { total: number; last: string | null };
  varridos: number;
  com_senha: number;
  senhas_visiveis: number;
  senhas_no_host_de_entrada: number;
  top: Dominio[];
  com_senha_top: Dominio[];
};

const th = "border-b border-border px-2.5 py-2 text-left font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground";
const td = "border-b border-border px-2.5 py-[6px] text-[11px] text-[color:var(--secondary-foreground)]";

export default function LeakRadar() {
  const [d, setD] = useState<Dados | null>(null);

  useEffect(() => {
    let vivo = true;
    const puxar = async () => {
      try {
        const r = await fetch("/api/leakradar", { cache: "no-store" });
        if (r.ok && vivo) setD(await r.json());
      } catch {
        /* silencioso: o painel segue */
      }
    };
    puxar();
    const id = setInterval(puxar, 15000);
    return () => {
      vivo = false;
      clearInterval(id);
    };
  }, []);

  if (!d) return <p className="p-4 text-[11px] text-muted-foreground">lendo o ledger...</p>;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
      <div className="grid shrink-0 grid-cols-5 gap-2.5">
        <Card rotulo="pontos" valor={d.gasto.total} />
        <Card rotulo="dominios varridos" valor={d.varridos} />
        <Card rotulo="com senha" valor={d.com_senha} />
        <Card rotulo="senhas visiveis" valor={d.senhas_visiveis} destaque />
        <Card rotulo="no host de entrada" valor={d.senhas_no_host_de_entrada} destaque />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-2 gap-3">
        <section className="flex min-h-0 flex-col rounded-lg border border-border bg-card shadow-card">
          <h3 className="shrink-0 border-b border-border px-3 py-2 text-[11px] font-semibold">
            Com senha visivel
            <span className="ml-2 font-mono text-[10px] font-normal text-muted-foreground">acervo ja desbloqueado</span>
          </h3>
          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto [overscroll-behavior:contain]">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={th}>dominio</th>
                  <th className={th}>senhas</th>
                  <th className={th}>entrada</th>
                </tr>
              </thead>
              <tbody>
                {d.com_senha_top.map((x) => (
                  <tr key={x.dominio}>
                    <td className={td}>
                      <b className="text-foreground">{x.dominio}</b>
                      <div className="font-mono text-[9px] text-muted-foreground">{x.hosts_entrada[0] ?? "-"}</div>
                    </td>
                    <td className={`${td} font-mono`}>{x.com_senha}</td>
                    <td className={cn(td, "font-mono")}>
                      <span className={x.com_senha_entrada > 0 ? "text-primary" : "text-muted-foreground"}>
                        {x.com_senha_entrada}
                      </span>
                    </td>
                  </tr>
                ))}
                {!d.com_senha_top.length && (
                  <tr>
                    <td className={td} colSpan={3}>
                      nada com senha visivel ainda
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="flex min-h-0 flex-col rounded-lg border border-border bg-card shadow-card">
          <h3 className="shrink-0 border-b border-border px-3 py-2 text-[11px] font-semibold">
            Prioridade do indice
            <span className="ml-2 font-mono text-[10px] font-normal text-muted-foreground">score</span>
          </h3>
          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto [overscroll-behavior:contain]">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={th}>dominio</th>
                  <th className={th}>tipo</th>
                  <th className={th}>score</th>
                </tr>
              </thead>
              <tbody>
                {d.top.map((x) => (
                  <tr key={x.dominio}>
                    <td className={td}>
                      <b className="text-foreground">{x.dominio}</b>
                    </td>
                    <td className={`${td} text-[10px] text-muted-foreground`}>{x.tipo}</td>
                    <td className={`${td} font-mono`}>{x.score}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <div className="shrink-0 font-mono text-[10px] text-muted-foreground">
        ultimo unlock: {d.gasto.last ?? "sem registro"}
      </div>
    </div>
  );
}

function Card({ rotulo, valor, destaque }: { rotulo: string; valor: number; destaque?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3 shadow-card">
      <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">{rotulo}</div>
      <div className={cn("mt-1 text-[20px] font-semibold leading-none", destaque && "text-primary")}>
        {new Intl.NumberFormat("pt-BR").format(valor)}
      </div>
    </div>
  );
}
