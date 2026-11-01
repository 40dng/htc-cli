"use client";

import {
  LayoutGrid,
  Columns3,
  MessageSquare,
  ShieldCheck,
  LineChart,
  PlugZap,
  Radar,
  PanelLeftClose,
} from "lucide-react";
import SidebarItem, { fadeColapso } from "@/components/dashboard/sidebar/sidebar-item";
import Button from "@/components/_ui/button";
import { Banner } from "@/components/banner";
import { useUi } from "@/stores/ui-store";
import { cn } from "@/lib/utils";

function Secao({ colapsado, children }: { colapsado: boolean; children: string }) {
  return (
    <span
      data-collapsed={colapsado}
      className={cn("label-style px-2 py-1 whitespace-nowrap text-muted-foreground", fadeColapso)}
    >
      {children}
    </span>
  );
}

export default function SidebarContent({
  colapsado,
  onToggle,
  contagem,
}: {
  colapsado: boolean;
  onToggle: () => void;
  contagem: Partial<Record<string, number>>;
}) {
  const nav = useUi((s) => s.nav);
  const setNav = useUi((s) => s.setNav);

  return (
    <div className="flex h-full flex-col">
      <div
        className={cn(
          "relative shrink-0 border-b border-sidebar-border transition-[height] duration-200 ease-[var(--ease-out-ui)]",
          colapsado ? "h-[104px]" : "h-[80px]",
        )}
      >
        <div className={cn("absolute left-4", colapsado ? "top-4" : "top-1/2 -translate-y-1/2")}>
          <Banner colapsado={colapsado} />
        </div>
        <Button
          variant="secondary"
          size="icon"
          aria-label={colapsado ? "Expandir sidebar" : "Colapsar sidebar"}
          onClick={onToggle}
          className={cn(
            "shadow-ring absolute transition-[top,left] duration-200 ease-[var(--ease-out-ui)]",
            colapsado
              ? "bottom-3 left-1/2 -translate-x-1/2"
              : "top-1/2 right-3 -translate-y-1/2",
          )}
        >
          <PanelLeftClose
            aria-hidden
            className={cn(
              "size-3.5 text-icon transition-transform duration-200 ease-[var(--ease-out-ui)]",
              colapsado && "rotate-180",
            )}
          />
        </Button>
      </div>

      <nav aria-label="Operacao" className="flex flex-col gap-1 border-b border-sidebar-border p-3">
        <Secao colapsado={colapsado}>Operacao</Secao>
        <SidebarItem
          icon={LayoutGrid}
          label="Frota"
          colapsado={colapsado}
          ativo={nav === "frota"}
          contagem={contagem.frota}
          onClick={() => setNav("frota")}
        />
        <SidebarItem
          icon={Columns3}
          label="Kanban"
          colapsado={colapsado}
          ativo={nav === "kanban"}
          contagem={contagem.kanban}
          onClick={() => setNav("kanban")}
        />
        <SidebarItem
          icon={MessageSquare}
          label="Chat"
          colapsado={colapsado}
          ativo={nav === "chat"}
          onClick={() => setNav("chat")}
        />
      </nav>

      <nav aria-label="Controle" className="flex flex-col gap-1 border-b border-sidebar-border p-3">
        <Secao colapsado={colapsado}>Controle</Secao>
        <SidebarItem
          icon={ShieldCheck}
          label="Aprovacoes"
          colapsado={colapsado}
          ativo={nav === "controle"}
          contagem={contagem.controle}
          onClick={() => setNav("controle")}
        />
        <SidebarItem
          icon={LineChart}
          label="Graficos"
          colapsado={colapsado}
          ativo={nav === "graficos"}
          onClick={() => setNav("graficos")}
        />
      </nav>

      <nav aria-label="Substrato" className="scroll-thin flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-3">
        <Secao colapsado={colapsado}>Substrato</Secao>
        <SidebarItem
          icon={PlugZap}
          label="Supply"
          colapsado={colapsado}
          ativo={nav === "supply"}
          contagem={contagem.supply}
          onClick={() => setNav("supply")}
        />
        <SidebarItem
          icon={Radar}
          label="LeakRadar"
          colapsado={colapsado}
          ativo={nav === "leakradar"}
          contagem={contagem.leakradar}
          onClick={() => setNav("leakradar")}
        />
      </nav>

      <div className="flex items-center gap-2 border-t border-sidebar-border p-3">
        <span className="size-1.5 shrink-0 rounded-full bg-success" />
        <span data-collapsed={colapsado} className={cn("font-mono text-[10px] text-muted-foreground", fadeColapso)}>
          htc ao vivo
        </span>
      </div>
    </div>
  );
}
