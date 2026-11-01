// Tema do HTC OPS = o MESMO tema resolvido pelo HTC CLI (nada de hex solto).
import { palette } from "../tui/palette";
import { getInitialThemeId } from "../tui/hooks/theme-provider";
import { resolveTheme } from "../tui/themes";

type TemaResolvido = {
	appBackground?: string | null;
	defaultForeground?: string;
	selection?: string;
	accents?: { act?: string; plan?: string; success?: string; error?: string };
};

function resolver(): TemaResolvido {
	try {
		// o MESMO id que o CLI usa: CLINE_THEME -> config global -> auto
		return resolveTheme(getInitialThemeId() as never, {
			background: null,
			foreground: null,
		}) as TemaResolvido;
	} catch {
		return {};
	}
}

const t = resolver();

export const cor = {
	acao: t.accents?.act ?? palette.act,
	plano: t.accents?.plan ?? palette.plan,
	ok: t.accents?.success ?? palette.success,
	erro: t.accents?.error ?? palette.error,
	mudo: palette.muted,
	selecao: t.selection ?? "#14301f",
	sobreSelecao: palette.textOnSelection,
	fundo: (t.appBackground ?? null) as string | null,
	card: "#0f1210",
	borda: "#1f2523",
	bordaFoco: t.accents?.act ?? palette.act,
	texto: t.defaultForeground ?? "#e6f0e9",
	apagado: "#5f6b65",
	alerta: "#ffb020",
};

/** Icone: so o suficiente. O resto da UI e texto. */
export const glifo = {
	busca: "\uf002",
	buscaFallback: "\u2315",
	cadeado: "\uf023",
	cadeadoFallback: "\u25a3",
} as const;

const nerd = (() => {
	const env = (process.env.HTC_NERD ?? "").toLowerCase();
	if (env === "0" || env === "false") return false;
	if (env === "1" || env === "true") return true;
	return /nerd|powerline|hack|fira|jetbrains|meslo|caskaydia|iosevka/i.test(process.env.TERM_PROGRAM ?? process.env.TERM ?? "");
})();

export const iconeBusca = () => (nerd ? glifo.busca : glifo.buscaFallback);


