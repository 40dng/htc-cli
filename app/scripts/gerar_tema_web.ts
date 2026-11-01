// language: TypeScript, file: scripts/gerar_tema_web.ts, runtime: bun
/**
 * Gera o tema do painel web a partir das fontes do CLI.
 *
 * Fonte unica: `src/paleta.ts` (marca) e `src/runtime/missao.ts` (fases).
 * Saida: `web/app/tokens.css` e `web/lib/fases.json`. Nunca editar a saida a
 * mao — rode `bun run scripts/gerar_tema_web.ts` depois de mudar a marca/fases.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { paleta } from "../src/paleta";
import { FASES, type FaseMissao } from "../src/runtime/missao";

const raiz = join(import.meta.dir, "..");
const web = join(raiz, "web");

// Superficies fixas do painel (o TUI deriva do terminal; o web precisa de valor
// fixo). Ficam AQUI, unicas, para nenhum componente carregar hex solto.
const superficies = {
	background: "#0b0a0b",
	foreground: "#efe9ea",
	card: "#131011",
	popover: "#171314",
	secondary: "#1a1517",
	muted: "#1a1517",
	"muted-foreground": "#a39397",
	border: "#2a2124",
	input: "#332629",
	icon: "#7d6f73",
	subtle: "#0e0c0d",
	info: "#5aa9ff",
} as const;

const faseCor: Record<FaseMissao, string> = {
	recon: "var(--info)",
	enum: "var(--info)",
	vetor: "var(--warning)",
	exploit: "var(--brand-2)",
	shell: "var(--success)",
	pos: "var(--brand)",
};

const faseRotulo: Record<FaseMissao, string> = {
	recon: "recon",
	enum: "enum",
	vetor: "vetor",
	exploit: "exploit",
	shell: "shell",
	pos: "pos",
};

const linhas = [
	"/* GERADO por scripts/gerar_tema_web.ts — nao editar a mao.",
	"   Fonte: src/paleta.ts + src/runtime/missao.ts */",
	":root {",
	`  --brand: ${paleta.act};`,
	`  --brand-2: ${paleta.plan};`,
	`  --selection: ${paleta.act};`,
	`  --success: ${paleta.success};`,
	`  --danger: ${paleta.error};`,
	`  --error: ${paleta.error};`,
	`  --warning: #E8B04B;`,
	...Object.entries(superficies).map(([k, v]) => `  --${k}: ${v};`),
	"",
	"  /* fases da missao (mesma ordem do runtime) */",
	...FASES.map((f) => `  --phase-${f}: ${faseCor[f]};`),
	"}",
	"",
];

writeFileSync(join(web, "app", "tokens.css"), `${linhas.join("\n")}\n`, "utf8");

const fases = FASES.map((f) => ({
	id: f,
	rotulo: faseRotulo[f],
	cor: `var(--phase-${f})`,
}));
writeFileSync(join(web, "lib", "fases.json"), `${JSON.stringify(fases, null, 2)}\n`, "utf8");

console.log(`tokens: ${Object.keys(superficies).length + 7} vars · fases: ${FASES.join(", ")}`);
