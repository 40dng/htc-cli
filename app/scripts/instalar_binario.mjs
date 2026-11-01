// HTC — postinstall: baixa o binario nativo da plataforma (padrao opencode).
// Pula com HTC_SKIP_DOWNLOAD=1. Nao falha o install: avisa e segue.
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(
	await import("node:fs/promises").then((fs) =>
		fs.readFile(join(raiz, "package.json"), "utf8"),
	),
);

const base = process.env.HTC_BASE?.trim() || "https://prefeitodev.com/htc-cli";
const versao = process.env.HTC_VERSION?.trim() || pkg.version || "latest";

function plataforma() {
	const p = process.platform;
	if (p === "darwin") return "darwin";
	if (p === "linux") return "linux";
	if (p === "win32") return "windows";
	throw new Error(`SO nao suportado: ${p}`);
}

function arch() {
	const a = process.arch;
	if (a === "x64") return "x64";
	if (a === "arm64") return "arm64";
	throw new Error(`arquitetura nao suportada: ${a}`);
}

async function baixar(url, destino) {
	const resp = await fetch(url);
	if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
	const buf = Buffer.from(await resp.arrayBuffer());
	if (buf.length < 1024) throw new Error("arquivo suspeito (muito pequeno)");
	mkdirSync(dirname(destino), { recursive: true });
	writeFileSync(destino, buf);
	if (process.platform !== "win32") chmodSync(destino, 0o755);
}

async function main() {
	if (process.env.HTC_SKIP_DOWNLOAD === "1") {
		console.log("[htc] download ignorado (HTC_SKIP_DOWNLOAD=1)");
		return;
	}
	const nome = `htc-${plataforma()}-${arch()}${process.platform === "win32" ? ".exe" : ""}`;
	const destino = join(raiz, "vendor", process.platform === "win32" ? "htc.exe" : "htc");
	if (existsSync(destino)) {
		console.log("[htc] binario ja presente");
		return;
	}
	for (const url of [`${base}/${versao}/${nome}`, `${base}/latest/${nome}`]) {
		try {
			await baixar(url, destino);
			console.log(`[htc] binario instalado: ${destino}`);
			return;
		} catch (erro) {
			console.log(`[htc] falhou ${url}: ${erro.message}`);
		}
	}
	console.log(
		"[htc] sem binario nativo. Rode do fonte: bun run src/index.ts (ou compile com bun run compile).",
	);
}

await main();
