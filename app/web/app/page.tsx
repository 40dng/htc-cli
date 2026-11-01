"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "motion/react";
import Sidebar from "@/components/dashboard/sidebar/sidebar";
import Header from "@/components/dashboard/header/header";
import Frota from "@/components/dashboard/views/frota";
import Kanban from "@/components/dashboard/views/kanban";
import Chat from "@/components/dashboard/views/chat";
import Controle from "@/components/dashboard/views/controle";
import Graficos from "@/components/dashboard/views/graficos";
import Supply from "@/components/dashboard/views/supply";
import LeakRadar from "@/components/dashboard/views/leakradar";
import { alvoDe, carregarEstado, carregarMissao, detalheAlvo, type Estado, type Missao } from "@/lib/api";
import { useUi } from "@/stores/ui-store";

const VAZIO: Estado = { resumo: {}, frota: [], pool: [], poolResumo: [], leases: [], apr: [] };

export default function Page() {
  const nav = useUi((s) => s.nav);
  const [estado, setEstado] = useState<Estado>(VAZIO);
  const [missao, setMissao] = useState<Missao | null>(null);
  const [detalhe, setDetalhe] = useState<{ alvo: string; dados: unknown } | null>(null);

  const carregar = useCallback(async () => {
    const [novo, m] = await Promise.all([carregarEstado(), carregarMissao()]);
    setEstado(novo);
    setMissao(m.missao);
  }, []);

  useEffect(() => {
    carregar();
    const id = setInterval(carregar, 4000);
    return () => clearInterval(id);
  }, [carregar]);

  const abrir = useCallback(async (alvo: string) => {
    setDetalhe({ alvo, dados: null });
    const dados = await detalheAlvo(alvo);
    setDetalhe((d) => (d && d.alvo === alvo ? { alvo, dados } : d));
  }, []);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDetalhe(null);
    };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, []);

  const contagem = {
    frota: estado.frota.length,
    kanban: estado.frota.length,
    controle: estado.apr.length,
    supply: estado.pool.length,
  };

  return (
    <div className="flex h-dvh overflow-hidden bg-background text-foreground">
      <Sidebar contagem={contagem} />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Header nav={nav} estado={estado} />

        <main className="flex min-h-0 flex-1 flex-col">
          {nav === "frota" && <Frota frota={estado.frota} abrir={abrir} />}
          {nav === "kanban" && <Kanban frota={estado.frota} missao={missao} abrir={abrir} recarregar={carregar} />}
          {nav === "chat" && <Chat alvos={estado.frota.map((x) => alvoDe(x))} />}
          {nav === "controle" && <Controle apr={estado.apr} leases={estado.leases} recarregar={carregar} />}
          {nav === "graficos" && <Graficos frota={estado.frota} pool={estado.pool} />}
          {nav === "supply" && <Supply pool={estado.pool} resumo={estado.poolResumo} />}
          {nav === "leakradar" && <LeakRadar />}
        </main>
      </div>

      {detalhe && (
        <>
          <div onClick={() => setDetalhe(null)} className="fixed inset-0 z-40 bg-black/60" />
          <motion.aside
            initial={{ x: 24, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
            className="fixed inset-y-0 right-0 z-50 flex w-[min(460px,92vw)] flex-col border-l border-border bg-card shadow-popover"
          >
            <header className="flex items-center gap-2.5 border-b border-border px-3.5 py-3">
              <h2 className="lead-style">{detalhe.alvo}</h2>
              <button
                onClick={() => setDetalhe(null)}
                className="ml-auto h-7 rounded-md border border-border bg-secondary px-2.5 text-[11px] transition-colors duration-150 hover:bg-accent enabled:active:scale-[0.96]"
              >
                Fechar
              </button>
            </header>
            <div className="scroll-thin overflow-y-auto p-3.5 [overscroll-behavior:contain]">
              {detalhe.dados == null ? (
                <p className="text-[11px] text-muted-foreground">carregando...</p>
              ) : (
                <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-[color:var(--secondary-foreground)]">
                  {JSON.stringify(detalhe.dados, null, 2)}
                </pre>
              )}
            </div>
          </motion.aside>
        </>
      )}
    </div>
  );
}
