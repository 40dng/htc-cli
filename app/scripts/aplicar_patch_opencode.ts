// language: TypeScript, file: scripts/aplicar_patch_opencode.ts, runtime: Bun, alvo: ai-sdk-provider-opencode-sdk
// Aplica o suporte a `question.asked` no provider opencode. O provider vive em
// node_modules e e importado dinamicamente por @cline/llms, entao o unico ponto
// de injecao e o proprio dist. Roda no postinstall e e idempotente: se o bloco ja
// estiver aplicado, nao faz nada.
import fs from "node:fs";
import path from "node:path";

const PACOTE = "ai-sdk-provider-opencode-sdk";
const ARQUIVO = ["dist", "index.js"];
const MARCADOR = "resolveOpencodeQuestion";
const MARCADOR_GLOBAL = "__HTC_OPENCODE_QUESTION__";
const MARCADOR_PORTA = "HTC_OPENCODE_PORT";

const BLOCO_ANTIGO = [
	"              if (!isEventForSession(event, sessionId)) {",
	"                continue;",
	"              }",
	"              const streamParts = convertEventToStreamParts(",
].join("\n");

const BLOCO_NOVO = [
	"              if (!isEventForSession(event, sessionId)) {",
	"                continue;",
	"              }",
	'              if (event.type === "question.asked") {',
	"                const answeredByHost = await resolveOpencodeQuestion({",
	"                  event,",
	"                  client,",
	"                  sessionId,",
	"                  directory,",
	"                  state,",
	"                  logger",
	"                });",
	"                if (answeredByHost) {",
	"                  continue;",
	"                }",
	"              }",
	"              const streamParts = convertEventToStreamParts(",
].join("\n");

const ANCORA_FUNCAO = "function convertEventToStreamParts(event, state, logger) {";

const FUNCAO_AUXILIAR = [
	"async function resolveOpencodeQuestion({",
	"  event,",
	"  client,",
	"  sessionId,",
	"  directory,",
	"  state,",
	"  logger",
	"}) {",
	"  const questionId = event.properties?.id;",
	`  const resolver = globalThis.${MARCADOR_GLOBAL};`,
	'  if (!questionId || typeof resolver !== "function" || state.questionRequests.has(questionId)) {',
	"    return false;",
	"  }",
	"  let answers;",
	"  try {",
	"    answers = await resolver({",
	"      questionId,",
	"      sessionId,",
	'      questions: Array.isArray(event.properties?.questions) ? event.properties.questions : []',
	"    });",
	"  } catch (error) {",
	"    logger?.warn?.(`OpenCode question resolver failed: ${extractErrorMessage(error)}`);",
	"    return false;",
	"  }",
	"  if (!Array.isArray(answers) || answers.length === 0) {",
	"    return false;",
	"  }",
	"  const questionApi = client.question;",
	'  if (typeof questionApi?.reply !== "function") {',
	'    logger?.warn?.("OpenCode question.reply is unavailable; question response ignored.");',
	"    return false;",
	"  }",
	"  try {",
	"    await questionApi.reply({",
	"      requestID: questionId,",
	"      answers,",
	"      ...directory ? { directory } : {}",
	"    });",
	"    state.questionRequests.add(questionId);",
	"    return true;",
	"  } catch (error) {",
	"    logger?.warn?.(`Failed to reply to OpenCode question ${questionId}: ${extractErrorMessage(error)}`);",
	"    return false;",
	"  }",
	"}",
].join("\n");

const BLOCO_PORTA_ANTIGO = [
	"    this.options = {",
	'      hostname: "127.0.0.1",',
	"      port: 4096,",
	"      autoStartServer: true,",
	"      serverTimeout: 1e4,",
	"      ...filteredOptions",
	"    };",
].join("\n");

const BLOCO_PORTA_NOVO = [
	'    const htcEnvPort = Number.parseInt(process.env.HTC_OPENCODE_PORT ?? "", 10);',
	"    const htcDefaultPort =",
	"      Number.isInteger(htcEnvPort) && htcEnvPort > 0 && htcEnvPort < 65536",
	"        ? htcEnvPort",
	"        : 4096;",
	"    this.options = {",
	'      hostname: "127.0.0.1",',
	"      port: htcDefaultPort,",
	"      autoStartServer: true,",
	"      serverTimeout: 1e4,",
	"      ...filteredOptions",
	"    };",
].join("\n");

export interface ResultadoDoPatch {
	aplicado: boolean;
	caminho: string;
	motivo?: string;
}

interface EdicaoDeTexto {
	marcador: string;
	antigo: string;
	novo: string;
	descricao: string;
}

const EDICOES: EdicaoDeTexto[] = [
	{
		descricao: "resolve question.asked pelo canal do CLI",
		marcador: MARCADOR,
		antigo: BLOCO_ANTIGO,
		novo: BLOCO_NOVO,
	},
	{
		descricao: "insere resolveOpencodeQuestion",
		marcador: MARCADOR,
		antigo: ANCORA_FUNCAO,
		novo: `${FUNCAO_AUXILIAR}\n${ANCORA_FUNCAO}`,
	},
	{
		descricao: "porta dedicada via HTC_OPENCODE_PORT",
		marcador: MARCADOR_PORTA,
		antigo: BLOCO_PORTA_ANTIGO,
		novo: BLOCO_PORTA_NOVO,
	},
];

export function aplicar_patch_do_opencode(): ResultadoDoPatch {
	const caminho = path.join(import.meta.dir, "..", "node_modules", PACOTE, ...ARQUIVO);
	if (!fs.existsSync(caminho)) {
		return { aplicado: false, caminho, motivo: "pacote ausente" };
	}
	let fonte = fs.readFileSync(caminho, "utf8");
	const pendentes = EDICOES.filter((edicao) => !fonte.includes(edicao.marcador));
	if (pendentes.length === 0) {
		return { aplicado: false, caminho, motivo: "ja aplicado" };
	}
	for (const edicao of pendentes) {
		if (!fonte.includes(edicao.antigo)) {
			return {
				aplicado: false,
				caminho,
				motivo: `ancora ausente (${edicao.descricao})`,
			};
		}
		fonte = fonte.replace(edicao.antigo, edicao.novo);
	}
	fs.writeFileSync(caminho, fonte, "utf8");
	return { aplicado: true, caminho };
}

if (import.meta.main) {
	const resultado = aplicar_patch_do_opencode();
	if (resultado.aplicado) {
		console.log(`[htc] provider opencode patcheado: ${resultado.caminho}`);
	} else {
		console.log(`[htc] provider opencode sem alteracao (${resultado.motivo})`);
	}
}

