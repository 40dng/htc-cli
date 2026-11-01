// Leases vivas: quem segura qual alvo. Colisao = lease de outro processo.
import { useEffect, useState } from "react";
import { api } from "./api";
import { sessoes as sessoesLocais } from "./bus";

export type Lease = { alvo: string; dono: string; idade: number; nos: boolean; colisao: boolean };

export function useLeases(intervalo = 2000) {
	const [leases, setLeases] = useState<Lease[]>([]);

	useEffect(() => {
		let vivo = true;
		const carregar = async () => {
			const e = await api.egresso();
			if (!vivo) return;
			const agora = Math.floor(Date.now() / 1000);
			const lista = (e?.leases ?? []) as { host?: string; alvo?: string; dono?: string; desde?: number; criado_em?: number }[];
			setLeases(
				lista.map((l) => {
					const alvo = String(l.host ?? l.alvo ?? "?");
					const dono = String(l.dono ?? "?");
					const desde = Number(l.desde ?? l.criado_em ?? agora);
					const nos = sessoesLocais.has(alvo) || dono.startsWith(`runner-${process.pid}`) || dono.includes("htc-ops");
					return { alvo, dono, idade: Math.max(0, agora - desde), nos, colisao: !nos };
				}),
			);
		};
		void carregar();
		const i = setInterval(carregar, intervalo);
		return () => {
			vivo = false;
			clearInterval(i);
		};
	}, [intervalo]);

	return { leases, colisoes: leases.filter((l) => l.colisao).length };
}

export function idade(segundos: number) {
	const m = Math.floor(segundos / 60);
	const s = segundos % 60;
	return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
