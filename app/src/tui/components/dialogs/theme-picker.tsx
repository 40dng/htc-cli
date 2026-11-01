import { useTerminalDimensions } from "@opentui/react";
import type { ChoiceContext } from "@opentui-ui/dialog";
import { useDialogKeyboard } from "@opentui-ui/dialog/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useDialogPalette, useThemeController } from "../../hooks/use-theme";
import {
	apagarTemaCustom,
	criarTemaCustom,
	diretorioDeTemas,
	exportarTemaCustom,
	importarTemasCustom,
	recarregarTemasCustom,
} from "../../themes-custom";
import {
	avisosDeTemas,
	getThemeSwatchColors,
	isBuiltinTheme,
	listThemes,
	temaComoCustom,
} from "../../themes";

const SWATCH_BLOCK = "\u25a0";

interface ItemDoPicker {
	chave: string;
	label: string;
	descricao: string;
	swatches: string[];
	criar?: boolean;
}

type CampoDoTema = {
	chave: "label" | "background" | "foreground" | "act" | "plan" | "success" | "error" | "tableBorder";
	rotulo: string;
	cor?: boolean;
};

/** Ordem do formulario: nome primeiro, depois as cores na ordem que aparece na tela. */
const CAMPOS: CampoDoTema[] = [
	{ chave: "label", rotulo: "nome" },
	{ chave: "background", rotulo: "fundo", cor: true },
	{ chave: "foreground", rotulo: "texto", cor: true },
	{ chave: "act", rotulo: "act", cor: true },
	{ chave: "plan", rotulo: "plan", cor: true },
	{ chave: "success", rotulo: "success", cor: true },
	{ chave: "error", rotulo: "error", cor: true },
	{ chave: "tableBorder", rotulo: "grade da tabela", cor: true },
];

const HEX = /^#[0-9a-fA-F]{6}$/;

export function ThemePickerContent(props: ChoiceContext<string>) {
	const { resolve, dismiss, dialogId } = props;
	const { height } = useTerminalDimensions();
	const controller = useThemeController();
	const palette = useDialogPalette();
	// `versao` forca re-leitura da pasta: criar/apagar/importar no meio do dialogo
	// tem de mudar a LISTA na hora, nao so o disco.
	const [versao, setVersao] = useState(0);
	const [aviso, setAviso] = useState<string | undefined>(undefined);
	const [modo, setModo] = useState<"lista" | "form">("lista");
	const [campo, setCampo] = useState(0);
	const [valores, setValores] = useState<Record<string, string>>({});
	const avisos = useMemo(() => avisosDeTemas(), [versao]);
	const itens = useMemo<ItemDoPicker[]>(() => {
		const lista: ItemDoPicker[] = listThemes().map((theme) => ({
			chave: theme.id,
			label: theme.label,
			descricao:
				theme.description + (isBuiltinTheme(theme.id) ? "" : "  [custom]"),
			swatches: getThemeSwatchColors(theme),
		}));
		lista.push({
			chave: "__criar__",
			label: "+ novo tema custom",
			descricao: diretorioDeTemas(),
			swatches: [],
			criar: true,
		});
		return lista;
	}, [versao]);

	const [selected, setSelected] = useState(() => {
		const index = itens.findIndex(
			(item) => item.chave === controller.selectedThemeId,
		);
		return index >= 0 ? index : 0;
	});

	const selectedRef = useRef(selected);
	selectedRef.current = selected;
	const controllerRef = useRef(controller);
	controllerRef.current = controller;
	const itensRef = useRef(itens);
	itensRef.current = itens;
	const estadoRef = useRef({ modo, campo, valores });
	estadoRef.current = { modo, campo, valores };

	/** Abre o formulario pre-preenchido com o tema ativo (editar em cima). */
	const abrirFormulario = () => {
		const atual = controllerRef.current.theme;
		const base = temaComoCustom(atual);
		setValores({
			label: `${atual.label} custom`,
			background: (base.background ?? "#0d0d0d").toLowerCase(),
			foreground: (base.foreground ?? "#e8eaed").toLowerCase(),
			act: (base.accents?.act ?? atual.accents.act).toLowerCase(),
			plan: (base.accents?.plan ?? atual.accents.plan).toLowerCase(),
			success: (base.accents?.success ?? atual.accents.success).toLowerCase(),
			error: (base.accents?.error ?? atual.accents.error).toLowerCase(),
			tableBorder: (base.ui?.tableBorder ?? "#2a3340").toLowerCase(),
		});
		setCampo(0);
		setAviso(undefined);
		setModo("form");
	};

	const cor = (valor: string | undefined, fallback: string): string =>
		valor && HEX.test(valor.trim()) ? valor.trim().toLowerCase() : fallback;

	const salvarFormulario = () => {
		const atual = controllerRef.current.theme;
		const base = temaComoCustom(atual);
		const criado = criarTemaCustom({
			base: {
				...base,
				label: (valores.label ?? "").trim() || "Meu tema",
				description: "Criado no /theme",
				background: cor(valores.background, base.background ?? "#0d0d0d"),
				foreground: cor(valores.foreground, base.foreground ?? "#e8eaed"),
				accents: {
					...base.accents,
					act: cor(valores.act, atual.accents.act),
					plan: cor(valores.plan, atual.accents.plan),
					success: cor(valores.success, atual.accents.success),
					error: cor(valores.error, atual.accents.error),
				},
				ui: {
					...base.ui,
					tableBorder: cor(valores.tableBorder, "#2a3340"),
				},
			},
		});
		if (!criado) {
			setAviso(`nao consegui salvar em ${diretorioDeTemas()}`);
			return;
		}
		recarregarTemasCustom();
		setVersao((v) => v + 1);
		setModo("lista");
		setAviso(`salvo: ${criado.caminho}`);
		controllerRef.current.setThemeId(criado.id);
	};

	// Live preview: moving the selection repaints the whole TUI with the
	// highlighted theme so users see exactly what they would get.
	useEffect(() => {
		const item = itens[selected];
		if (item && !item.criar) {
			controllerRef.current.previewThemeId(item.chave);
		} else {
			controllerRef.current.previewThemeId(null);
		}
	}, [selected, itens]);

	// Clear any dangling preview when the dialog closes without a confirm
	// (escape, backdrop click, dialog replaced). setThemeId already clears the
	// preview on confirm, so this is a no-op in that path.
	useEffect(() => {
		return () => {
			controllerRef.current.previewThemeId(null);
		};
	}, []);

	useDialogKeyboard((key) => {
		const estado = estadoRef.current;
		if (estado.modo === "form") {
			if (key.name === "escape") {
				setModo("lista");
				setAviso(undefined);
				return;
			}
			if (key.name === "tab") {
				const passo = key.shift ? CAMPOS.length - 1 : 1;
				setCampo((atual) => (atual + passo) % CAMPOS.length);
				return;
			}
			if (key.name === "return" || key.name === "enter") {
				if (estado.campo >= CAMPOS.length - 1) {
					salvarFormulario();
				} else {
					setCampo((atual) => Math.min(CAMPOS.length - 1, atual + 1));
				}
				return;
			}
			if (key.name === "backspace") {
				const chave = CAMPOS[estado.campo].chave;
				setValores((atual) => ({
					...atual,
					[chave]: (atual[chave] ?? "").slice(0, -1),
				}));
				return;
			}
			// Texto: `sequence` traz o caractere imprimivel do teclado.
			const seq = key.sequence;
			if (seq && seq.length === 1 && !key.ctrl && !key.meta && seq >= " ") {
				const chave = CAMPOS[estado.campo].chave;
				setValores((atual) => ({ ...atual, [chave]: (atual[chave] ?? "") + seq }));
			}
			return;
		}

		if (key.name === "escape") {
			dismiss();
			return;
		}
		const item = itensRef.current[selectedRef.current];
		// Acoes laterais, igual ao /history: esquerda apaga, direita exporta.
		if (key.name === "left") {
			if (!item || item.criar) {
				setAviso("selecione um tema custom para apagar");
				return;
			}
			if (isBuiltinTheme(item.chave)) {
				setAviso("tema embutido nao pode ser apagado");
				return;
			}
			if (apagarTemaCustom(item.chave)) {
				recarregarTemasCustom();
				setVersao((v) => v + 1);
				setAviso(`apagado: ${item.chave}`);
			} else {
				setAviso(`nao consegui apagar ${item.chave}`);
			}
			return;
		}
		if (key.name === "right") {
			if (!item || item.criar) {
				setAviso("selecione um tema para exportar");
				return;
			}
			if (isBuiltinTheme(item.chave)) {
				// Embutido nao tem arquivo: exporta o RESOLVIDO como novo tema.
				const base = temaComoCustom(controllerRef.current.theme, {
					label: item.label,
					description: "Exportado do HTC",
				});
				const criado = criarTemaCustom({ base });
				const caminho = criado
					? exportarTemaCustom(criado.id)
					: undefined;
				setAviso(
					caminho
						? `exportado: ${caminho}`
						: `nao consegui exportar ${item.chave}`,
				);
				return;
			}
			const caminho = exportarTemaCustom(item.chave);
			setAviso(
				caminho ? `exportado: ${caminho}` : `nao consegui exportar ${item.chave}`,
			);
			return;
		}
		if (key.name === "i") {
			const { importados, avisos: falhas } = importarTemasCustom();
			recarregarTemasCustom();
			setVersao((v) => v + 1);
			setAviso(
				importados.length > 0
					? `importado: ${importados.join(", ")}`
					: (falhas[0] ?? "nada importado"),
			);
			return;
		}
		if (key.name === "return" || key.name === "enter") {
			if (!item) return;
			if (item.criar) {
				abrirFormulario();
				return;
			}
			controllerRef.current.setThemeId(item.chave);
			resolve(item.chave);
			return;
		}
		const totalItens = itensRef.current.length;
		if (key.name === "up") {
			setSelected((index) => (index <= 0 ? totalItens - 1 : index - 1));
			return;
		}
		if (key.name === "down") {
			setSelected((index) => (index >= totalItens - 1 ? 0 : index + 1));
		}
	}, dialogId);

	const maxVisible = Math.max(3, height - 12);
	const total = itens.length;
	const start = Math.max(
		0,
		Math.min(
			selected - Math.floor(maxVisible / 2),
			Math.max(0, total - maxVisible),
		),
	);
	const visiveis = itens.slice(start, start + maxVisible);
	// Selection prefix (2 cells) + longest label + separating gap.
	const labelWidth = Math.max(...itens.map((item) => item.label.length)) + 4;

	if (modo === "form") {
		return (
			<box flexDirection="column" gap={1}>
				<box flexDirection="row" justifyContent="space-between">
					<text fg="white">
						<strong>Novo tema</strong>
					</text>
					<text fg={palette.muted}>tab avanca · enter salva · esc volta</text>
				</box>
				<box flexDirection="column">
					{CAMPOS.map((definicao, indice) => {
						const ativo = indice === campo;
						const valor = valores[definicao.chave] ?? "";
						const valido = !definicao.cor || HEX.test(valor.trim());
						return (
							<box key={definicao.chave} flexDirection="row" height={1}>
								<text fg={ativo ? palette.textOnSelection : palette.muted}>
									{(ativo ? "\u276f " : "  ") + definicao.rotulo.padEnd(16)}
								</text>
								<text fg={ativo ? palette.textOnSelection : "white"}>
									{valor || "(vazio)"}
								</text>
								{definicao.cor ? (
									<text fg={valido ? valor.trim() : palette.error}>
										{`  ${SWATCH_BLOCK} ${valido ? "" : "hex #rrggbb"}`}
									</text>
								) : null}
							</box>
						);
					})}
				</box>
				{aviso ? <text fg={palette.warn}>{aviso}</text> : null}
			</box>
		);
	}

	return (
		<box flexDirection="column" gap={1}>
			<box flexDirection="row" justifyContent="space-between">
				<text fg="white">
					<strong>Theme</strong>
				</text>
				<text fg={palette.muted}>esc</text>
			</box>

			<box flexDirection="column">
				{visiveis.map((item, i) => {
					const absoluteIndex = start + i;
					const isSelected = absoluteIndex === selected;
					const isCurrent = item.chave === controller.selectedThemeId;
					return (
						<box
							key={item.chave}
							flexDirection="row"
							backgroundColor={isSelected ? palette.selection : undefined}
							onMouseDown={() => {
								setSelected(absoluteIndex);
								if (item.criar) {
									abrirFormulario();
									return;
								}
								controllerRef.current.setThemeId(item.chave);
								resolve(item.chave);
							}}
							height={1}
						>
							<text
								fg={isSelected ? palette.textOnSelection : "white"}
								width={labelWidth}
								flexShrink={0}
							>
								{isSelected ? "\u276f " : "  "}
								{item.label}
							</text>
							<text flexShrink={0}>
								{item.swatches.map((color, swatchIndex) => (
									<span
										// biome-ignore lint/suspicious/noArrayIndexKey: fixed-size color strip
										key={swatchIndex}
										fg={color}
									>
										{SWATCH_BLOCK}
									</span>
								))}
								{item.criar ? "  " : ""}
							</text>
							<text fg={isSelected ? palette.textOnSelection : palette.muted}>
								{"  "}
								{item.descricao}
								{isCurrent ? " (current)" : ""}
							</text>
						</box>
					);
				})}
			</box>

			<text fg={palette.muted}>
				<em>{"\u2191/\u2193 preview · enter aplica · ← apaga · → exporta · i importa · esc"}</em>
			</text>
			{aviso ? <text fg={palette.info}>{aviso}</text> : null}
			<text fg={palette.muted}>
				custom: {diretorioDeTemas()}
				{avisos.length > 0 ? ` (${avisos.length} aviso[s])` : ""}
			</text>
		</box>
	);
}
