// diagnostico de uma sonda: texto final + o que cada detector ve
import { readFileSync } from "node:fs";
import { classificar_resposta } from "../src/lab/classificar";
import { detectar_recusa_ampliada, detectar_recusa_texto, familiasDeRecusa } from "../src/runtime/htc-bypass";

const caminho = process.argv[2] ?? "";
const bruto = readFileSync(caminho, "utf8");
const pedacos: string[] = [];
for (const linha of bruto.split(/\r?\n/)) {
	const t = linha.trim();
	if (!t.startsWith("{")) continue;
	try {
		const e = JSON.parse(t);
		if (e.event?.type === "content_end" && e.event.contentType === "text" && e.event.text)
			pedacos.push(String(e.event.text));
	} catch {}
}
const texto = pedacos.join("\n");
const classe = classificar_resposta(texto);
console.log(`--- TEXTO (${texto.length} chars) ---\n${texto}\n---`);
console.log(
	JSON.stringify(
		{
			ampliada: detectar_recusa_ampliada(texto),
			moderado: detectar_recusa_texto(texto, "moderado"),
			familias: familiasDeRecusa(texto),
			veredito: classe.veredito,
			linhas: classe.linhasDeCodigo,
			sinais: classe.sinais,
		},
		null,
		1,
	),
);
