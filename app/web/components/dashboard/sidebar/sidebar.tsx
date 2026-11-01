"use client";

import SidebarContent from "@/components/dashboard/sidebar/sidebar-content";
import { useUi } from "@/stores/ui-store";
import { cn } from "@/lib/utils";

export default function Sidebar({ contagem }: { contagem: Partial<Record<string, number>> }) {
  const colapsado = useUi((s) => s.sidebarCollapsed);
  const toggle = useUi((s) => s.toggleSidebar);

  return (
    <aside
      className={cn(
        "hidden h-full shrink-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar transition-[width] duration-200 ease-[var(--ease-out-ui)] lg:flex",
        colapsado ? "w-[60px]" : "w-[260px]",
      )}
    >
      <SidebarContent colapsado={colapsado} onToggle={toggle} contagem={contagem} />
    </aside>
  );
}
