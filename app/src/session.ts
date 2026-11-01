import { homedir } from "os";
import { join } from "path";
import { mkdirSync, readdirSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import type { Message } from "./ai.js";

const SESSION_DIR = join(homedir(), ".htc", "sessions");

export interface Session {
  id:         string;
  title:      string;
  messages:   Message[];
  mode:       string;
  target?:    string;
  criado_em:  number;
  atualizado_em: number;
}

function garantir_dir() {
  mkdirSync(SESSION_DIR, { recursive: true });
}

export function salvar_sessao(sessao: Session): void {
  garantir_dir();
  writeFileSync(join(SESSION_DIR, `${sessao.id}.json`), JSON.stringify(sessao), "utf-8");
}

export function listar_sessoes(): Session[] {
  garantir_dir();
  return readdirSync(SESSION_DIR)
    .filter(arquivo => arquivo.endsWith(".json"))
    .flatMap(arquivo => {
      try { return [JSON.parse(readFileSync(join(SESSION_DIR, arquivo), "utf-8")) as Session]; }
      catch { return []; }
    })
    .sort((a, b) => b.atualizado_em - a.atualizado_em);
}

export function deletar_sessao(id: string): void {
  try { unlinkSync(join(SESSION_DIR, `${id}.json`)); } catch {}
}

export function novo_id_sessao(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function titulo_sessao(messages: Message[]): string {
  const primeiro = messages.find(m => m.role === "user");
  if (!primeiro) return "Untitled";
  return primeiro.content.slice(0, 60).replace(/\n/g, " ");
}

export function data_relativa(ts: number): string {
  const diff_ms   = Date.now() - ts;
  const diff_mins = Math.floor(diff_ms / 60_000);
  if (diff_mins < 1)  return "just now";
  if (diff_mins < 60) return `${diff_mins}m ago`;
  const diff_h = Math.floor(diff_mins / 60);
  if (diff_h < 24) return `${diff_h}h ago`;
  const diff_d = Math.floor(diff_h / 24);
  if (diff_d < 7)  return `${diff_d}d ago`;
  return `${Math.floor(diff_d / 7)}w ago`;
}
