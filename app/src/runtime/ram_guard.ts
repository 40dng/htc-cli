export interface OpcoesRamGuard {
	limiteSoftMb: number;
	limiteHardMb: number;
	intervaloMs?: number;
	fonteMb?: () => number;
	aoSoft?: (usoMb: number) => void;
	aoHard?: (usoMb: number) => void;
}

export interface EstadoRamGuard {
	atualMb: number;
	picoMb: number;
	softDisparado: boolean;
	hardDisparado: boolean;
}

const INTERVALO_PADRAO_MS = 2000;
const BYTES_POR_MB = 1_048_576;

function rss_mb(): number {
	return Math.round(process.memoryUsage().rss / BYTES_POR_MB);
}

export interface RamGuard {
	parar: () => void;
	checar: () => void;
	estado: () => EstadoRamGuard;
}

export function iniciarRamGuard(opcoes: OpcoesRamGuard): RamGuard {
	const intervalo = opcoes.intervaloMs ?? INTERVALO_PADRAO_MS;
	const fonte = opcoes.fonteMb ?? rss_mb;
	let atual = 0;
	let pico = 0;
	let soft = false;
	let hard = false;

	const checar = (): void => {
		atual = fonte();
		if (atual > pico) pico = atual;
		if (!soft && atual >= opcoes.limiteSoftMb) {
			soft = true;
			opcoes.aoSoft?.(atual);
		}
		if (!hard && atual >= opcoes.limiteHardMb) {
			hard = true;
			opcoes.aoHard?.(atual);
		}
	};

	const timer = setInterval(checar, intervalo);
	timer.unref?.();
	checar();

	return {
		parar: () => clearInterval(timer),
		checar,
		estado: () => ({ atualMb: atual, picoMb: pico, softDisparado: soft, hardDisparado: hard }),
	};
}
