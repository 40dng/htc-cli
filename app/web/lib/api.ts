export type Alvo = {
  alvo?: string;
  dominio?: string;
  host?: string;
  target?: string;
  fase?: string;
  phase?: string;
  status?: string;
  estado?: string;
  findings?: number;
  creds?: number;
  shells?: number;
  validados?: number;
  exploitable?: number;
  assets?: number;
  endpoints?: number;
  ultimo?: number | null;
};

export type Resumo = {
  alvos?: number;
  findings?: number;
  shells?: number;
  validados?: number;
  exploitable?: number;
  credenciais?: number;
  endpoints?: number;
  [k: string]: unknown;
};
export type Egress = {
  familia?: string;
  tipo?: string;
  provedor?: string;
  host?: string;
  porta?: number | string;
  usuario?: string;
  pais?: string;
  status?: string;
  latencia_ms?: number | null;
  score?: number | null;
  probado_em?: number | null;
};
export type Lease = {
  host?: string;
  alvo?: string;
  target?: string;
  proxy?: string;
  dono?: string;
  desde?: string;
  since?: string;
  expira_em?: number;
  criado_em?: number;
};

export type Aprovacao = {
  id: string | number;
  acao?: string;
  tipo?: string;
  kind?: string;
  alvo?: string;
  dominio?: string;
  resumo?: string;
};

export type Estado = {
  resumo: Resumo;
  frota: Alvo[];
  pool: Egress[];
  poolResumo: PoolResumo[];
  leases: Lease[];
  apr: Aprovacao[];
};

export type PoolResumo = {
  provedor: string;
  contas: number;
  vivos: number;
  mortos: number;
  latencia: number | null;
  melhor: number;
};

async function pegar<T>(u: string): Promise<T | null> {
  try {
    const r = await fetch(u, { cache: "no-store" });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

export async function carregarEstado(): Promise<Estado> {
  const [f, e, a] = await Promise.all([
    pegar<{ resumo?: Resumo; frota?: Alvo[] }>("/api/fleet"),
    pegar<{ pool?: Egress[]; resumo?: PoolResumo[]; leases?: Lease[] }>("/api/egress"),
    pegar<Aprovacao[] | { itens?: Aprovacao[] }>("/api/approvals"),
  ]);
  return {
    resumo: f?.resumo ?? {},
    frota: f?.frota ?? [],
    pool: e?.pool ?? [],
    poolResumo: e?.resumo ?? [],
    leases: e?.leases ?? [],
    apr: Array.isArray(a) ? a : a?.itens ?? [],
  };
}

export async function detalheAlvo(alvo: string): Promise<unknown> {
  return pegar<unknown>("/api/target/" + encodeURIComponent(alvo));
}

export async function decidirAprovacao(id: string | number, ok: boolean): Promise<void> {
  try {
    await fetch("/api/approvals/" + encodeURIComponent(String(id)), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok }),
    });
  } catch {
    /* sem efeito na UI */
  }
}

export async function mudarFase(alvo: string, fase: string): Promise<boolean> {
  try {
    const r = await fetch("/api/target/" + encodeURIComponent(alvo) + "/fase", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fase }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

export type Dispatch = {
  ok: boolean;
  id: number;
  dominio: string;
  prioridade: number;
  status: string;
  lease?: { host?: string; proxy?: string; novo?: boolean; expira_em?: number };
};

/** O botao do painel: enfileira o alvo para um agente dedicado e reserva egress. */
export async function disparar(alvo: string, prompt: string, prioridade = 8): Promise<Dispatch | null> {
  try {
    const r = await fetch("/api/dispatch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ alvo, prompt, prioridade }),
    });
    return r.ok ? ((await r.json()) as Dispatch) : null;
  } catch {
    return null;
  }
}

export async function carregarSupply(): Promise<{ tipos: unknown[]; total: number; vivos: number } | null> {
  return pegar("/api/supply");
}

export type Missao = {
  alvo: string;
  objetivo: string;
  fase: string;
  escopo: string[];
  achados: { id: number; fase: string; titulo: string; evidencia: string; validado: boolean; criado: string }[];
  shells: { id: number; host: string; transporte: string; prova: string; criado: string }[];
  criada: string;
  atualizada: string;
  fechada: boolean;
};

/** Mesma fonte do CLI: ops/state/missao.json via /api/missao. */
export async function carregarMissao(): Promise<{ missao: Missao | null; intel: string[] }> {
  const r = await pegar<{ missao: Missao | null; intel: string[] }>("/api/missao");
  return r ?? { missao: null, intel: [] };
}

export async function mudarFaseMissao(alvo: string, fase: string): Promise<boolean> {
  try {
    const r = await fetch("/api/missao/fase", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ alvo, fase }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

export const faseDe = (x: Alvo) => String(x.fase ?? x.phase ?? x.status ?? "cru").toLowerCase();
export const alvoDe = (x: Alvo) => (x.alvo ?? x.dominio ?? x.host ?? x.target ?? "-") as string;
export const num = (x: Alvo, k: "findings" | "creds" | "shells" | "validados" | "exploitable" | "assets" | "endpoints") =>
  Number(x[k] ?? 0) || 0;

export const fmt = new Intl.NumberFormat("pt-BR");
