/**
 * HTC — sidebar
 *
 * Estrutura portada do TUI do OpenCode (`packages/tui/src/routes/session/sidebar.tsx`):
 * padding 1/2, header, corpo com secoes e footer com caminho de trabalho.
 * O runtime deles (Solid + slots + SDK) nao vem: aqui e React/OpenTUI com os
 * nossos dados.
 *
 * O painel mostra o que o runtime JA mede: missao (alvo, objetivo, fase, achados,
 * shell), FILA no disco (posicao, em curso, parados), PAYLOAD ativo (rotulo,
 * nivel), RTK ligado/desligado e GALHOS da sessao. Antes eram quatro linhas de
 * OPERACAO e um AGENTES que lia um campo que ninguem escrevia.
 *
 * Desligada por padrao: HTC_SIDEBAR=1 liga.
 */
import { useTerminalDimensions } from "@opentui/react";
import { useEffect, useState } from "react";
import { version } from "../../../package.json";
import { useSession } from "../contexts/session-context";
import { useFree, portaDoBase } from "../hooks/use-free";
import { useMaquina } from "../hooks/use-maquina";
import { useOperacao } from "../hooks/use-operacao";
import { useTheme } from "../hooks/use-theme";
import { palette } from "../palette";
import { lerPrefs } from "../../utils/prefs";
import { rtkLigado } from "../../utils/rtk";
import { truncateDisplay } from "../utils/display-width";
import { larguraSidebarEfetiva } from "../utils/largura-conteudo";
import { barra, sparkline } from "../utils/sparkline";
import { barraOitavos } from "../utils/chart";

/** Largura preferida da sidebar (prefs.sidebarLargura). Efetiva: `larguraSidebarEfetiva`. */
export const SESSION_SIDEBAR_WIDTH = 42;

/** Prefs sao lidas a cada render: useMaquina/useOperacao ja piscam a 1s. */
function usaLerPrefs() {
	return lerPrefs();
}

/**
 * Idade em uma coluna: "12s", "4m", "2h". A sidebar mostra ha quanto tempo o
 * estado foi escrito — sem isso um painel parado parece um painel vivo.
 */
function formatarIdade(segundos?: number): string {
	if (segundos === undefined || !Number.isFinite(segundos)) return "-";
	const s = Math.max(0, Math.round(segundos));
	if (s < 60) return `${s}s`;
	if (s < 3600) return `${Math.round(s / 60)}m`;
	if (s < 86400) return `${Math.round(s / 3600)}h`;
	return `${Math.round(s / 86400)}d`;
}

function idadeDe(iso?: string): number | undefined {
	if (!iso) return undefined;
	const t = Date.parse(iso);
	if (!Number.isFinite(t)) return undefined;
	return (Date.now() - t) / 1000;
}

/**
 * `rtkLigado` faz `where rtk` — spawn de processo. Fora do render: uma leitura a
 * cada 30s, cacheada no modulo.
 */
let cacheRtk: { em: number; on: boolean } | undefined;
function useRtk(): boolean {
	const [on, setOn] = useState<boolean>(() => cacheRtk?.on ?? false);
	useEffect(() => {
		const ler = () => {
			if (cacheRtk && Date.now() - cacheRtk.em < 30_000) {
				setOn(cacheRtk.on);
				return;
			}
			const ligado = rtkLigado();
			cacheRtk = { em: Date.now(), on: ligado };
			setOn(ligado);
		};
		ler();
		const id = setInterval(ler, 30_000);
		return () => clearInterval(id);
	}, []);
	return on;
}

function Secao(props: { titulo: string; cor: string; children: React.ReactNode }) {
	return (
		<box flexDirection="column" flexShrink={0}>
			<text fg={props.cor}>{props.titulo}</text>
			{props.children}
		</box>
	);
}

function Linha(props: { rotulo: string; valor: string; cor?: string }) {
	return (
		<box flexDirection="row" justifyContent="space-between" gap={1}>
			<text fg="gray">{props.rotulo}</text>
			<text fg={props.cor ?? "white"}>{props.valor}</text>
		</box>
	);
}

export function Sidebar() {
	const session = useSession();
	const theme = useTheme();
	const accent = theme.accents?.act ?? palette.act;
	const { width: termWidth } = useTerminalDimensions();
	const { atual, historico } = useMaquina(true);
	const operacao = useOperacao(true);

	const prefs = usaLerPrefs();
	const widget = prefs.sidebar;
	const free = useFree(widget.free);
	const rtk = useRtk();
	// Mesma funcao que o markdown usa para descontar a sidebar: duas formulas
	// diferentes era o que quebrava toda tabela com o painel ligado.
	const largura = larguraSidebarEfetiva(termWidth, prefs.sidebarLargura);
	const grafico = Math.max(8, largura - 8);
	const serieCpu = historico.map((a) => a.cpu);
	const carga = atual.load;
	const caminho = process.cwd().split(/[\\/]/).filter(Boolean).slice(-2).join("/");

	return (
		<box
			width={largura}
			height="100%"
			flexDirection="column"
			paddingTop={1}
			paddingBottom={1}
			paddingLeft={2}
			paddingRight={2}
		>
			<box flexShrink={0} paddingRight={2} paddingBottom={1}>
				<text fg={theme.defaultForeground ?? "white"}>
					{session.uiMode === "plan" ? "Plano" : "Ação"}
				</text>
			</box>

			<box flexDirection="column" gap={1} flexGrow={1} minHeight={0}>
				{widget.maquina ? (
					<Secao titulo="MÁQUINA" cor={accent}>
						<Linha rotulo="cpu" valor={`${String(atual.cpu).padStart(3)}%`} cor={accent} />
						<text fg={accent}>{sparkline(serieCpu, grafico)}</text>
						<Linha rotulo="ram" valor={`${String(atual.ram).padStart(3)}%`} />
						<text fg="gray">{barra(atual.ram / 100, grafico)}</text>
						<text fg={carga > 2 ? "#FFC000" : "gray"}>
							{`load ${carga.toFixed(2)}  ${barraOitavos(Math.min(1, carga / 4), grafico)}`}
						</text>
					</Secao>
				) : null}

				{widget.sessao ? (
					<Secao titulo="SESSÃO" cor={accent}>
						<Linha rotulo="tokens" valor={session.lastTotalTokens.toLocaleString("pt-BR")} />
						<Linha
							rotulo="custo"
							valor={`$${session.lastTotalCost.toFixed(2)}`}
							cor={session.lastTotalCost > 5 ? "#FFC000" : undefined}
						/>
						<Linha rotulo="estado" valor={session.isRunning ? "rodando" : "parado"} />
						<Linha rotulo="modo" valor={session.autoApproveAll ? "auto" : "manual"} />
					</Secao>
				) : null}

				{widget.operacao ? (
					<Secao titulo="OPERAÇÃO" cor={accent}>
						{operacao ? (
							<>
								<Linha
									rotulo="alvo"
									valor={truncateDisplay(operacao.alvo ?? "-", largura - 12)}
								/>
								<Linha rotulo="fase" valor={operacao.fase ?? "-"} />
								{operacao.objetivo ? (
									<text fg="gray">
										{truncateDisplay(operacao.objetivo, largura - 6)}
									</text>
								) : null}
								<Linha
									rotulo="achados"
									valor={`${operacao.validados ?? 0}/${operacao.findings ?? 0} ok`}
								/>
								<Linha
									rotulo="shell"
									valor={String(operacao.shells ?? 0)}
									cor={(operacao.shells ?? 0) > 0 ? "#4CC38A" : undefined}
								/>
								<Linha
									rotulo={operacao.fechada ? "missao" : "há"}
									valor={
										operacao.fechada
											? "fechada"
											: formatarIdade(idadeDe(operacao.atualizado))
									}
									cor={operacao.fechada ? "gray" : undefined}
								/>
								{/* FILA vive fora do espelho: state/fila.<sessao>.json. Sem
								    estas linhas a sidebar dizia "sem estado" com 7 alvos
								    na fila e um em curso. */}
								{operacao.fila ? (
									<>
										<Linha
											rotulo="fila"
											valor={`${operacao.fila.feito}/${operacao.fila.total}`}
										/>
										<Linha
											rotulo="curso"
											valor={`${operacao.fila.em_curso} · par ${operacao.fila.parado}`}
											cor={operacao.fila.parado > 0 ? "#FFC000" : undefined}
										/>
										{operacao.fila.atual ? (
											<text fg="gray">
												{truncateDisplay(operacao.fila.atual, largura - 6)}
											</text>
										) : null}
									</>
								) : null}
							</>
						) : (
							<text fg="gray">sem estado</text>
						)}
					</Secao>
				) : null}

				{widget.operacao ? (
					<Secao titulo="PAYLOAD" cor={accent}>
						<Linha
							rotulo="ativo"
							valor={operacao?.payload?.rotulo ?? "anon"}
							cor={accent}
						/>
						<Linha
							rotulo="nível"
							valor={String(operacao?.payload?.nivel ?? 1)}
							cor={(operacao?.payload?.nivel ?? 1) >= 3 ? "#FFC000" : undefined}
						/>
						<Linha rotulo="rtk" valor={rtk ? "on" : "off"} cor={rtk ? "#4CC38A" : "gray"} />
					</Secao>
				) : null}

				{widget.agentes ? (
					<Secao titulo="GALHOS" cor={accent}>
						{operacao?.galhos && operacao.galhos.total > 0 ? (
							<>
								<Linha rotulo="ativos" valor={String(operacao.galhos.total)} />
								{operacao.galhos.ultimo ? (
									<text fg="gray">
										{truncateDisplay(operacao.galhos.ultimo, largura - 6)}
									</text>
								) : null}
								<Linha rotulo="há" valor={formatarIdade(operacao.galhos.ha)} />
							</>
						) : operacao?.agentes && operacao.agentes.length > 0 ? (
							operacao.agentes.slice(0, 6).map((agente, i) => (
								<Linha
									key={`${agente.nome}-${i}`}
									rotulo={agente.nome}
									valor={agente.estado}
									cor={agente.estado === "rodando" ? "#4CC38A" : "gray"}
								/>
							))
						) : (
							<text fg="gray">nenhum</text>
						)}
					</Secao>
				) : null}

				{widget.free ? (
					<Secao titulo="FREE" cor={accent}>
						{free.canais.map((canal) => {
							const ligado = prefs.free[canal.canal];
							const porta = portaDoBase(canal.base);
							const valor = !ligado
								? "off"
								: !canal.descoberto
									? "n/a"
									: canal.vivo
										? porta
											? `:${porta}`
											: "on"
										: "mudo";
							const cor = !ligado || !canal.descoberto
								? "gray"
								: canal.vivo
									? (theme.accents?.success ?? "#4CC38A")
									: "#FFC000";
							return (
								<box key={canal.canal} flexDirection="column">
									<Linha rotulo={canal.canal} valor={valor} cor={cor} />
									{canal.vivo ? (
										<text fg="gray">
											{truncateDisplay(
												`${canal.modelos.length} mod · ${canal.modelos.slice(0, 2).join(", ")}`,
												largura - 6,
											)}
										</text>
									) : null}
								</box>
							);
						})}
					</Secao>
				) : null}
			</box>

			<box
				flexShrink={0}
				paddingTop={1}
				flexDirection="row"
				justifyContent="space-between"
				gap={1}
			>
				<text fg="gray">{truncateDisplay(caminho, largura - 12)}</text>
				<text fg={accent}>{`v${version}`}</text>
			</box>
		</box>
	);
}
