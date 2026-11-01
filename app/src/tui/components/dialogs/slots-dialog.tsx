// @jsxImportSource @opentui/react
import type { ChoiceContext } from "@opentui-ui/dialog";
import { useDialogKeyboard } from "@opentui-ui/dialog/react";
import { useRef, useState } from "react";
import { useDialogPalette } from "../../hooks/use-theme";
import { chaveMascarada, type Slot } from "../../../utils/slots";

type Modo = "lista" | "chave" | "modelo";

/**
 * Slots de credencial: cada sessao escolhe um provider `go-slot-N` no /model.
 * Aqui so se configura a chave e o modelo de cada slot; o switch da sessao fica
 * no picker que ja existe (restart, registry, contabilidade — tudo pronto).
 */
export function SlotsDialogContent(
	props: ChoiceContext<void> & {
		slots: Slot[];
		onSalvar: (
			n: number,
			dados: { apiKey?: string; modelo?: string },
		) => Promise<Slot[] | undefined>;
	},
) {
	const palette = useDialogPalette();
	const [slots, setSlots] = useState(props.slots);
	const [indice, setIndice] = useState(0);
	const [modo, setModo] = useState<Modo>("lista");
	const [inputKey, setInputKey] = useState(0);
	const [aviso, setAviso] = useState<string | undefined>();
	const buffer = useRef("");
	const indiceRef = useRef(0);
	const modoRef = useRef<Modo>("lista");

	const selecionado = slots[indice] ?? slots[0];

	const gravar = async (dados: { apiKey?: string; modelo?: string }) => {
		if (!selecionado) return;
		setAviso("gravando…");
		const atualizados = await props.onSalvar(selecionado.n, dados);
		if (atualizados) setSlots(atualizados);
		setAviso(`slot ${selecionado.n} gravado`);
	};

	useDialogKeyboard((key) => {
		if (modoRef.current !== "lista") {
			if (key.name === "escape") {
				modoRef.current = "lista";
				setModo("lista");
				buffer.current = "";
				setInputKey((k) => k + 1);
				return;
			}
			if (key.name === "return" || key.name === "enter") {
				const valor = buffer.current.trim();
				const modoAtual = modoRef.current;
				modoRef.current = "lista";
				setModo("lista");
				buffer.current = "";
				setInputKey((k) => k + 1);
				if (!valor) return;
				void gravar(modoAtual === "chave" ? { apiKey: valor } : { modelo: valor });
				return;
			}
			return;
		}
		if (key.name === "escape") {
			props.dismiss();
			return;
		}
		if (key.name === "up") {
			const proximo = indiceRef.current <= 0 ? slots.length - 1 : indiceRef.current - 1;
			indiceRef.current = proximo;
			setIndice(proximo);
			return;
		}
		if (key.name === "down") {
			const proximo = (indiceRef.current + 1) % slots.length;
			indiceRef.current = proximo;
			setIndice(proximo);
			return;
		}
		const digito = Number.parseInt(key.name ?? "", 10);
		if (Number.isInteger(digito) && digito >= 1 && digito <= slots.length) {
			indiceRef.current = digito - 1;
			setIndice(digito - 1);
			return;
		}
		if (key.name === "k" || key.name === "c") {
			modoRef.current = "chave";
			setModo("chave");
			setInputKey((k) => k + 1);
			return;
		}
		if (key.name === "m") {
			modoRef.current = "modelo";
			setModo("modelo");
			setInputKey((k) => k + 1);
			return;
		}
	}, props.dialogId);

	return (
		<box flexDirection="column" paddingX={1}>
			<text fg="white">
				<strong>Slots de credencial</strong>
			</text>
			<text fg="gray">
				<em>cada sessao usa um provider: /model → go-slot-N</em>
			</text>

			<box flexDirection="column" marginTop={1}>
				{slots.map((slot, i) => {
					const sel = i === indice;
					return (
						<box
							key={slot.id}
							flexDirection="row"
							justifyContent="space-between"
							backgroundColor={sel ? palette.selection : undefined}
						>
							<text fg={sel ? palette.textOnSelection : undefined}>
								{sel ? "▸ " : "  "}
								{slot.n} {slot.id}
							</text>
							<text fg={sel ? palette.textOnSelection : "gray"}>
								{slot.modelo} · {chaveMascarada(slot.apiKey)}
							</text>
						</box>
					);
				})}
			</box>

			{modo !== "lista" && (
				<box
					flexDirection="row"
					gap={1}
					marginTop={1}
					paddingX={1}
					backgroundColor={palette.selection}
				>
					<text fg={palette.textOnSelection}>
						{modo === "chave" ? "chave" : "modelo"}
						{"> "}
					</text>
					<input
						key={inputKey}
						onInput={(v: string) => {
							buffer.current = v;
						}}
						placeholder={modo === "chave" ? "oc_sk_…" : "deepseek-v4.1-flash"}
						flexGrow={1}
						focused
					/>
				</box>
			)}

			<text fg="gray" marginTop={1}>
				<em>
					{modo === "lista"
						? "1-4 / ↑↓ slot · K chave · M modelo · Esc fecha"
						: "Enter grava · Esc volta"}
				</em>
			</text>
			{aviso && (
				<text fg={palette.success} marginTop={1}>
					{aviso}
				</text>
			)}
		</box>
	);
}
