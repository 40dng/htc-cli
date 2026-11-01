// php2shell: fingerprint de PHP e das apps da lista, ANTES do PoC sair.
// CVE-2026-109618 / CVE-2026-109619 (CVSS 9.2). Advisory previsto 21/10 10h ET.
export type Fp = {
	host: string;
	php: string | null;
	app: string | null;
	versao: string | null;
	afetado: boolean;
	evidencia: string;
};

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** Versoes citadas na lista do advisory. */
const ALVOS: { app: string; versoes: RegExp }[] = [
	{ app: "WordPress", versoes: /^7\.1\.3$/ },
	{ app: "MediaWiki", versoes: /^1\.46\.2$/ },
	{ app: "phpBB", versoes: /^3\.3\.17$/ },
	{ app: "Magento", versoes: /^2\.4\.9$/ },
	{ app: "Laravel", versoes: /^(13\.|8\.)/ },
	{ app: "Symfony", versoes: /^8\.1\.9$/ },
	{ app: "Drupal", versoes: /^11\.4\.10$/ },
];

async function get(url: string, opts: RequestInit = {}) {
	try {
		const r = await fetch(url, { headers: { "user-agent": UA, ...(opts.headers as Record<string, string>) }, redirect: "manual", signal: AbortSignal.timeout(10000), ...opts });
		return { r, t: (await r.text()).slice(0, 400_000) };
	} catch {
		return null;
	}
}

export async function fingerprint(host: string): Promise<Fp> {
	const fp: Fp = { host, php: null, app: null, versao: null, afetado: false, evidencia: "" };

	const raiz = await get(`https://${host}/`);
	if (!raiz) return { ...fp, evidencia: "sem resposta" };
	const powered = raiz.r.headers.get("x-powered-by") ?? "";
	const cookie = raiz.r.headers.getSetCookie?.().join(" ") ?? "";
	const m = /PHP\/(\d+\.\d+(?:\.\d+)?)/i.exec(powered) ?? /PHP\/(\d+\.\d+)/i.exec(raiz.t);
	if (m) fp.php = m[1] ?? null;

	// detectores por app, 1 request cada e so quando o sinal aparece
	if (/wp-content|wp-includes/i.test(raiz.t) || /wordpress/i.test(cookie)) {
		fp.app = "WordPress";
		// versao: generator no feed > ?ver= na home > dashicons
		const feed = await get(`https://${host}/feed/`);
		let v = /<generator>https:\/\/wordpress\.org\/\?v=([0-9.]+)<\/generator>/i.exec(feed?.t ?? "")?.[1];
		v ??= /<meta name="generator" content="WordPress ([0-9.]+)"/i.exec(raiz.t)?.[1];
		v ??= /\?ver=([0-9]+\.[0-9]+(?:\.[0-9]+)?)/.exec(raiz.t)?.[1];
		fp.versao = v ?? null;
	} else if (/mediawiki/i.test(raiz.t) || /mw-|wgCanonicalSpecialPageName/.test(raiz.t)) {
		fp.app = "MediaWiki";
		const api = await get(`https://${host}/api.php?action=query&meta=siteinfo&format=json`);
		const j = api ? (() => { try { return JSON.parse(api.t) as { query?: { general?: { generator?: string } } }; } catch { return null; } })() : null;
		fp.versao = /MediaWiki (\d+\.\d+\.\d+)/.exec(j?.query?.general?.generator ?? "")?.[1] ?? null;
	} else if (/phpbb/i.test(raiz.t)) {
		fp.app = "phpBB";
		fp.versao = /phpBB (\d+\.\d+\.\d+)/i.exec(raiz.t)?.[1] ?? null;
	} else if (/magento/i.test(raiz.t) || /mage-|mage\/cookies/i.test(cookie)) {
		fp.app = "Magento";
	} else if (/laravel_session|XSRF-TOKEN/.test(cookie)) {
		fp.app = "Laravel";
	} else if (/drupal|sites\/default\/files|\/core\/misc\/drupal/i.test(raiz.t) || /S?SESS[a-f0-9]+=/i.test(cookie)) {
		fp.app = "Drupal";
		const ch = await get(`https://${host}/CHANGELOG.txt`);
		fp.versao = /Drupal (\d+\.\d+\.\d+)/.exec(ch?.t ?? "")?.[1] ?? null;
	} else if (/sf-toolbar|symfony/i.test(raiz.t) || /symfony/i.test(cookie)) {
		fp.app = "Symfony";
	}

	const alvo = ALVOS.find((a) => a.app === fp.app);
	fp.afetado = Boolean(alvo && fp.versao && alvo.versoes.test(fp.versao));
	fp.evidencia = [powered && `x-powered-by: ${powered}`, fp.php && `php ${fp.php}`, fp.app && `${fp.app} ${fp.versao ?? "?"}`]
		.filter(Boolean)
		.join(" · ");
	return fp;
}

if (import.meta.main) {
	const hosts = process.argv.slice(2);
	const fila = [...hosts];
	const out: Fp[] = [];
	await Promise.all(
		Array.from({ length: 4 }, async () => {
			for (;;) {
				const h = fila.shift();
				if (!h) return;
				out.push(await fingerprint(h));
			}
		}),
	);
	for (const f of out.sort((a, b) => Number(b.afetado) - Number(a.afetado))) {
		console.log(`${f.afetado ? "ALVO " : "     "} ${f.host.padEnd(30)} ${f.evidencia || "sem sinal"}`);
	}
	console.log(`\nphp detectado: ${out.filter((x) => x.php).length}/${out.length} · afetados: ${out.filter((x) => x.afetado).length}`);
}
