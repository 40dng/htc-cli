// language: TypeScript, file: scripts/prova_markdown.ts, runtime: bun, alvo: HTC TUI
// Prova: MarkdownView formata markdown em texto estilizado, offline, sem tree-sitter.
import { testRender } from "@opentui/react/test-utils";
import { createElement } from "react";
import { MarkdownView } from "../src/tui/components/markdown-view";
import { resolveTheme } from "../src/tui/themes";

const SAMPLE = [
	"## A Linha",
	"",
	"Texto com `codigo` e **negrito** e *italico*.",
	"",
	"- item um",
	"- item dois",
	"",
	"```js",
	"const x = 1;",
	"```",
	"",
	"| col | val |",
	"| --- | --- |",
	"| a   | 1   |",
].join("\n");

const theme = resolveTheme("htc", {
	background: "#101014",
	foreground: "#e6e6e6",
});

const setup = await testRender(
	createElement(MarkdownView, {
		content: SAMPLE,
		theme,
		mode: "act",
		defaultFg: theme.defaultForeground,
		streaming: false,
	}),
	{ width: 60, height: 24 },
);
await setup.flush();
await setup.renderOnce();
await setup.waitForVisualIdle({ quietFrames: 2, maxFrames: 40 }).catch(() => {});
await setup.renderOnce();
const frame = setup.captureCharFrame();
const spans = setup.captureSpans();
setup.renderer.destroy();

console.log("--- frame ---");
console.log(frame);
console.log(`--- spans cols=${spans.cols} ---`);

const checks: Array<[string, boolean]> = [
	["frame nao vazio", frame.replace(/\s/g, "").length > 0],
	["titulo presente", frame.includes("A Linha")],
	["marcador ## ausente", !frame.includes("##")],
	["negrito ** ausente", !frame.includes("**")],
	["backtick ausente", !frame.includes("`")],
	["texto do negrito presente", frame.includes("negrito")],
	["codigo inline presente", frame.includes("codigo")],
	["itens de lista presentes", frame.includes("item um") && frame.includes("item dois")],
	["bloco de codigo presente", frame.includes("const x = 1;")],
	["tabela separada", frame.includes("│")],
];

let falhas = 0;
for (const [label, ok] of checks) {
	console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
	if (!ok) falhas++;
}
console.log(`RESULTADO ${checks.length - falhas}/${checks.length}`);
process.exit(falhas === 0 ? 0 : 1);

