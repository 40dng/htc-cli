"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { alvoDe, faseDe, num, type Alvo } from "@/lib/api";
import { cn } from "@/lib/utils";

const COR_FASE: Record<string, string> = {
  shell: "bg-primary text-primary-foreground",
  exploit: "text-[#ffd08a] border-[#6b4a0f]",
  vetor: "text-[#a9d4ff] border-[#1e4a6b]",
  recon: "text-muted-foreground border-border",
  cru: "text-muted-foreground border-border",
};

export default function Frota({ frota, abrir }: { frota: Alvo[]; abrir: (a: string) => void }) {
  const [q, setQ] = useState("");
  const lista = frota
    .filter((x) => !q || (alvoDe(x) + " " + faseDe(x)).toLowerCase().includes(q.toLowerCase()))
    .slice(0, 300);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 px-4 py-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="filtrar alvo, fase"
          className="h-8 w-[280px] rounded-md border border-input bg-card px-2.5 text-[12px] outline-none transition-colors duration-150 focus:border-ring"
        />
        <span className="font-mono text-[10px] text-muted-foreground">{lista.length} de {frota.length}</span>
      </div>

      <div className="scroll-thin grid min-h-0 flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(248px,1fr))] gap-2.5 overflow-y-auto px-4 pb-4 [overscroll-behavior:contain]">
        {lista.map((x, i) => {
          const f = faseDe(x);
          return (
            <motion.button
              key={alvoDe(x) + i}
              onClick={() => abrir(alvoDe(x))}
              initial={{ opacity: 0, y: 12, filter: "blur(4px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              transition={{ duration: 0.3, ease: [0.2, 0, 0, 1], delay: Math.min(i, 20) * 0.02 }}
              className="rounded-lg border border-border bg-card p-2.5 text-left shadow-card transition-[border-color,box-shadow] duration-150 hover:border-[color:var(--input)] hover:shadow-card-hover enabled:active:scale-[0.96]"
            >
              <span className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[12px] font-semibold">{alvoDe(x)}</span>
                <span
                  className={cn(
                    "shrink-0 rounded-sm border px-1.5 py-0.5 font-mono text-[9px]",
                    COR_FASE[f] ?? "border-border text-muted-foreground",
                  )}
                >
                  {f}
                </span>
              </span>
              <span className="mt-2 flex gap-3 font-mono text-[10px] text-muted-foreground">
                <span>find <b className="text-foreground">{num(x, "findings")}</b></span>
                <span>val <b className="text-foreground">{num(x, "validados")}</b></span>
                <span>expl <b className="text-foreground">{num(x, "exploitable")}</b></span>
              </span>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
