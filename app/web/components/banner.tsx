import { Koi } from "@/components/brand/koi";

export function Banner({ colapsado = false }: { colapsado?: boolean }) {
  return (
    <div className="flex items-center gap-2.5 select-none">
      <Koi className={colapsado ? "size-7 text-brand" : "size-9 text-brand"} />
      <div className="leading-none">
        <div className="text-[17px] font-semibold tracking-[0.14em] text-foreground">HTC</div>
        <div className="mt-1.5 font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
          terminal de operacoes
        </div>
      </div>
    </div>
  );
}

