// @jsxImportSource @opentui/react
/**
 * HTC — lista global de modelos (`/models`).
 *
 * Mostra TODOS os modelos dos providers com credencial configurada, num só
 * lugar. Selecionar troca provider + modelo de uma vez.
 */
import type { ChoiceContext } from "@opentui-ui/dialog";
import { useDialogKeyboard } from "@opentui-ui/dialog/react";
import { useMemo, useState } from "react";
import { useDialogPalette } from "../../hooks/use-theme";
import { chaveDoModelo, type ModeloGlobal } from "../../../utils/todos-modelos";

const MAX_VISIBLE = 10;

function formatarCtx(tokens?: number): string {
	if (!tokens || !Number.isFinite(tokens) || tokens <= 0) return "";
	if (tokens >= 1_000_000)
		return `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 === 0 ? 0 : 1)}M`;
	if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
	return String(tokens);
}

function linha(m: ModeloGlobal): string {
	const ctx = formatarCtx(m.maxInputTokens);
	return ctx ? `(${ctx} - ${m.providerName})` : `(${m.providerName})`;
}

function normalizar(s: string): string {
	return s.replace(/[^a-z0-9.]/g, "");
}

export function AllModelsContent(
	props: ChoiceContext<string> & {
		modelos: ModeloGlobal[];
		currentProviderId: string;
		currentModel: string;
	},
) {
	const { resolve, dismiss, dialogId, modelos, currentProviderId, currentModel } = props;
	const palette = useDialogPalette();
	const [busca, setBusca] = useState("");
	const [selecionado, setSelecionado] = useState(() => {
		const i = modelos.findIndex(
			(m) => m.providerId === currentProviderId && m.modelId === currentModel,
		);
		return i >= 0 ? i : 0;
	});

	const filtrados = useMemo(() => {
		const q = normalizar(busca.toLowerCase());
		if (!q) return modelos;
		return modelos.filter(
			(m) =>
				normalizar(m.modelName.toLowerCase()).includes(q) ||
				normalizar(m.modelId.toLowerCase()).includes(q) ||
				normalizar(m.providerName.toLowerCase()).includes(q),
		);
	}, [busca, modelos]);

	const seguro = Math.min(Math.max(0, selecionado), Math.max(0, filtrados.length - 1));

	useDialogKeyboard((key) => {
		if (key.name === "escape") {
			dismiss();
			return;
		}
		if (key.name === "return" || key.name === "enter") {
			const alvo = filtrados[seguro];
			if (alvo) resolve(chaveDoModelo(alvo));
			return;
		}
		if (key.name === "up") {
			setSelecionado((i) => Math.max(0, Math.min(i, filtrados.length - 1) - 1));
			return;
		}
		if (key.name === "down") {
			setSelecionado((i) => Math.min(filtrados.length - 1, i + 1));
		}
	}, dialogId);

	const inicio = Math.max(
		0,
		Math.min(seguro - Math.floor(MAX_VISIBLE / 2), Math.max(0, filtrados.length - MAX_VISIBLE)),
	);
	const visiveis = filtrados.slice(inicio, inicio + MAX_VISIBLE);

	return (
		<box flexDirection="column" gap={1}>
			<text>Select model</text>
			<text fg="gray">
				{filtrados.length} modelos de {new Set(filtrados.map((m) => m.providerId)).size} providers
			</text>

			<box border borderStyle="rounded" borderColor="gray" paddingX={1}>
				<input
					onInput={(v: string) => {
						setBusca(v);
						setSelecionado(0);
					}}
					placeholder="Search all models..."
					flexGrow={1}
					focused
				/>
			</box>

			<box flexDirection="column">
				{visiveis.length === 0 && <text fg="gray">nenhum modelo com esse filtro</text>}
				{visiveis.map((m, i) => {
					const idx = inicio + i;
					const sel = idx === seguro;
					const atual = m.providerId === currentProviderId && m.modelId === currentModel;
					return (
						<box
							key={chaveDoModelo(m)}
							paddingX={1}
							flexDirection="row"
							gap={1}
							backgroundColor={sel ? palette.selection : undefined}
							onMouseDown={() => resolve(chaveDoModelo(m))}
							overflow="hidden"
							height={1}
						>
							<text fg={sel ? palette.textOnSelection : "gray"} flexShrink={0}>
								{sel ? "\u276f" : " "}
							</text>
							<text fg={sel ? palette.textOnSelection : undefined}>{m.modelName}</text>
							<text fg={sel ? palette.textOnSelection : "gray"} flexShrink={0}>
								{linha(m)}
							</text>
							{atual && (
								<text fg={sel ? palette.textOnSelection : palette.success} flexShrink={0}>
									(current)
								</text>
							)}
						</box>
					);
				})}
			</box>

			<text fg="gray">Type to search, ↑/↓ navigate, Enter to select, Esc to close</text>
		</box>
	);
}
