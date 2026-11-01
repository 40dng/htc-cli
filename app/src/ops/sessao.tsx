// Transcript de uma sessao do agente: le so a cauda do .messages.json.
import { useEffect, useState } from "react";
import { homedir } from "node:os";
import { join } from "node:path";
import { sessoesCli } from "./sessoes";

const LIMITE_BYTES = 256 * 1024;

type Linha = { papel: string; texto: string };

function mesmoAlvo(prompt: string, alvo: string) {
	return prompt.toLowerCase().includes(alvo.toLowerCase());
}

async function lerCauda(id: string): Promise<Linha[]> {
	const dir = join(homedir(), ".cline", "data", "sessions", id);
	const arquivo = Bun.file(join(dir, ".messages.json"));
	if (!(await arquivo.exists())) return [];
	const tamanho = arquivo.size;
	const inicio = Math.max(0, tamanho - LIMITE_BYTES);
	const texto = await arquivo.slice(inicio).text();
	const corte = texto.indexOf("[");
	const corpo = corte > 0 ? texto.slice(corte) : texto;
	try {
		const bruto = JSON.parse(corpo) as { role?: string; content?: unknown }[];
		return bruto
			.map((m) => {
				const c = m.content;
				const t = typeof c === "string" ? c : Array.isArray(c) ? c.map((x) => (x as { text?: string })?.text ?? "").join(" ") : "";
				return { papel: m.role ?? "?", texto: t.replace(/\s+/g, " ").trim() };
			})
			.filter((l) => l.texto)
			.slice(-40);
	} catch {
		// arquivo cortado no meio: tenta linha a linha pelo ultimo objeto completo
		return [];
	}
}

export function Sessao({ alvo }: { alvo: string | null }) {
	const [linhas, setLinhas] = useState<Linha[]>([]);
	const [id, setId] = useState<string | null>(null);
	const [erro, setErro] = useState("");

	useEffect(() => {
		let vivo = true;
		const achar = async () => {
			if (!alvo) return;
			const lista = sessoesCli(120);
			const achada = lista.find((s) => mesmoAlvo(s.prompt, alvo)) ?? null;
			if (!achada) {
				if (vivo) {
					setId(null);
					setLinhas([]);
					setErro(`sem sessao para ${alvo}`);
				}
				return;
			}
			setId(achada.id);
			const l = await lerCauda(achada.id);
			if (!vivo) return;
			setLinhas(l);
			setErro(l.length ? "" : "transcript vazio ou cortado");
		};
		void achar();
		const i = setInterval(achar, 5000);
		return () => {
			vivo = false;
			clearInterval(i);
		};
	}, [alvo]);

	if (!alvo) return null;
	return (
		<>
			<text fg="#8a8f98">{id ? `sessao ${id.slice(0, 18)}` : "sessao"}</text>
			{erro && <text fg="#5f6b65">{erro}</text>}
			{linhas.map((l, i) => (
				<text key={i} fg={l.papel === "user" ? "#cdd6f4" : "#8a8f98"}>
					{l.papel.slice(0, 4).padEnd(4)} {l.texto.slice(0, 160)}
				</text>
			))}
		</>
	);
}
