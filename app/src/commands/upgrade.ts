/**
 * HTC â€” upgrade
 *
 * Duas trilhas:
 *   htc     -> binario do proprio HTC (release em HTC_BASE)
 *   runtime -> runtime do cline; so muda quando o HTC solta release que o inclui
 *
 * O binario em execucao e substituido com swap (novo -> .new -> rename), entao
 * `htc upgrade` funciona no Windows, onde o exe fica travado enquanto roda.
 */
import { createHash } from "node:crypto";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { version as versaoAtual } from "../../package.json";
import { htcHome } from "./debug";

export interface UpgradeOptions {
	check?: boolean;
	force?: boolean;
}

function base(): string {
	// Default vivo (medido 01/11): a release publica os assets planos, entao
	// `/releases/latest/download` serve `<base>/<nome>` direto. O site estatico
	// antigo (prefeitodev.com/htc-cli) segue valido via HTC_BASE.
	return (
		process.env.HTC_BASE?.trim() ||
		"https://github.com/40dng/htc-cli/releases/latest/download"
	);
}

function canal(): string {
	return process.env.HTC_CHANNEL?.trim() || "latest";
}

/**
 * URLs candidatas para um nome do canal, na ordem:
 *   1. site estatico  -> `<base>/<canal>/<nome>`
 *   2. GitHub Release -> `<base>/<nome>` (e assim que
 *      `/releases/latest/download` serve os assets: namespace plano)
 *
 * O primeiro que responde vence, entao o layout de site estatico continua
 * identico e o canal do GitHub passa a funcionar sem env var nova.
 */
export function urlsDoCanal(nome: string): string[] {
	const raiz = base().replace(/\/+$/, "");
	const canalAtual = canal().replace(/^\/+|\/+$/g, "");
	const aninhada = `${raiz}/${canalAtual}/${nome}`;
	const plana = `${raiz}/${nome}`;
	return canalAtual && aninhada !== plana ? [aninhada, plana] : [plana];
}

function sufixoPlataforma(): string {
	const os =
		process.platform === "win32"
			? "windows"
			: process.platform === "darwin"
				? "darwin"
				: "linux";
	const arch = process.arch === "arm64" ? "arm64" : "x64";
	const musl =
		os === "linux" && existsSync("/etc/alpine-release") ? "-musl" : "";
	const ext = os === "windows" ? ".exe" : "";
	return `${os}-${arch}${musl}${ext}`;
}

async function baixar(url: string): Promise<Buffer | undefined> {
	try {
		const r = await fetch(url, { redirect: "follow" });
		if (!r.ok) return undefined;
		return Buffer.from(await r.arrayBuffer());
	} catch {
		return undefined;
	}
}

/**
 * Texto curto e confiavel (versao, runtime). Site estatico costuma devolver a
 * homepage com 200 para qualquer path â€” HTML aqui significa "nao existe".
 */
async function baixarTexto(url: string, limite = 64): Promise<string | undefined> {
	const buf = await baixar(url);
	if (!buf || buf.length === 0 || buf.length > limite) return undefined;
	const txt = buf.toString("utf8").trim();
	if (!txt || txt.includes("<") || /\s/.test(txt)) return undefined;
	return txt;
}

/** Texto do canal: tenta o layout aninhado e depois o plano. */
async function textoDoCanal(nome: string, limite = 64): Promise<string | undefined> {
	for (const url of urlsDoCanal(nome)) {
		const txt = await baixarTexto(url, limite);
		if (txt) return txt;
	}
	return undefined;
}

/** Arquivo do canal (binario, tar, SHA256SUMS): aninhado e depois plano. */
async function arquivoDoCanal(nome: string): Promise<Buffer | undefined> {
	for (const url of urlsDoCanal(nome)) {
		const buf = await baixar(url);
		if (buf && buf.length > 0) return buf;
	}
	return undefined;
}

/**
 * Hash declarado para um arquivo dentro de um SHA256SUMS (`<hash>  <nome>`).
 * Sem linha correspondente nao ha verificacao possivel — o chamador recusa.
 */
export function somaEsperada(
	somas: string,
	arquivo: string,
): string | undefined {
	const linha = somas
		.split(/\r?\n/)
		.find((l) => l.trim().endsWith(` ${arquivo}`));
	const hash = linha?.split(/\s+/)[0]?.toLowerCase();
	return hash && /^[0-9a-f]{64}$/.test(hash) ? hash : undefined;
}

function compararVersoes(a: string, b: string): number {
	const pa = a.split(".").map((n) => Number.parseInt(n, 10) || 0);
	const pb = b.split(".").map((n) => Number.parseInt(n, 10) || 0);
	for (let i = 0; i < 3; i += 1) {
		const d = (pa[i] ?? 0) - (pb[i] ?? 0);
		if (d !== 0) return d;
	}
	return 0;
}
/** Restos de execucao: .bun-* no temp, binarios .old e ~/.htc/tmp. */
export function limparLixo(): string[] {
	const home = htcHome();
	const limpos: string[] = [];

	const tmpLocal = join(home, "tmp");
	if (existsSync(tmpLocal)) {
		rmSync(tmpLocal, { recursive: true, force: true });
		limpos.push(tmpLocal);
	}

	const bin = join(home, "bin");
	if (existsSync(bin)) {
		for (const f of readdirSync(bin)) {
			if (f.endsWith(".old")) {
				try {
					unlinkSync(join(bin, f));
					limpos.push(join(bin, f));
				} catch {}
			}
		}
	}

	// .bun-*.dll/.so extraidos pelo runtime ao abrir o binario compilado
	const cutoff = Date.now() - 24 * 60 * 60 * 1000;
	let entradas: string[] = [];
	try {
		entradas = readdirSync(tmpdir());
	} catch {
		return limpos;
	}
	for (const nome of entradas) {
		if (!nome.startsWith(".bun-")) continue;
		const alvo = join(tmpdir(), nome);
		try {
			if (statSync(alvo).mtimeMs > cutoff) continue;
			rmSync(alvo, { recursive: true, force: true });
			limpos.push(alvo);
		} catch {}
	}
	return limpos;
}

async function atualizarRuntime(check: boolean): Promise<void> {
	const home = htcHome();
	const dir = join(home, "runtime");
	const marcador = join(dir, "version");
	const local = existsSync(marcador)
		? readFileSync(marcador, "utf8").trim()
		: "0.0.0";
	const remoto = await textoDoCanal("runtime.txt", 128);

	if (!remoto) {
		console.log("runtime  : sem runtime separado (viaja com o HTC)");
		return;
	}
	if (compararVersoes(remoto, local) <= 0) {
		console.log(`runtime  : ${local} (atual)`);
		return;
	}
	if (check) {
		console.log(`runtime  : ${local} -> ${remoto} (disponivel)`);
		return;
	}
	const pacote = await arquivoDoCanal(`runtime-${remoto}.tar`);
	if (!pacote) {
		console.log(`runtime  : ${remoto} anunciado, pacote ausente`);
		return;
	}
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, `runtime-${remoto}.tar`), pacote);
	writeFileSync(marcador, `${remoto}\n`);
	console.log(`runtime  : ${local} -> ${remoto}`);
}

export async function runUpgrade(opts: UpgradeOptions = {}): Promise<number> {
	const suf = sufixoPlataforma();
	const remoto = await textoDoCanal("version.txt");

	console.log(`HTC      : ${versaoAtual} (${suf})`);
	if (!remoto) {
		console.log(
			`release  : inalcancavel em ${base()} â€” nada a fazer (aponte HTC_BASE para o canal)`,
		);
		await atualizarRuntime(true);
		return 1;
	}
	console.log(`remoto   : ${remoto}`);

	if (compararVersoes(remoto, versaoAtual) <= 0 && !opts.force) {
		console.log("HTC      : ja na ultima versao");
		await atualizarRuntime(opts.check === true);
		const limpos = opts.check ? [] : limparLixo();
		if (limpos.length) console.log(`limpeza  : ${limpos.length} item(ns)`);
		return 0;
	}
	if (opts.check) {
		console.log(`HTC      : ${versaoAtual} -> ${remoto} (disponivel)`);
		await atualizarRuntime(true);
		return 0;
	}

	const arquivo = `htc-${suf}`;
	const binario = await arquivoDoCanal(arquivo);
	// Site estatico devolve a homepage com 200: binario valido nunca comeca com "<".
	const ehBinario = binario && binario.length > 1024 && binario[0] !== 0x3c;
	if (!ehBinario) {
		console.log(`falha    : ${arquivo} indisponivel na release`);
		return 1;
	}

	// Verificacao obrigatoria: sem SHA256SUMS nao ha como distinguir o binario
	// publicado de qualquer outro servido pela mesma base. Recusa antes de gravar.
	const somas = (await arquivoDoCanal("SHA256SUMS"))?.toString();
	if (!somas) {
		console.log("falha    : SHA256SUMS ausente no canal (download recusado)");
		return 1;
	}
	const esperado = somaEsperada(somas, arquivo);
	if (!esperado) {
		console.log(
			`falha    : SHA256SUMS sem linha para ${arquivo} (download recusado)`,
		);
		return 1;
	}
	const real = createHash("sha256").update(binario).digest("hex");
	if (real !== esperado) {
		console.log("falha    : checksum nao confere (download abortado)");
		return 1;
	}
	console.log("checksum : ok");

	const dirBin = join(htcHome(), "bin");
	mkdirSync(dirBin, { recursive: true });
	const destino = join(
		dirBin,
		process.platform === "win32" ? "htc.exe" : "htc",
	);
	const novo = `${destino}.new`;
	writeFileSync(novo, binario);
	if (process.platform !== "win32") chmodSync(novo, 0o755);

	// Windows nao deixa sobrescrever o exe em uso: move para .old e limpa depois.
	if (existsSync(destino)) {
		const velho = `${destino}.old`;
		rmSync(velho, { force: true });
		renameSync(destino, velho);
	}
	renameSync(novo, destino);
	console.log(`HTC      : atualizado (${basename(destino)})`);

	await atualizarRuntime(false);
	const limpos = limparLixo();
	if (limpos.length) console.log(`limpeza  : ${limpos.length} item(ns)`);
	console.log("pronto   : reabra o terminal se o binario estava em uso");
	return 0;
}


