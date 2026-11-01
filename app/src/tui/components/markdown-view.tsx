// language: TypeScript/TSX, file: src/tui/components/markdown-view.tsx, runtime: bun/node, alvo: HTC TUI
// Markdown -> primitivas do opentui. Substitui <markdown>, que depende de
// tree-sitter (web-tree-sitter + grammars baixadas em runtime) e no HTC
// nunca teve cliente: sem ele o MarkdownRenderable nao produz texto estilizado.
// Aqui a formatacao e deterministica, offline e funciona no htc.exe compilado.
import { useTerminalDimensions } from "@opentui/react";
import { type Token, type Tokens, marked } from "marked";
import { type ReactNode, useMemo } from "react";
import type { ResolvedTheme } from "../themes";
import type { SyntaxAccentMode } from "../utils/syntax-style";
import { LARGURA_MINIMA, montar_tabela } from "../utils/table-layout";
import {
	larguraConteudo,
	sidebarVisivel,
} from "../utils/largura-conteudo";
import { lerPrefs } from "../../utils/prefs";

interface MarkdownViewProps {
	content: string;
	theme: ResolvedTheme;
	mode: SyntaxAccentMode;
	defaultFg?: string;
	streaming?: boolean;
}

interface Ctx {
	accent: string;
	strong: string;
	link: string;
	bullet: string;
	border: string;
	heading: string;
	tableBorder: string;
	tableHeader: string;
	code: string;
	muted: string;
	italic: string;
	text: string;
	width: number;
}

const LIST_MARKER = "•";

function inlineText(token: Token): string {
	if ("tokens" in token && Array.isArray(token.tokens) && token.tokens.length > 0) {
		return token.tokens.map(inlineText).join("");
	}
	if ("text" in token && typeof token.text === "string") {
		return token.text;
	}
	return "";
}

function inlineTextTokens(tokens: Token[] | undefined): string {
	return (tokens ?? []).map(inlineText).join("");
}

function stripHtml(html: string): string {
	return html
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<[^>]+>/g, "")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'");
}

function renderInline(tokens: Token[], ctx: Ctx, keyPrefix: string): ReactNode[] {
	const out: ReactNode[] = [];
	tokens.forEach((token, index) => {
		const key = `${keyPrefix}-i${index}`;
		switch (token.type) {
			case "text": {
				const text = token as Tokens.Text;
				if (text.tokens && text.tokens.length > 0) {
					out.push(...renderInline(text.tokens, ctx, key));
				} else {
					out.push(text.text);
				}
				break;
			}
			case "escape":
				out.push(token.text);
				break;
			case "strong":
				out.push(
					<b key={key}>
						<span fg={ctx.strong}>{renderInline(token.tokens ?? [], ctx, key)}</span>
					</b>,
				);
				break;
			case "em":
				out.push(
					<i key={key}>
						<span fg={ctx.italic}>{renderInline(token.tokens ?? [], ctx, key)}</span>
					</i>,
				);
				break;
			case "del":
				out.push(
					<span key={key} fg={ctx.muted}>
						{renderInline(token.tokens ?? [], ctx, key)}
					</span>,
				);
				break;
			case "codespan":
				out.push(
					<span key={key} fg={ctx.code}>
						{(token as Tokens.Codespan).text}
					</span>,
				);
				break;
			case "link": {
				const link = token as Tokens.Link;
				out.push(
					<u key={key}>
						<span fg={ctx.link}>{renderInline(link.tokens ?? [], ctx, key)}</span>
					</u>,
				);
				if (link.href && link.href !== inlineText(link)) {
					out.push(
						<span key={`${key}-url`} fg={ctx.muted}>
							{` (${link.href})`}
						</span>,
					);
				}
				break;
			}
			case "br":
				out.push("\n");
				break;
			case "html":
				out.push(stripHtml((token as Tokens.HTML).text));
				break;
			case "image": {
				const image = token as Tokens.Image;
				out.push(
					<span key={key} fg={ctx.muted}>
						{`[imagem: ${image.text || image.href}]`}
					</span>,
				);
				break;
			}
			default:
				out.push(inlineText(token));
		}
	});
	return out;
}

function renderBlocks(tokens: Token[], ctx: Ctx, keyPrefix: string): ReactNode[] {
	const out: ReactNode[] = [];
	tokens.forEach((token, index) => {
		const key = `${keyPrefix}-b${index}`;
		switch (token.type) {
			case "heading": {
				const heading = token as Tokens.Heading;
				out.push(
					<box key={key} flexDirection="column" marginTop={index === 0 ? 0 : 1}>
						<text fg={ctx.text} selectable>
							<b>
								<span fg={ctx.heading}>
									{renderInline(heading.tokens ?? [], ctx, key)}
								</span>
							</b>
						</text>
					</box>,
				);
				break;
			}
			case "paragraph": {
				const paragraph = token as Tokens.Paragraph;
				out.push(
					<text key={key} fg={ctx.text} selectable>
						{renderInline(paragraph.tokens ?? [], ctx, key)}
					</text>,
				);
				break;
			}
			case "text": {
				const text = token as Tokens.Text;
				out.push(
					<text key={key} fg={ctx.text} selectable>
						{text.tokens && text.tokens.length > 0
							? renderInline(text.tokens, ctx, key)
							: text.text}
					</text>,
				);
				break;
			}
			case "code": {
				const code = token as Tokens.Code;
				out.push(
					<box
						key={key}
						flexDirection="column"
						border={["left"]}
						borderColor={ctx.border}
						paddingLeft={1}
						marginTop={1}
						marginBottom={1}
					>
						{code.lang ? <text fg={ctx.muted}>{code.lang}</text> : null}
						<text fg={ctx.code} selectable>
							{code.text}
						</text>
					</box>,
				);
				break;
			}
			case "list": {
				const list = token as Tokens.List;
				const rows = list.items.map((item, itemIndex) => {
					const marker = list.ordered
						? `${(typeof list.start === "number" ? list.start : 1) + itemIndex}.`
						: LIST_MARKER;
					const inline: ReactNode[] = [];
					const nested: ReactNode[] = [];
					for (const child of item.tokens ?? []) {
						if (child.type === "text" || child.type === "paragraph") {
							inline.push(
								...renderInline(
									(child as Tokens.Text).tokens ?? [],
									ctx,
									`${key}-${itemIndex}`,
								),
							);
						} else if (child.type !== "space") {
							nested.push(
								...renderBlocks([child], ctx, `${key}-${itemIndex}-n`),
							);
						}
					}
					return (
						<box key={`${key}-li${itemIndex}`} flexDirection="row" paddingLeft={1}>
							<text fg={ctx.bullet}>{`${marker} `}</text>
							<box flexDirection="column" flexGrow={1}>
								<text fg={ctx.text} selectable>
									{inline}
								</text>
								{nested}
							</box>
						</box>
					);
				});
				out.push(
					<box key={key} flexDirection="column">
						{rows}
					</box>,
				);
				break;
			}
			case "blockquote": {
				const quote = token as Tokens.Blockquote;
				out.push(
					<box
						key={key}
						flexDirection="column"
						border={["left"]}
						borderColor={ctx.border}
						paddingLeft={1}
						marginTop={1}
					>
						{renderBlocks(quote.tokens ?? [], ctx, key)}
					</box>,
				);
				break;
			}
			case "hr": {
				out.push(
					<text key={key} fg={ctx.border}>
						{"─".repeat(Math.max(8, Math.min(ctx.width - 6, 60)))}
					</text>,
				);
				break;
			}
			case "table": {
				const table = token as Tokens.Table;
				const celula = (cell: Tokens.TableCell): string => {
					// `cell.text` traz o markdown cru (`**x**`, crases): largura errada e
					// asterisco na tela. Os tokens inline dao o texto que o olho le.
					const inline = inlineTextTokens(cell.tokens);
					return inline || cell.text;
				};
				const tabela = montar_tabela(
					table.header.map(celula),
					table.rows.map((row) => row.map(celula)),
					Math.max(LARGURA_MINIMA, ctx.width),
				);
				out.push(
					<box key={key} flexDirection="column" marginTop={1} marginBottom={1}>
						<text fg={ctx.tableHeader}>
							<b>{tabela.cabecalho}</b>
						</text>
						<text fg={ctx.tableBorder}>{tabela.separador}</text>
						{tabela.linhas.map((linha, rowIndex) => (
							<text key={`${key}-r${rowIndex}`} fg={ctx.text} selectable>
								{linha}
							</text>
						))}
					</box>,
				);
				break;
			}
			case "space":
				break;
			case "html":
				out.push(
					<text key={key} fg={ctx.text} selectable>
						{stripHtml((token as Tokens.HTML).text)}
					</text>,
				);
				break;
			default:
				out.push(
					<text key={key} fg={ctx.text} selectable>
						{inlineText(token)}
					</text>,
				);
		}
	});
	return out;
}

export function MarkdownView(props: MarkdownViewProps) {
	const { width } = useTerminalDimensions();
	const ctx = useMemo<Ctx>(
		() => ({
			accent:
				props.mode === "plan" ? props.theme.accents.plan : props.theme.accents.act,
			strong: props.theme.ui.strong,
			link: props.theme.ui.link,
			bullet: props.theme.ui.bullet,
			border: props.theme.ui.border,
			heading: props.theme.ui.heading,
			tableBorder: props.theme.ui.tableBorder,
			tableHeader: props.theme.ui.tableHeader,
			code: props.theme.syntax.markdownCode,
			muted: props.theme.syntax.markdownMuted,
			italic: props.theme.syntax.markdownItalic,
			text: props.theme.syntax.markdownDefault ?? props.defaultFg ?? "",
			// Largura REAL da area de conversa (sidebar + gutters descontados).
			// Antes era a largura do terminal: tabela montada para 120 colunas num
			// espaco de 86 -> linha cortada e grade quebrada. A largura da sidebar
			// vem das prefs, que e o que `sidebar.tsx` usa para o `width` dele.
			width: larguraConteudo(
				width,
				process.env,
				sidebarVisivel(width) ? lerPrefs().sidebarLargura : undefined,
			),
		}),
		[props.mode, props.theme, props.defaultFg, width],
	);

	const blocks = useMemo(() => {
		const tokens = marked.lexer(props.content, {
			gfm: true,
			breaks: false,
		}) as Token[];
		return renderBlocks(tokens, ctx, "md");
	}, [props.content, ctx]);

	return <box flexDirection="column">{blocks}</box>;
}

