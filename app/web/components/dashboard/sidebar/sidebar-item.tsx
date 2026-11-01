"use client";

import Button from "@/components/_ui/button";
import { cn } from "@/lib/utils";
import type { ComponentType, SVGProps } from "react";

type Props = {
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
  label: string;
  ativo?: boolean;
  colapsado?: boolean;
  contagem?: number;
  onClick?: () => void;
};

export const fadeColapso =
  "transition-opacity duration-150 ease-[var(--ease-out-ui)] data-[collapsed=true]:opacity-0 data-[collapsed=false]:delay-100";

export default function SidebarItem({ icon: Icon, label, ativo = false, colapsado = false, contagem, onClick }: Props) {
  return (
    <Button
      variant="ghost"
      size="md"
      data-active={ativo}
      aria-current={ativo ? "page" : undefined}
      title={colapsado ? label : undefined}
      onClick={onClick}
      className={cn(
        "group/item w-full justify-start gap-1.5 px-2",
        ativo && "bg-sidebar-accent text-sidebar-accent-foreground",
      )}
    >
      {Icon && (
        <Icon
          aria-hidden
          className={cn(
            "size-3.5 shrink-0 transition-colors duration-150",
            ativo ? "text-foreground" : "text-icon group-hover/item:text-muted-foreground",
          )}
        />
      )}
      <span
        data-collapsed={colapsado}
        className={cn("min-w-0 flex-1 overflow-hidden px-0.5 text-left whitespace-nowrap", fadeColapso)}
      >
        {label}
      </span>
      {contagem != null && contagem > 0 && (
        <span
          data-collapsed={colapsado}
          className={cn("shrink-0 font-mono text-[10px] text-muted-foreground", fadeColapso)}
        >
          {contagem}
        </span>
      )}
    </Button>
  );
}
