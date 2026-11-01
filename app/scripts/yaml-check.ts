// language: TypeScript, file: scripts/yaml-check.ts, runtime: Bun
// Valida o workflow e confere que o job de release publica exatamente os nomes
// que `htc upgrade` pede no canal plano. Uso:
//   bun app/scripts/yaml-check.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

const caminho = join(import.meta.dir, "..", "..", ".github", "workflows", "build.yml");
const doc = parse(readFileSync(caminho, "utf8")) as {
	on?: unknown;
	jobs?: Record<string, { needs?: string[] | string; if?: string; steps?: Array<{ run?: string }> }>;
};

const jobs = Object.keys(doc.jobs ?? {});
console.log(`yaml ok — jobs: ${jobs.join(", ")}`);

const release = doc.jobs?.release;
if (!release) {
	console.log("FALHA: job release ausente");
	process.exit(1);
}
const script = (release.steps ?? []).map((s) => s.run ?? "").join("\n");
const esperados = ["htc-windows-x64.exe", "version.txt", "SHA256SUMS"];
for (const nome of esperados) {
	if (!script.includes(nome)) {
		console.log(`FALHA: o job release nao publica ${nome}`);
		process.exit(1);
	}
}
console.log(`release: needs=${String(release.needs)} if=${release.if}`);
console.log(`assets: ${esperados.join(" ")}`);
