import {
	diffPalettes,
	getDefaultForeground,
	getDialogSurfaceBackground,
	getTerminalTheme,
	hexToOklab,
	oklabToHex,
	type TerminalTheme,
	themePalette,
} from "./palette";
import { lerTemasCustom, type TemaCustom } from "./themes-custom";

// User-selectable color themes for the TUI.
//
// Three kinds of built-in themes exist:
//   - "auto" adapts to the terminal: it detects light/dark from the terminal's
//     reported background and keeps that background untouched (the pre-theme
//     behavior, and still the default).
//   - "dark" / "light" force the corresponding Cline palette and paint a
//     matching background, for terminals whose reported colors are missing or
//     wrong (see cline/cline#12872).
//   - Named themes (Tokyo Night, Gruvbox, ...) paint their canonical
//     background and bring their own accent + syntax palettes.

export interface ThemeAccents {
	act: string;
	plan: string;
	success: string;
	error: string;
}

export interface ThemeDiffPalette {
	addedBg: string;
	removedBg: string;
	addedLineNumberBg: string;
	removedLineNumberBg: string;
	addedSignColor: string;
	removedSignColor: string;
	lineNumberFg: string;
}

export interface ThemeSyntaxColors {
	keyword: string;
	operator: string;
	type: string;
	functionName: string;
	variable: string;
	string: string;
	number: string;
	comment: string;
	punctuation: string;
	property: string;
	constant: string;
	tag: string;
	attribute: string;
	escape: string;
	markdownCode: string;
	markdownMuted: string;
	markdownItalic: string;
	markdownDefault?: string;
}

// Dark syntax colors are a pastel family harmonized with the brand accents
// (act #79b8ff, plan #ffea7f, success #99e89b): every hue sits near the same
// OKLCH lightness/chroma weight (~L 0.78, C 0.11) so code blocks feel like
// part of the same palette instead of a bolted-on editor theme.
export const baseSyntaxColors: Record<TerminalTheme, ThemeSyntaxColors> = {
	dark: {
		keyword: "#d7a0e3",
		operator: "#9bbbdd",
		type: "#dfca7d",
		functionName: themePalette.dark.act,
		variable: "#ee939b",
		string: "#99e89b",
		number: "#f0ad7f",
		comment: "#5c6370",
		punctuation: "#abb2bf",
		property: "#ee939b",
		constant: "#f0ad7f",
		tag: "#ee939b",
		attribute: "#f0ad7f",
		escape: "#9bbbdd",
		markdownCode: "#E8B04B",
		markdownMuted: "#8A9099",
		markdownItalic: "#F2A6B8",
		markdownDefault: "#DDE1E6",
	},
	light: {
		keyword: "#cf222e",
		operator: "#0550ae",
		type: "#953800",
		functionName: "#8250df",
		variable: "#953800",
		string: "#0a3069",
		number: "#0550ae",
		comment: "#6e7781",
		punctuation: "#57606a",
		property: "#0550ae",
		constant: "#0550ae",
		tag: "#116329",
		attribute: "#0550ae",
		escape: "#0550ae",
		markdownCode: "#116329",
		markdownMuted: "#6e7781",
		markdownItalic: "#8250df",
		markdownDefault: "#1a1a1a",
	},
};

const baseAccents: Record<TerminalTheme, ThemeAccents> = {
	dark: { ...themePalette.dark, error: "#ef4444" },
	light: { ...themePalette.light, error: "#b42318" },
};

export interface ThemeDefinition {
	id: string;
	label: string;
	description: string;
	/** "auto" resolves to the detected terminal variant at runtime. */
	variant: TerminalTheme | "auto";
	/** Painted over the whole terminal; null keeps the terminal's background. */
	background: string | null;
	/** Default text color; null keeps the variant default. */
	foreground: string | null;
	accents?: Partial<ThemeAccents>;
	syntax?: Partial<ThemeSyntaxColors>;
	diff?: Partial<ThemeDiffPalette>;
	/** Camada de UI (tabela, borda, rotulos). Sem isso, derivada do tema. */
	ui?: Partial<ThemeUiColors>;
}

/**
 * Cores de interface, separadas dos acentos de marca.
 *
 * Antes, `act` e `gray` carregavam seis significados cada (link, negrito,
 * bullet, borda de tabela, rotulo de ferramenta, texto secundario) e o
 * resultado lia como uma cor so na tela inteira. Cada token abaixo tem um
 * trabalho e uma cor propria; tema que nao declarar nada recebe a derivacao.
 */
export interface ThemeUiColors {
	/** Corpo do texto do markdown. */
	text: string;
	/** Negrito: mais claro que o corpo, nunca igual ao link. */
	strong: string;
	/** Secundario (dica, rodape, texto apagado). */
	muted: string;
	/** Linhas e molduras neutras. */
	border: string;
	/** Titulo de secao. */
	heading: string;
	/** Link e URL. */
	link: string;
	/** Marcador de lista. */
	bullet: string;
	/** Codigo inline. */
	code: string;
	/** Grade da tabela. */
	tableBorder: string;
	/** Cabecalho da tabela. */
	tableHeader: string;
	warn: string;
	info: string;
	error: string;
	success: string;
	/** Rotulo do operador. */
	user: string;
	/** Rotulo do agente. */
	agent: string;
	/** Nome de ferramenta. */
	tool: string;
	/** Caminho de arquivo. */
	path: string;
}

export interface ResolvedTheme {
	id: string;
	label: string;
	variant: TerminalTheme;
	/** Explicit background painted over the terminal, or null to keep it. */
	appBackground: string | null;
	/** Background all adaptive colors derive from (theme's, else detected). */
	background: string | null;
	/** Default text color; undefined keeps the renderer default (white). */
	defaultForeground: string | undefined;
	/** Background for selected rows/buttons on the main themed surface. */
	selection: string;
	/** Text color readable on top of `selection`. */
	textOnSelection: string;
	accents: ThemeAccents;
	diff: ThemeDiffPalette;
	syntax: ThemeSyntaxColors;
	ui: ThemeUiColors;
}

export const AUTO_THEME_ID = "htc";

export const THEMES: readonly ThemeDefinition[] = [
	{
		id: "htc",
		label: "HTC",
		description: "Vermelho japonês (CB1B45) sobre preto profundo — padrao",
		variant: "dark",
		background: "#0d0d0d",
		foreground: "#e8eaed",
	},
	{
		id: "auto",
		label: "Auto",
		description: "Adapts to your terminal's colors",
		variant: "auto",
		background: null,
		foreground: null,
	},
	{
		id: "dark",
		label: "Neutro Dark",
		description: "Paleta neutra de alto contraste",
		variant: "dark",
		background: "#14161b",
		foreground: "#e8eaed",
	},
	{
		id: "light",
		label: "Neutro Light",
		description: "Crisp white, high-contrast accents",
		variant: "light",
		background: "#ffffff",
		foreground: "#1a1a1a",
	},
	{
		id: "tokyo-night",
		label: "Tokyo Night",
		description: "Moody blues and neon city glow",
		variant: "dark",
		background: "#1a1b26",
		foreground: "#c0caf5",
		accents: {
			act: "#7aa2f7",
			plan: "#e0af68",
			success: "#9ece6a",
			error: "#f7768e",
		},
		syntax: {
			keyword: "#bb9af7",
			operator: "#89ddff",
			type: "#2ac3de",
			functionName: "#7aa2f7",
			variable: "#c0caf5",
			string: "#9ece6a",
			number: "#ff9e64",
			comment: "#565f89",
			punctuation: "#a9b1d6",
			property: "#73daca",
			constant: "#ff9e64",
			tag: "#f7768e",
			attribute: "#bb9af7",
			escape: "#89ddff",
			markdownCode: "#9ece6a",
			markdownMuted: "#565f89",
			markdownItalic: "#e0af68",
			markdownDefault: "#c0caf5",
		},
	},
	{
		id: "gruvbox-dark",
		label: "Gruvbox Dark",
		description: "Retro warmth, earthy and amber",
		variant: "dark",
		background: "#282828",
		foreground: "#ebdbb2",
		accents: {
			act: "#83a598",
			plan: "#fabd2f",
			success: "#b8bb26",
			error: "#fb4934",
		},
		syntax: {
			keyword: "#fb4934",
			operator: "#fe8019",
			type: "#fabd2f",
			functionName: "#b8bb26",
			variable: "#83a598",
			string: "#b8bb26",
			number: "#d3869b",
			comment: "#928374",
			punctuation: "#ebdbb2",
			property: "#83a598",
			constant: "#d3869b",
			tag: "#8ec07c",
			attribute: "#fabd2f",
			escape: "#fe8019",
			markdownCode: "#b8bb26",
			markdownMuted: "#928374",
			markdownItalic: "#fabd2f",
			markdownDefault: "#ebdbb2",
		},
	},
	{
		id: "nord",
		label: "Nord",
		description: "Cool arctic blues and frosted teals",
		variant: "dark",
		background: "#2e3440",
		foreground: "#d8dee9",
		accents: {
			act: "#88c0d0",
			plan: "#ebcb8b",
			success: "#a3be8c",
			error: "#bf616a",
		},
		syntax: {
			keyword: "#81a1c1",
			operator: "#81a1c1",
			type: "#8fbcbb",
			functionName: "#88c0d0",
			variable: "#d8dee9",
			string: "#a3be8c",
			number: "#b48ead",
			comment: "#616e88",
			punctuation: "#eceff4",
			property: "#8fbcbb",
			constant: "#b48ead",
			tag: "#81a1c1",
			attribute: "#8fbcbb",
			escape: "#ebcb8b",
			markdownCode: "#a3be8c",
			markdownMuted: "#616e88",
			markdownItalic: "#ebcb8b",
			markdownDefault: "#d8dee9",
		},
	},
	{
		id: "dracula",
		label: "Dracula",
		description: "Vivid color on a dark violet night",
		variant: "dark",
		background: "#282a36",
		foreground: "#f8f8f2",
		accents: {
			act: "#bd93f9",
			plan: "#f1fa8c",
			success: "#50fa7b",
			error: "#ff5555",
		},
		syntax: {
			keyword: "#ff79c6",
			operator: "#ff79c6",
			type: "#8be9fd",
			functionName: "#50fa7b",
			variable: "#f8f8f2",
			string: "#f1fa8c",
			number: "#bd93f9",
			comment: "#6272a4",
			punctuation: "#f8f8f2",
			property: "#8be9fd",
			constant: "#bd93f9",
			tag: "#ff79c6",
			attribute: "#50fa7b",
			escape: "#ff79c6",
			markdownCode: "#f1fa8c",
			markdownMuted: "#6272a4",
			markdownItalic: "#ffb86c",
			markdownDefault: "#f8f8f2",
		},
	},
	{
		id: "catppuccin-mocha",
		label: "Catppuccin Mocha",
		description: "Soothing pastels on warm mocha",
		variant: "dark",
		background: "#1e1e2e",
		foreground: "#cdd6f4",
		accents: {
			act: "#89b4fa",
			plan: "#f9e2af",
			success: "#a6e3a1",
			error: "#f38ba8",
		},
		syntax: {
			keyword: "#cba6f7",
			operator: "#89dceb",
			type: "#f9e2af",
			functionName: "#89b4fa",
			variable: "#cdd6f4",
			string: "#a6e3a1",
			number: "#fab387",
			comment: "#6c7086",
			punctuation: "#9399b2",
			property: "#94e2d5",
			constant: "#fab387",
			tag: "#f38ba8",
			attribute: "#f9e2af",
			escape: "#f5c2e7",
			markdownCode: "#a6e3a1",
			markdownMuted: "#6c7086",
			markdownItalic: "#f9e2af",
			markdownDefault: "#cdd6f4",
		},
	},
	{
		id: "one-dark",
		label: "One Dark",
		description: "Atom's balanced, easygoing dark",
		variant: "dark",
		background: "#282c34",
		foreground: "#abb2bf",
		accents: {
			act: "#61afef",
			plan: "#e5c07b",
			success: "#98c379",
			error: "#e06c75",
		},
		syntax: {
			keyword: "#c678dd",
			operator: "#56b6c2",
			type: "#e5c07b",
			functionName: "#61afef",
			variable: "#e06c75",
			string: "#98c379",
			number: "#d19a66",
			comment: "#5c6370",
			punctuation: "#abb2bf",
			property: "#e06c75",
			constant: "#d19a66",
			tag: "#e06c75",
			attribute: "#d19a66",
			escape: "#56b6c2",
			markdownCode: "#98c379",
			markdownMuted: "#5c6370",
			markdownItalic: "#e5c07b",
			markdownDefault: "#abb2bf",
		},
	},
	{
		id: "solarized-dark",
		label: "Solarized Dark",
		description: "Low-glare teal depths, easy on eyes",
		variant: "dark",
		background: "#002b36",
		foreground: "#93a1a1",
		accents: {
			act: "#268bd2",
			plan: "#b58900",
			success: "#859900",
			error: "#dc322f",
		},
		syntax: {
			keyword: "#859900",
			operator: "#93a1a1",
			type: "#b58900",
			functionName: "#268bd2",
			variable: "#268bd2",
			string: "#2aa198",
			number: "#d33682",
			comment: "#586e75",
			punctuation: "#93a1a1",
			property: "#268bd2",
			constant: "#cb4b16",
			tag: "#268bd2",
			attribute: "#93a1a1",
			escape: "#cb4b16",
			markdownCode: "#2aa198",
			markdownMuted: "#586e75",
			markdownItalic: "#6c71c4",
			markdownDefault: "#93a1a1",
		},
	},
	{
		id: "solarized-light",
		label: "Solarized Light",
		description: "Warm parchment with muted accents",
		variant: "light",
		background: "#fdf6e3",
		foreground: "#657b83",
		accents: {
			act: "#268bd2",
			plan: "#b58900",
			success: "#859900",
			error: "#dc322f",
		},
		syntax: {
			keyword: "#859900",
			operator: "#657b83",
			type: "#b58900",
			functionName: "#268bd2",
			variable: "#268bd2",
			string: "#2aa198",
			number: "#d33682",
			comment: "#93a1a1",
			punctuation: "#657b83",
			property: "#268bd2",
			constant: "#cb4b16",
			tag: "#268bd2",
			attribute: "#586e75",
			escape: "#cb4b16",
			markdownCode: "#2aa198",
			markdownMuted: "#93a1a1",
			markdownItalic: "#6c71c4",
			markdownDefault: "#657b83",
		},
	},
] as const;

const THEMES_BY_ID = new Map(THEMES.map((theme) => [theme.id, theme]));

function customParaDefinition(tema: TemaCustom): ThemeDefinition {
	return {
		id: tema.id,
		label: tema.label,
		description: tema.description,
		variant: tema.variant,
		background: tema.background,
		foreground: tema.foreground,
		accents: tema.accents as Partial<ThemeAccents> | undefined,
		syntax: tema.syntax as Partial<ThemeSyntaxColors> | undefined,
		diff: tema.diff as Partial<ThemeDiffPalette> | undefined,
		ui: tema.ui as Partial<ThemeUiColors> | undefined,
	};
}

/**
 * Built-ins + temas do operador (`~/.htc/state/themes/*.json`). Um arquivo nao
 * pode sequestrar um id embutido: o embutido ganha e o custom e ignorado.
 */
export function listThemes(): readonly ThemeDefinition[] {
	const custom = lerTemasCustom()
		.temas.filter((tema) => !THEMES_BY_ID.has(tema.id))
		.map(customParaDefinition);
	return custom.length > 0 ? [...THEMES, ...custom] : THEMES;
}

/** Avisos de carregamento dos temas do operador (JSON invalido, cor errada). */
export function avisosDeTemas(): readonly string[] {
	return lerTemasCustom().avisos;
}

/** Um tema do operador (nao embutido) — usado para marcar a lista. */
export function isBuiltinTheme(id: string): boolean {
	return THEMES_BY_ID.has(id);
}

export function getThemeDefinition(id: string): ThemeDefinition | undefined {
	return THEMES_BY_ID.get(id) ?? listThemes().find((theme) => theme.id === id);
}

export function normalizeThemeId(id: string | undefined | null): string {
	const trimmed = id?.trim().toLowerCase();
	if (!trimmed) return AUTO_THEME_ID;
	return getThemeDefinition(trimmed) ? trimmed : AUTO_THEME_ID;
}

// Below this WCAG relative luminance, white text has the higher contrast
// ratio against the background; above it, black does. Derived from
// (L + 0.05)^2 = 1.05 * 0.05.
const WHITE_TEXT_LUMINANCE_CUTOFF = 0.179;

function relativeLuminance(hex: string): number {
	const channel = (offset: number) => {
		const c = parseInt(hex.slice(offset, offset + 2), 16) / 255;
		return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function mixHex(base: string, tint: string, amount: number): string {
	const a = hexToOklab(base);
	const b = hexToOklab(tint);
	return oklabToHex(
		a.L + (b.L - a.L) * amount,
		a.a + (b.a - a.a) * amount,
		a.b + (b.b - a.b) * amount,
	);
}

// Diff rows tint the theme background toward the theme's own green/red so
// diffs feel native to every theme instead of reusing one fixed palette.
function deriveDiffPalette(
	background: string,
	foreground: string,
	accents: ThemeAccents,
): ThemeDiffPalette {
	return {
		addedBg: mixHex(background, accents.success, 0.22),
		removedBg: mixHex(background, accents.error, 0.22),
		addedLineNumberBg: mixHex(background, accents.success, 0.3),
		removedLineNumberBg: mixHex(background, accents.error, 0.3),
		addedSignColor: accents.success,
		removedSignColor: accents.error,
		lineNumberFg: mixHex(foreground, background, 0.4),
	};
}

/**
 * Camada de UI derivada do tema. Cada token recebe um trabalho e uma cor:
 * link != negrito != titulo != rotulo, e a grade da tabela e neutra (mistura de
 * fundo e texto) em vez do acento da marca. Tema que quiser mandar em algum
 * token sobrescreve em `ui` no JSON.
 */
function deriveUi(input: {
	variant: TerminalTheme;
	background: string | null;
	foreground: string | null;
	accents: ThemeAccents;
	syntax: ThemeSyntaxColors;
	custom?: Partial<ThemeUiColors>;
}): ThemeUiColors {
	const { variant, background, foreground, accents, syntax } = input;
	const base = foreground ?? (variant === "dark" ? "#e8eaed" : "#1a1a1a");
	const border = background
		? mixHex(background, base, 0.35)
		: variant === "dark"
			? "#3a3f45"
			: "#c8cdd4";
	const padrao: ThemeUiColors = {
		text: base,
		strong: mixHex(base, variant === "dark" ? "#ffffff" : "#000000", 0.45),
		muted: syntax.markdownMuted,
		border,
		heading: accents.act,
		// Link usa a cor de operador da sintaxe do tema: distinto do acento de
		// marca, entao "link" e "titulo" param de ser a mesma mancha.
		link: syntax.operator,
		bullet: accents.plan,
		code: syntax.markdownCode,
		tableBorder: border,
		tableHeader: accents.act,
		warn: variant === "dark" ? "#e8b04b" : "#8a5a00",
		info: variant === "dark" ? "#7fb3d5" : "#0b5fa5",
		error: accents.error,
		success: accents.success,
		user: accents.plan,
		agent: syntax.keyword,
		tool: syntax.type,
		path: syntax.property,
	};
	return { ...padrao, ...input.custom };
}

export interface DetectedTerminalColors {
	background: string | null;
	foreground: string | null;
}

export function resolveTheme(
	id: string,
	detected: DetectedTerminalColors,
): ResolvedTheme {
	const definition =
		getThemeDefinition(normalizeThemeId(id)) ?? (THEMES[0] as ThemeDefinition);
	const variant: TerminalTheme =
		definition.variant === "auto"
			? getTerminalTheme(detected.background, detected.foreground)
			: definition.variant;
	const appBackground = definition.background;
	const background = appBackground ?? detected.background;
	const accents: ThemeAccents = {
		...baseAccents[variant],
		...definition.accents,
	};
	const syntax: ThemeSyntaxColors = {
		...baseSyntaxColors[variant],
		...(definition.foreground
			? { markdownDefault: definition.foreground }
			: {}),
		...definition.syntax,
	};
	const diff: ThemeDiffPalette = {
		...(appBackground && definition.foreground
			? deriveDiffPalette(appBackground, definition.foreground, accents)
			: diffPalettes[variant]),
		...definition.diff,
	};
	// Selected rows highlight with the act accent; the text on top flips
	// between black and white, picking whichever has the higher WCAG
	// contrast ratio against the accent.
	const selection = accents.act;
	const textOnSelection =
		relativeLuminance(selection) > WHITE_TEXT_LUMINANCE_CUTOFF
			? "#000000"
			: "#ffffff";
	const ui = deriveUi({
		variant,
		background,
		foreground: definition.foreground,
		accents,
		syntax,
		custom: definition.ui,
	});
	return {
		id: definition.id,
		label: definition.label,
		variant,
		appBackground,
		background,
		defaultForeground:
			definition.foreground ?? getDefaultForeground(background),
		selection,
		textOnSelection,
		accents,
		diff,
		syntax,
		ui,
	};
}

export function getThemeModeAccent(theme: ResolvedTheme, mode: string): string {
	return mode === "plan" ? theme.accents.plan : theme.accents.act;
}

/**
 * Dialog surfaces are always dark, so light-variant themes (whose accents are
 * darkened for contrast on light backgrounds) fall back to the dark accent
 * set for readable dialog content.
 */
export function getDialogAccents(theme: ResolvedTheme): ThemeAccents {
	return theme.variant === "dark" ? theme.accents : baseAccents.dark;
}

/** Neutral dark panel used when no theme background is available to derive
 * a surface from (auto theme on an undetected terminal, light themes). */
export const DEFAULT_DIALOG_SURFACE = "#262626";

/**
 * Background for dialog panels. Dark themes get their own background lifted
 * one perceptual step (OKLAB), so the panel keeps the theme's hue and reads
 * as a raised surface of the same world. Light themes and undetectable
 * backgrounds keep the neutral dark panel that matches the dark accent
 * fallback in getDialogAccents.
 */
export function getDialogSurface(theme: ResolvedTheme): string {
	if (theme.variant !== "dark" || !theme.background) {
		return DEFAULT_DIALOG_SURFACE;
	}
	return getDialogSurfaceBackground(theme.background);
}

/**
 * Colors for content rendered on the always-dark dialog surface, following
 * the active theme's accents (see getDialogAccents). Mirrors the shape of
 * the static `palette` so dialog components can consume it as a drop-in
 * replacement that re-resolves on every theme change (including previews).
 */
export interface DialogPalette extends ThemeAccents {
	selection: string;
	textOnSelection: string;
	muted: string;
	/** Mensagens de sistema no painel do dialogo (sempre escuro). */
	info: string;
	warn: string;
	/** Panel background the dialog content is rendered on. */
	surface: string;
}

export function getDialogPalette(theme: ResolvedTheme): DialogPalette {
	const accents = getDialogAccents(theme);
	const selection = accents.act;
	// Painel de dialogo e sempre escuro: em tema claro as cores de UI do tema
	// ficariam ilegiveis, entao info/warn caem no conjunto escuro.
	const escuro = theme.variant === "dark";
	return {
		...accents,
		selection,
		textOnSelection:
			relativeLuminance(selection) > WHITE_TEXT_LUMINANCE_CUTOFF
				? "#000000"
				: "#ffffff",
		muted: "gray",
		info: escuro ? theme.ui.info : "#7fb3d5",
		warn: escuro ? theme.ui.warn : "#e8b04b",
		surface: getDialogSurface(theme),
	};
}

/** Small color strip rendered next to each entry in the theme picker. */
export function getThemeSwatchColors(definition: ThemeDefinition): string[] {
	const variant = definition.variant === "auto" ? "dark" : definition.variant;
	const accents = { ...baseAccents[variant], ...definition.accents };
	return [accents.act, accents.plan, accents.success, accents.error];
}

/**
 * O tema ativo como JSON do operador. Serve para o "/theme -> novo tema custom"
 * nascer já com as cores que a pessoa está vendo — editar em cima do que gosta
 * e melhor que preencher 30 hex do zero.
 */
export function temaComoCustom(
	theme: ResolvedTheme,
	extras?: { label?: string; description?: string },
): Omit<TemaCustom, "id"> {
	return {
		label: extras?.label ?? `${theme.label} (copia)`,
		description:
			extras?.description ?? "Edite este arquivo e reabra o HTC para ver",
		variant: theme.variant,
		background: theme.appBackground,
		foreground: theme.defaultForeground ?? null,
		accents: { ...theme.accents },
		syntax: { ...theme.syntax },
		diff: { ...theme.diff },
		ui: { ...theme.ui },
	};
}
