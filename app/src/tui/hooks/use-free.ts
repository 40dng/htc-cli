// language: TypeScript, file: src/tui/hooks/use-free.ts, runtime: bun/node
/**
 * HTC — canais free vistos pela sidebar (dsh / gemini).
 *
 * A sonda abre fetch em loopback, entao ela nao pode viver no caminho de
 * render: fica num efeito com intervalo + cache de modulo, para o re-render de
 * 2s do resto da sidebar nao multiplicar requisicao nem travar a UI quando o
 * endpoint local esta mudo.
 *
 * O mesmo efeito pede o boot dos canais (utils/free-boot): abrir o HTC com o
 * canal ligado sobe o processo e a primeira leitura ja pega o endpoint vivo.
 */
import { useEffect, useState } from "react";
import { subirCanaisFree } from "../../utils/free-boot";
import { candidatosFree, listarModelosDoCanal } from "../../utils/free-endpoints";

export type CanalFreeSidebar = "dsh" | "gemini";

export interface EstadoCanalFree {
	canal: CanalFreeSidebar;
	/** O canal existe na maquina (dsh instalado / porta do gemini declarada). */
	descoberto: boolean;
	vivo: boolean;
	base?: string;
	modelos: string[];
}

export interface EstadoFree {
	canais: EstadoCanalFree[];
}

const CANAIS: CanalFreeSidebar[] = ["dsh", "gemini"];
const INTERVALO_MS = 30_000;
const TIMEOUT_MS = 1200;

let cache: EstadoFree | undefined;
let cacheEm = 0;
let emVoo: Promise<EstadoFree> | undefined;

function semSonda(): EstadoCanalFree[] {
	return CANAIS.map((canal) => ({ canal, descoberto: false, vivo: false, modelos: [] }));
}

function vazio(): EstadoFree {
	return { canais: semSonda() };
}

async function sondarCanais(): Promise<EstadoCanalFree[]> {
	const candidatos = candidatosFree().filter(
		(c) => c.canal === "dsh" || c.canal === "gemini",
	);
	const vivos = await Promise.all(
		candidatos.map((c) => listarModelosDoCanal(c, TIMEOUT_MS)),
	);
	const porCanal = new Map<string, EstadoCanalFree>();
	candidatos.forEach((candidato, i) => {
		const vivo = vivos[i];
		if (!vivo || porCanal.has(candidato.canal)) return;
		porCanal.set(candidato.canal, {
			canal: candidato.canal as CanalFreeSidebar,
			descoberto: true,
			vivo: true,
			base: vivo.base,
			modelos: vivo.modelos,
		});
	});
	const presentes = new Set(candidatos.map((c) => c.canal));
	return CANAIS.map(
		(canal) =>
			porCanal.get(canal) ?? {
				canal,
				descoberto: presentes.has(canal),
				vivo: false,
				modelos: [],
			},
	);
}

async function sondar(): Promise<EstadoFree> {
	const canais = await sondarCanais().catch(() => semSonda());
	return { canais };
}

function renovar(): Promise<EstadoFree> {
	if (emVoo) return emVoo;
	if (cache && Date.now() - cacheEm < INTERVALO_MS) {
		return Promise.resolve(cache);
	}
	emVoo = sondar()
		.then((estado) => {
			cache = estado;
			cacheEm = Date.now();
			return estado;
		})
		.catch(() => cache ?? vazio())
		.finally(() => {
			emVoo = undefined;
		});
	return emVoo;
}

/** Estado dos canais free locais; `ativo=false` nao sonda nada. */
export function useFree(ativo = true): EstadoFree {
	const [estado, setEstado] = useState<EstadoFree>(() => cache ?? vazio());

	useEffect(() => {
		if (!ativo) return;
		let montado = true;
		const ciclo = () => {
			void renovar().then((novo) => {
				if (montado) setEstado(novo);
			});
		};
		ciclo();
		// Abrir o HTC com o canal ligado sobe o processo. Quando o boot termina,
		// o cache velho e descartado para a leitura seguinte ja ver a porta nova.
		void subirCanaisFree().then((resultados) => {
			if (!montado) return;
			if (resultados.some((r) => r.estado === "subiu")) cacheEm = 0;
			ciclo();
		});
		const id = setInterval(ciclo, INTERVALO_MS);
		return () => {
			montado = false;
			clearInterval(id);
		};
	}, [ativo]);

	return estado;
}

/** Porta do endpoint vivo — a URL inteira nao cabe na sidebar. */
export function portaDoBase(base?: string): string {
	if (!base) return "";
	try {
		return new URL(base).port;
	} catch {
		return "";
	}
}

