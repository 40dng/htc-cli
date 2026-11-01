// language: TypeScript, file: src/utils/painel.ts, runtime: bun/node
/**
 * Onde vive o build estatico do painel. Uma funcao para os dois lados:
 * `htc kanban` (checagem) e `src/server/web.ts` (servir). No binario compilado
 * `import.meta.url` aponta para dentro do executavel, entao o caminho ao lado do
 * binario vem primeiro; no fonte, o repo.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function dirPainelBuild(env: NodeJS.ProcessEnv = process.env): string {
	const doRepo = fileURLToPath(new URL("../../web/out/", import.meta.url));
	const candidatos = [
		env.HTC_WEB_DIR?.trim(),
		join(dirname(process.execPath), "web", "out"),
		doRepo,
		join(process.cwd(), "web", "out"),
	].filter((c): c is string => !!c);
	for (const base of candidatos) {
		const dir = `${base.replace(/[\\/]+$/, "")}/`;
		if (existsSync(`${dir}index.html`)) return dir;
	}
	return `${candidatos[0].replace(/[\\/]+$/, "")}/`;
}
