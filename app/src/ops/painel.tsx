// HTC OPS - operador. Fala com o broker (um cerebro), nao le banco.
import { createCliRenderer } from "@opentui/core";
import { createRoot, useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react";
import { useEffect, useMemo, useState } from "react";
import { type Egresso, type Frota, type Tarefa, api, assinar } from "./api";
import { idade, useLeases } from "./leases";
import { Sessao } from "./sessao";
import { sessoesCli } from "./sessoes";
import { cor, iconeBusca } from "./tema";

const n = (v: number) => new Intl.NumberFormat("pt-BR").format(v);
const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const FASES = ["recon", "surface", "enum", "vuln", "exploit", "privesc", "report"];
const SECOES = ["frota", "fila", "egress", "aprovacoes", "log", "sessoes", "leases"] as const;
type Secao = (typeof SECOES)[number];

const meter = (v: number, alvo: number, w = 8) => {
	const c = alvo > 0 ? Math.min(w, Math.round((v / alvo) * w)) : 0;
	return "█".repeat(c) + "░".repeat(Math.max(0, w - c));
};
const hora = (ts?: number) => new Date(ts ?? Date.now()).toLocaleTimeString("pt-BR");

function App() {
	const renderer = useRenderer();
	const { width, height } = useTerminalDimensions();
	const [aba, setAba] = useState<Secao>("frota");
	const [sel, setSel] = useState(0);
	const [busca, setBusca] = useState("");
	const [modo, setModo] = useState<"normal" | "busca" | "prompt" | "ajuda">("normal");
	const [aviso, setAviso] = useState("");
	const [online, setOnline] = useState(false);
	const [frota, setFrota] = useState<Frota | null>(null);
	const [egresso, setEgresso] = useState<Egresso | null>(null);
	const [tarefas, setTarefas] = useState<Tarefa[]>([]);
	const [aprov, setAprov] = useState<{ id: number; alvo: string; pedido: string; estado: string }[]>([]);
	const [log, setLog] = useState<string[]>([]);
	const [detalhe, setDetalhe] = useState<string[]>([]);
	const [pulso, setPulso] = useState(0);
	const [confirmacao, setConfirmacao] = useState<{ texto: string; acao: () => void } | null>(null);
	const { leases, colisoes } = useLeases();

	const push = (l: string) => setLog((x) => [...x.slice(-300), `${hora()} ${l}`]);

	useEffect(() => {
		let vivo = true;
		const carregar = async () => {
			const [f, e, t, a] = await Promise.all([api.frota(), api.egresso(), api.tarefas(), api.aprovacoes()]);
			if (!vivo) return;
			setOnline(f !== null);
			if (f) setFrota(f);
			if (e) setEgresso(e);
			if (t) setTarefas(t);
			if (a) setAprov(a);
		};
		void carregar();
		const i = setInterval(carregar, 2000);
		const s = setInterval(() => setPulso((p) => p + 1), 120);
		return () => {
			vivo = false;
			clearInterval(i);
			clearInterval(s);
		};
	}, []);

	useEffect(() => {
		if (!aviso) return;
		const t = setTimeout(() => setAviso(""), 6000);
		return () => clearTimeout(t);
	}, [aviso]);

	useEffect(() => {
		const parar = assinar((ev) => push(`${ev.alvo ?? "-"}  ${ev.tipo}${ev.msg ? ` ${ev.msg}` : ""}`));
		return parar;
	}, []);

	// carga inicial do log: sem isso a tela abre vazia e parece que nada aconteceu
	useEffect(() => {
		void api.log(200).then((r) => {
			if (!r?.eventos?.length) return;
			setLog(r.eventos.map((e) => `${e.domain ?? "-"} ${e.kind} ${e.message}`.slice(0, 150)));
		});
	}, []);

	const linhas = useMemo(() => {
		const q = busca.trim().toLowerCase();
		const casa = (t: string) => !q || t.toLowerCase().includes(q);
		if (aba === "frota") return (frota?.frota ?? []).filter((x) => casa(x.alvo));
		if (aba === "fila") return tarefas.filter((x) => casa(x.domain));
		if (aba === "egress") return (egresso?.pool ?? []).filter((x) => casa(`${x.tipo} ${x.host}`));
		if (aba === "aprovacoes") return aprov.filter((x) => casa(x.alvo));
		if (aba === "sessoes") return sessoesCli(120).filter((s) => casa(s.prompt) || casa(s.agente));
		if (aba === "leases") return leases.filter((l) => casa(l.alvo));
		return log.filter(casa).map((l) => ({ linha: l }));
	}, [aba, busca, frota, tarefas, egresso, aprov, log]);

	const alvoDa = (i: number): string | null => {
		const o = linhas[i] as Record<string, unknown> | undefined;
		if (!o) return null;
		if (aba === "frota") return String(o.alvo);
		if (aba === "fila") return String(o.domain);
		if (aba === "aprovacoes") return String(o.alvo);
		if (aba === "leases") return String(o.alvo);
		if (aba === "sessoes") {
			const p = String(o.prompt ?? "").toLowerCase();
			return (frota?.frota ?? []).find((f) => p.includes(f.alvo.toLowerCase()))?.alvo ?? null;
		}
		return null;
	};

	const corpo = Math.max(4, height - 9);
	const inicio = sel > corpo - 3 ? Math.max(0, sel - corpo + 3) : 0;
	const larguraSide = width < 100 ? 24 : 30;

	const executar = async (cmd: string) => {
		const alvo = alvoDa(sel);
		if (cmd === "d") {
			if (!alvo) return setAviso("secao sem alvo");
			return setConfirmacao({ texto: `disparar agente em ${alvo}?`, acao: () => void api.disparar(alvo).then((r) => setAviso(r ? `disparado ${alvo}` : "broker recusou (offline ou lease ocupada)")) });
		} else if (cmd === "k") {
			if (!alvo) return setAviso("secao sem alvo");
			return setConfirmacao({ texto: `liberar lease de ${alvo}?`, acao: () => void api.liberar(alvo).then(() => setAviso(`lease de ${alvo} liberada`)) });
		} else if (cmd === "f") {
			if (!alvo) return setAviso("secao sem alvo");
			const atual = detalhe.find((l) => l.startsWith("fase:"))?.split(":").slice(1).join(":").trim() ?? "";
			const prox = FASES[(FASES.indexOf(atual) + 1) % FASES.length];
			await api.fase(alvo, prox);
			setAviso(`${alvo}: fase ${prox}`);
			push(`fase ${alvo} -> ${prox}`);
		} else if (cmd === "a" || cmd === "x") {
			const a = aprov[0];
			if (!a) return setAviso("sem aprovacoes pendentes");
			await api.decidir(a.id, cmd === "a" ? "aprovado" : "negado");
			setAviso(`${cmd === "a" ? "aprovado" : "negado"} #${a.id} ${a.alvo}`);
			push(`${cmd === "a" ? "aprovado" : "negado"} ${a.alvo}`);
		} else if (cmd === "enter") {
			if (!alvo) return;
			const d = await api.alvo(alvo);
			setDetalhe(
				d
					? Object.entries(d).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v).slice(0, 180) : String(v)}`)
					: [`${alvo}: sem detalhe (broker offline?)`],
			);
		} else if (cmd === "s") {
			const s = await api.supply();
			setDetalhe(s ? Object.entries(s).map(([k, v]) => `${k}: ${JSON.stringify(v).slice(0, 200)}`) : ["broker offline"]);
		} else if (cmd === "m") {
			setAviso("monitor: varrendo LeakRadar");
			const r = await api.monitor();
			setDetalhe(
				r
					? [
							`perfil   ${r.perfil?.ok ? `ok · ${r.perfil.pontos} pontos` : (r.perfil?.motivo ?? "offline")}`,
							`varridos ${r.varridos ?? 0}`,
							"",
							...(r.novidades ?? []).length ? r.novidades!.map((n) => `${n.dominio}  +${n.delta}  (${n.antes} -> ${n.agora})`) : ["nada cresceu desde a ultima passada"],
						]
					: ["broker offline"],
			);
			setAviso(`monitor: ${r?.novidades?.length ?? 0} novidades`);
		} else if (cmd === "q") void renderer.destroy();
		else if ((SECOES as readonly string[]).includes(cmd)) {
			setAba(cmd as Secao);
			setSel(0);
			setDetalhe([]);
		}
	};

	useKeyboard((k: { name: string; sequence?: string; ctrl?: boolean }) => {
		const nome = k.name;
		if (confirmacao) {
			if (nome === "return") {
				confirmacao.acao();
				setConfirmacao(null);
			} else if (nome === "escape" || nome === "n") setConfirmacao(null);
			return;
		}
		if (modo === "busca" || modo === "prompt") {
			if (nome === "return") {
				const texto = busca.trim();
				const eraPrompt = modo === "prompt";
				setModo("normal");
				setBusca("");
				if (!eraPrompt) return setSel(0);
				const alvo = alvoDa(sel);
				if (!alvo || !texto) return setAviso("prompt sem alvo");
				if (texto.startsWith("/suprimento")) {
					setAviso("supply: medindo acervo");
					void api.suprimento(texto.replace("/suprimento", "").trim()).then((r) => {
						setDetalhe(
							r
								? [
										`pedido  ${(r.pedido ?? []).map((p) => `${p.qtd} ${p.tipo}`).join(" + ") || "-"}`,
										`medido  ${r.medido ?? 0}   vivos ${r.vivos ?? 0}`,
										"",
										...(r.resultado ?? []).length ? r.resultado! : ["nada vivo no acervo: veja a caca no CLI"],
									]
								: ["broker offline"],
						);
						setAviso(`supply: ${r?.vivos ?? 0} vivos de ${r?.medido ?? 0}`);
					});
					return;
				}
				void api.disparar(alvo, texto).then((r) => {
					setAviso(r ? `enviado a ${alvo}` : "broker recusou");
					push(`prompt ${alvo}: ${texto.slice(0, 40)}`);
				});
				return;
			}
			if (nome === "escape") {
				setBusca("");
				setModo("normal");
				return;
			}
			if (nome === "backspace") return setBusca((b) => b.slice(0, -1));
			if (k.sequence?.length === 1) setBusca((b) => b + k.sequence);
			return;
		}
		if (modo === "ajuda") {
			if (nome === "escape" || nome === "?" || nome === "return") setModo("normal");
			return;
		}
		if (nome === "q") return void renderer.destroy();
		if (nome === "?") return setModo("ajuda");
		if (nome === "/") {
			setBusca("");
			return setModo("busca");
		}
		if (nome === "i") {
			setBusca("");
			return setModo("prompt");
		}
		if (["1", "2", "3", "4", "5", "6", "7"].includes(nome)) {
			setAba(SECOES[Number(nome) - 1]!);
			setSel(0);
			setDetalhe([]);
			return;
		}
		if (nome === "tab") {
			const i = SECOES.indexOf(aba);
			setAba(SECOES[(i + 1) % SECOES.length]!);
			setSel(0);
			setDetalhe([]);
			return;
		}
		if (nome === "down" || nome === "j") return setSel((s) => Math.min(linhas.length - 1, s + 1));
		if (nome === "up" || nome === "k") return setSel((s) => Math.max(0, s - 1));
		if (nome === "escape") return setDetalhe([]);
		void executar(nome);
	});

	const content = () => {
		if (aba === "sessoes") return <Sessao alvo={alvoDa(sel)} />;
		if (detalhe.length) {
			return (
				<>
					<text fg={cor.texto}>detalhe</text>
					<text fg={cor.apagado}> </text>
					{detalhe.slice(0, corpo).map((l, i) => (
						<text key={i} fg={cor.texto}>
							{l}
						</text>
					))}
					<text fg={cor.apagado}> </text>
					<text fg={cor.apagado}>esc volta</text>
				</>
			);
		}
		return (
			<>
				<box flexDirection="row" justifyContent="space-between">
					<text fg={cor.texto}>
						{aba}
						<span fg={cor.apagado}>{`  ${linhas.length ? `${Math.min(sel + 1, linhas.length)} de ${linhas.length}` : "vazio"}`}</span>
					</text>
					<text fg={cor.apagado}>{aba === "frota" ? "d dispara · k libera lease · f fase · i prompt" : aba === "aprovacoes" ? "a aprova · x nega" : ""}</text>
				</box>
				<text fg={cor.apagado}> </text>
				{linhas.slice(inicio, inicio + corpo).map((l, i) => {
					const idx = inicio + i;
					const o = l as Record<string, unknown>;
					const txt =
						aba === "frota"
							? `${String(o.alvo).padEnd(32)} a${String(o.assets).padEnd(4)} v${String(o.validados).padEnd(4)} x${o.exploitable}`
							: aba === "fila"
								? `#${o.id} ${String(o.domain).padEnd(30)} ${String(o.status).padEnd(10)} p${o.priority}`
								: aba === "egress"
									? `${String(o.tipo).padEnd(6)} ${String(o.host).padEnd(34)} ${String(o.status).padEnd(9)} s${o.score}`
									: aba === "aprovacoes"
										? `#${o.id} ${String(o.alvo).padEnd(28)} ${String(o.estado)}`
										: aba === "leases"
											? `${String(o.alvo).padEnd(30)} ${String(o.dono).padEnd(12)} ${idade(Number(o.idade))}${o.colisao ? "  COLISAO" : ""}`
											: String(o.linha ?? "");
					return (
						<box key={idx} flexDirection="row" onMouseDown={() => setSel(idx)}>
							<text fg={idx === sel ? cor.texto : cor.apagado}>
								{idx === sel ? "▍" : " "}
								{txt}
							</text>
						</box>
					);
				})}
				{linhas.length === 0 && <text fg={cor.apagado}>  nada aqui</text>}
			</>
		);
	};

	return (
		<box flexDirection="column" width="100%" height="100%" backgroundColor={cor.fundo}>
			<box flexDirection="row" paddingX={2} height={1} justifyContent="space-between" flexShrink={0}>
				<text fg={cor.texto}>
					<span fg={cor.acao}>htc</span> ops<span fg={cor.apagado}>{`  ${aba}${online ? "" : "  · broker offline"}`}</span>
				</text>
				<text fg={cor.apagado}>
					{FRAMES[pulso % FRAMES.length]} {modo === "normal" ? "" : `${modo} · `}
					{hora()}
				</text>
			</box>

			<box flexDirection="row" flexGrow={1} minHeight={0}>
				<box width={larguraSide} flexDirection="column" backgroundColor={cor.card} paddingX={2} paddingY={1} flexShrink={0}>
					{SECOES.map((s, i) => (
						<box key={s} flexDirection="row" justifyContent="space-between" onMouseDown={() => (setAba(s), setSel(0), setDetalhe([]))}>
							<text fg={s === aba ? cor.texto : cor.apagado}>
								{s === aba ? "▍" : " "}
								{s}
							</text>
							<text fg={cor.apagado}>{i + 1}</text>
						</box>
					))}
					<box flexGrow={1} />
					<text fg={cor.apagado}>frente</text>
					<text fg={cor.texto}>{n(frota?.resumo.alvos ?? 0)} alvos</text>
					<text fg={cor.texto}>{n(frota?.resumo.validados ?? 0)} val</text>
					<text fg={cor.texto}>{n(frota?.resumo.exploitable ?? 0)} expl</text>
					<text fg={(frota?.resumo.shells ?? 0) > 0 ? cor.ok : cor.erro}>{n(frota?.resumo.shells ?? 0)} shell</text>
				</box>

				<box width={1} flexShrink={0} backgroundColor={cor.borda} />

				<box flexDirection="column" flexGrow={1} paddingX={2} paddingY={1} minWidth={0}>
					{content()}
				</box>
			</box>

			<box flexDirection="row" paddingX={2} height={1} flexShrink={0}>
				<text fg={cor.acao}>{modo === "prompt" ? "prompt> " : modo === "busca" ? "/ " : "> "}</text>
				<text fg={busca ? cor.texto : cor.apagado}>
					{busca || (modo === "prompt" ? "instrucao para o agente deste alvo" : "i prompt · / busca · ctrl+k · ? teclas")}
				</text>
			</box>

			<box flexDirection="row" paddingX={2} height={1} justifyContent="space-between" flexShrink={0}>
				<text fg={cor.apagado}>1-7 tab · j/k · d · k(lease) · f(fase) · s(supply) · a/x · q</text>
				<text fg={aviso ? cor.alerta : cor.apagado}>
					{aviso || (online ? `${n(egresso?.pool.length ?? 0)} contas · ${tarefas.length} tasks · ${aprov.length} aprovacoes` : "rode: htc-cli serve")}
				</text>
			</box>

			{confirmacao && (
				<box
					position="absolute"
					top={Math.max(3, Math.floor(height / 3))}
					left={Math.max(2, Math.floor(width / 2) - 24)}
					width={50}
					border
					borderStyle="rounded"
					borderColor={cor.borda}
					title="confirmar"
					paddingX={1}
					backgroundColor={cor.card}
				>
					<text fg={cor.texto}>{confirmacao.texto}</text>
					<text fg={cor.apagado}> </text>
					<text fg={cor.apagado}>enter confirma · esc/n cancela</text>
				</box>
			)}

			{modo === "ajuda" && (
				<box position="absolute" top={Math.max(2, Math.floor(height / 3))} left={Math.max(2, Math.floor(width / 2) - 24)} width={52} border borderStyle="rounded" borderColor={cor.borda} title="teclas" paddingX={1} backgroundColor={cor.card}>
					<text fg={cor.texto}>i      prompt livre para o alvo</text>
					<text fg={cor.texto}>/      filtrar</text>
					<text fg={cor.texto}>d      disparar agente no alvo</text>
					<text fg={cor.texto}>k      liberar lease (para o agente)</text>
					<text fg={cor.texto}>f      proxima fase</text>
					<text fg={cor.texto}>a / x  aprovar / negar pedido</text>
					<text fg={cor.texto}>s      supply do broker</text>
					<text fg={cor.apagado}>mouse: clique seleciona</text>
				</box>
			)}
		</box>
	);
}

export async function rodar() {
	const renderer = await createCliRenderer({
		exitOnCtrlC: true,
		autoFocus: true,
		enableMouseMovement: true,
		useKittyKeyboard: { disambiguate: false, alternateKeys: false },
	} as never);
	createRoot(renderer).render(<App />);
	await new Promise<void>((ok) => renderer.on("destroy", ok));
	process.exit(0);
}
