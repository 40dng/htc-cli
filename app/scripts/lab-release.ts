// canal de release local: prova o caminho do `htc upgrade` sem host externo
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const raiz = join(import.meta.dir, "..", "dist", "release-lab");
const versao = "1.0.1";
const bin = join(import.meta.dir, "..", "dist", "htc.exe");
const somas: string[] = [];

for (const canal of [versao, "latest"]) {
	const dir = join(raiz, "htc-cli", canal);
	mkdirSync(dir, { recursive: true });
	copyFileSync(bin, join(dir, "htc-windows-x64.exe"));
	const h = createHash("sha256").update(readFileSync(join(dir, "htc-windows-x64.exe"))).digest("hex");
	somas.push(`${h}  htc-windows-x64.exe`);
	writeFileSync(join(dir, "version.txt"), `${versao}\n`);
	writeFileSync(join(dir, "runtime.txt"), `0.0.82+htc.${versao}\n`);
}
for (const canal of [versao, "latest"]) {
	writeFileSync(join(raiz, "htc-cli", canal, "SHA256SUMS"), `${somas.join("\n")}\n`);
}

if (!existsSync(join(raiz, "htc-cli", "xinstaller.ps1"))) {
	writeFileSync(join(raiz, "htc-cli", "xinstaller.ps1"), "# lab\n");
}

const servidor = Bun.serve({
	port: 8788,
	hostname: "127.0.0.1",
	async fetch(req) {
		const caminho = decodeURIComponent(new URL(req.url).pathname);
		const alvo = join(raiz, caminho);
		if (!alvo.startsWith(raiz) || !existsSync(alvo)) {
			return new Response("not found", { status: 404 });
		}
		return new Response(Bun.file(alvo));
	},
});

console.log(`lab em http://127.0.0.1:${servidor.port}/htc-cli versao ${versao}`);
console.log(`sha256 ${somas[0].split("  ")[0]}`);

// Layout de GitHub Releases: namespace PLANO. `/releases/latest/download/<asset>`
// nao tem subpasta de canal, entao o mesmo conteudo do canal `latest` tambem
// responde na raiz. E o que `urlsDoCanal` tenta em segundo lugar.
const flatDir = join(raiz, "htc-cli", "latest");
const plano = Bun.serve({
	port: 8799,
	hostname: "127.0.0.1",
	fetch(req) {
		const caminho = decodeURIComponent(new URL(req.url).pathname).replace(/^\/+/, "");
		const alvo = join(flatDir, caminho);
		if (!alvo.startsWith(flatDir) || !existsSync(alvo)) {
			return new Response("not found", { status: 404 });
		}
		return new Response(Bun.file(alvo));
	},
});
console.log(`plano (formato Releases) em http://127.0.0.1:${plano.port} versao ${versao}`);
