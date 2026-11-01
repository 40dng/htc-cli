"use client";

import { useEffect, useRef } from "react";
import { faseDe, type Alvo, type Egress } from "@/lib/api";

function linha(cv: HTMLCanvasElement | null, dados: number[], cor: string) {
  if (!cv) return;
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth || 320;
  const h = cv.clientHeight || 120;
  cv.width = w * dpr;
  cv.height = h * dpr;
  const g = cv.getContext("2d");
  if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const max = Math.max(1, ...dados);
  const px = (i: number) => (i / Math.max(1, dados.length - 1)) * w;
  const py = (v: number) => h - 8 - (v / max) * (h - 20);
  g.strokeStyle = "rgba(255,255,255,.06)";
  g.lineWidth = 1;
  for (let i = 0; i <= 3; i++) {
    const y = 8 + (i * (h - 16)) / 3;
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(w, y);
    g.stroke();
  }
  g.beginPath();
  dados.forEach((v, i) => (i ? g.lineTo(px(i), py(v)) : g.moveTo(0, py(v))));
  g.strokeStyle = cor;
  g.lineWidth = 1.8;
  g.lineJoin = "round";
  g.stroke();
  g.lineTo(w, h);
  g.lineTo(0, h);
  g.closePath();
  const gr = g.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, "rgba(0,255,136,.18)");
  gr.addColorStop(1, "rgba(0,255,136,0)");
  g.fillStyle = gr;
  g.fill();
}

function barras(cv: HTMLCanvasElement | null, pares: [string, number][]) {
  if (!cv) return;
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth || 320;
  const h = cv.clientHeight || 120;
  cv.width = w * dpr;
  cv.height = h * dpr;
  const g = cv.getContext("2d");
  if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const max = Math.max(1, ...pares.map((p) => p[1]));
  const bw = w / Math.max(1, pares.length);
  pares.forEach(([nome, v], i) => {
    const bh = (v / max) * (h - 26);
    g.fillStyle = "rgba(0,255,136,.7)";
    g.fillRect(i * bw + 4, h - 18 - bh, Math.max(2, bw - 8), bh);
    g.fillStyle = "#5f6b65";
    g.font = "9px ui-sans-serif";
    g.textAlign = "center";
    g.fillText(nome, i * bw + bw / 2, h - 5);
  });
}

function Caixa({ titulo, nota, children }: { titulo: string; nota: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3 pb-2 shadow-card">
      <h4 className="m-0 text-[11px] font-semibold">{titulo}</h4>
      <p className="mb-2 font-mono text-[9px] text-muted-foreground">{nota}</p>
      {children}
    </div>
  );
}

export default function Graficos({ frota, pool }: { frota: Alvo[]; pool: Egress[] }) {
  const c1 = useRef<HTMLCanvasElement>(null);
  const c2 = useRef<HTMLCanvasElement>(null);
  const c3 = useRef<HTMLCanvasElement>(null);
  const c4 = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const fases = ["cru", "recon", "vetor", "exploit", "shell"];
    const porFase = fases.map((f) => [f, frota.filter((x) => faseDe(x) === f).length] as [string, number]);
    const porStatus: Record<string, number> = {};
    pool.forEach((p) => {
      const s = p.status ?? "?";
      porStatus[s] = (porStatus[s] ?? 0) + 1;
    });

    linha(c1.current, porFase.map((p) => p[1]).concat([0, 0, 0, 0]), "#CB1B45");
    barras(c2.current, porFase);
    linha(c3.current, [0, 0, 0, 0], "#5aa9ff");
    barras(c4.current, Object.entries(porStatus) as [string, number][]);
  }, [frota, pool]);

  return (
    <div className="grid min-h-0 flex-1 grid-cols-2 gap-3 overflow-auto p-4 [overscroll-behavior:contain]">
      <Caixa titulo="Frota por fase" nota="alvos no pipeline">
        <canvas ref={c1} className="h-[120px] w-full" />
      </Caixa>
      <Caixa titulo="Conversao" nota="quantos alvos em cada estagio">
        <canvas ref={c2} className="h-[120px] w-full" />
      </Caixa>
      <Caixa titulo="Atividade" nota="serie do dia (preenche com o runner)">
        <canvas ref={c3} className="h-[120px] w-full" />
      </Caixa>
      <Caixa titulo="Pool por status" nota="vivo / candidato / morto">
        <canvas ref={c4} className="h-[120px] w-full" />
      </Caixa>
    </div>
  );
}
