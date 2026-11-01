// Cofre do barramento: toda mensagem OPS <-> CLI viaja cifrada e autenticada.
// AES-256-GCM com chave local (0600). O que passa no transporte chega intacto e puro.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const ARQ = join(homedir(), ".htc", "ops.key");
let cache: Buffer | null = null;

export function chave(): Buffer {
	if (cache) return cache;
	if (existsSync(ARQ)) {
		const b = readFileSync(ARQ);
		if (b.length !== 32) throw new Error("chave do cofre invalida (esperado 32 bytes)");
		cache = b;
		return b;
	}
	const nova = randomBytes(32);
	mkdirSync(dirname(ARQ), { recursive: true });
	writeFileSync(ARQ, nova, { mode: 0o600 });
	try {
		chmodSync(ARQ, 0o600);
	} catch {
		/* windows: a ACL do perfil ja restringe */
	}
	cache = nova;
	return nova;
}

export type Envelope = { v: 1; iv: string; tag: string; data: string };

export function selar(objeto: unknown): string {
	const iv = randomBytes(12);
	const c = createCipheriv("aes-256-gcm", chave(), iv);
	const claro = Buffer.from(JSON.stringify(objeto), "utf8");
	const cifrado = Buffer.concat([c.update(claro), c.final()]);
	const env: Envelope = {
		v: 1,
		iv: iv.toString("base64"),
		tag: c.getAuthTag().toString("base64"),
		data: cifrado.toString("base64"),
	};
	return JSON.stringify(env) + "\n";
}

export function abrir(linha: string): unknown {
	const env = JSON.parse(linha.trim()) as Envelope;
	if (env.v !== 1) throw new Error("envelope desconhecido");
	const d = createDecipheriv("aes-256-gcm", chave(), Buffer.from(env.iv, "base64"));
	d.setAuthTag(Buffer.from(env.tag, "base64"));
	const claro = Buffer.concat([d.update(Buffer.from(env.data, "base64")), d.final()]);
	return JSON.parse(claro.toString("utf8"));
}
