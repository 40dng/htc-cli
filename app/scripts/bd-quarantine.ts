// language: TypeScript, file: scripts/bd-quarantine.ts, runtime: bun
// Le a quarentena do Bitdefender (SQLite) para confirmar deteccoes independentes.
// Uso: bun run scripts/bd-quarantine.ts
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";

const caminhos = [
	"C:\\ProgramData\\Bitdefender\\Desktop\\Quarantine\\cache.db",
	"C:\\ProgramData\\Bitdefender\\Desktop\\Quarantine\\quarantine.db",
];

for (const caminho of caminhos) {
	if (!existsSync(caminho)) {
		console.log(`ausente: ${caminho}`);
		continue;
	}
	try {
		const db = new Database(caminho, { readonly: true });
		const tabelas = db
			.query("select name from sqlite_master where type='table'")
			.all() as Array<{ name: string }>;
		console.log(`${caminho} -> tabelas: ${tabelas.map((t) => t.name).join(", ")}`);
		for (const tabela of tabelas) {
			const n = db.query(`select count(*) as n from "${tabela.name}"`).get() as { n: number };
			if (!n?.n) continue;
			const linhas = db.query(`select * from "${tabela.name}" limit 5`).all();
			console.log(`\n[${tabela.name}] ${n.n} linha(s)`);
			for (const linha of linhas) console.log(JSON.stringify(linha).slice(0, 400));
		}
	} catch (erro) {
		console.log(`erro em ${caminho}: ${(erro as Error).message}`);
	}
}
