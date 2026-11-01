import { useEffect, useRef, useState } from "react";
import { cpus, freemem, loadavg, totalmem } from "node:os";

export type AmostraMaquina = {
	cpu: number;
	ram: number;
	load: number;
};

const AMOSTRAS = 40;

function lerTemposCpu(): { idle: number; total: number } {
	let idle = 0;
	let total = 0;
	for (const cpu of cpus()) {
		const t = cpu.times;
		idle += t.idle;
		total += t.user + t.nice + t.sys + t.idle + t.irq;
	}
	return { idle, total };
}

/** CPU/RAM/load da maquina, amostrado a cada 2s (historico curto p/ sparkline). */
export function useMaquina(ativo = true): {
	atual: AmostraMaquina;
	historico: AmostraMaquina[];
} {
	const [historico, setHistorico] = useState<AmostraMaquina[]>([]);
	const anterior = useRef(lerTemposCpu());

	useEffect(() => {
		if (!ativo) return;
		const id = setInterval(() => {
			const agora = lerTemposCpu();
			const dTotal = agora.total - anterior.current.total;
			const dIdle = agora.idle - anterior.current.idle;
			anterior.current = agora;
			const cpu = dTotal > 0 ? ((dTotal - dIdle) / dTotal) * 100 : 0;
			const ram = ((totalmem() - freemem()) / totalmem()) * 100;
			const load = loadavg()[0] ?? 0;
			setHistorico((anteriorHistorico) =>
				[
					...anteriorHistorico,
					{
						cpu: Math.round(cpu),
						ram: Math.round(ram),
						load: Number(load.toFixed(2)),
					},
				].slice(-AMOSTRAS),
			);
		}, 2000);
		return () => clearInterval(id);
	}, [ativo]);

	const atual = historico[historico.length - 1] ?? { cpu: 0, ram: 0, load: 0 };
	return { atual, historico };
}
