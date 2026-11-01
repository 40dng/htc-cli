// HTC â€” release: compila o binario para todas as plataformas e gera SHA256SUMS.
// Uso: bun run scripts/release.mjs [versao]
import { createHash } from "node:crypto";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

const alvos = [
	["bun-windows-x64", "htc-windows-x64.exe"],
	["bun-darwin-x64", "htc-darwin-x64"],
	["bun-darwin-arm64", "htc-darwin-arm64"],
	["bun-linux-x64", "htc-linux-x64"],
	["bun-linux-arm64", "htc-linux-arm64"],
	["bun-linux-x64-musl", "htc-linux-x64-musl"],
	["bun-linux-arm64-musl", "htc-linux-arm64-musl"],
];

const versao = process.argv[2] || "latest";
const saida = join("dist", "release", versao);
mkdirSync(saida, { recursive: true });

const somas = [];
for (const [alvo, nome] of alvos) {
	const destino = join(saida, nome);
	console.log(`[release] ${alvo} -> ${destino}`);
	const proc = Bun.spawnSync([
		"bun",
		"build",
		"src/index.ts",
		"--compile",
		"--minify",
		"--sourcemap=none",
		"--external",
		"@cline/cline-hub",
		`--target=${alvo}`,
		`--outfile=${destino}`,
	]);
	if (proc.exitCode !== 0) {
		console.error(`[release] falhou ${alvo}`);
		console.error(proc.stderr?.toString() ?? "");
		continue;
	}
	const bytes = readFileSync(destino);
	const sha = createHash("sha256").update(bytes).digest("hex");
	const tamanho = statSync(destino).size;
	somas.push(`${sha}  ${nome}`);
	console.log(`[release] ok ${nome} ${(tamanho / 1048576).toFixed(1)} MB`);
}

writeFileSync(join(saida, "SHA256SUMS"), somas.join("\n") + "\n", "utf8");
writeFileSync(join(saida, "version.txt"), versao + "\n", "utf8");

// Trilha do runtime: o cline vai junto com a release do HTC. O cliente compara
// esta string com ~/.htc/runtime/version e so entao troca o runtime.
let coreCline = "0.0.0";
try {
	const pkg = JSON.parse(
		readFileSync("node_modules/@cline/core/package.json", "utf8"),
	);
	coreCline = pkg.version ?? coreCline;
} catch {}
writeFileSync(
	join(saida, "runtime.txt"),
	`${coreCline}+htc.${versao}\n`,
	"utf8",
);
console.log(`[release] runtime ${coreCline}+htc.${versao}`);

console.log(`[release] ${somas.length}/${alvos.length} binarios em ${saida}`);
// Instalacao local: sem isso o operador roda o binario ANTIGO do PATH e o
// build novo nao aparece (aconteceu em 22/10: `htc` era das 12:44).
try {
	const casa = process.env.USERPROFILE ?? process.env.HOME ?? "";
	const destino = join(casa, ".htc", "bin", process.platform === "win32" ? "htc.exe" : "htc");
	if (casa && existsSync(dirname(destino))) {
		const origem = join(saida, process.platform === "win32" ? "htc-windows-x64.exe" : "htc-linux-x64");
		if (existsSync(origem)) {
			copyFileSync(origem, destino);
			console.log(`[release] instalado ${destino}`);
		}
	}
} catch (erro) {
	console.warn(`[release] nao instalou a copia local: ${erro.message}`);
}
