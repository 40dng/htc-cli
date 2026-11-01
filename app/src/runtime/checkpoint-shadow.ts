// language: TypeScript, file: src/runtime/checkpoint-shadow.ts, runtime: Bun
//
// Checkpoints do core (@cline/core) so rodam `git -C <cwd> rev-parse
// --is-inside-work-tree` e fazem no-op silencioso quando o workspace NAO e um
// repo git. O operador roda a CLI em pastas de trabalho sem git (CHK ENEL,
// PagWay, EXPRESSO, ARN Leads) -> nenhum ref `refs/cline/checkpoints/<sid>/<run>`
// e gravado e na TUI o restore nao tem o que listar. O mecanismo esta certo; o
// gate e que exige um repo.
//
// Este modulo injeta um `createCheckpoint` que reproduz o snapshot do core
// (mesmo formato de ref, mesmo commit de untracked) mas contra um REPO-SOMBRA
// por workspace, com work-tree apontado para a pasta real. Assim o checkpoint
// funciona em qualquer diretorio, git ou nao, sem poluir o repo do usuario e
// sem depender de um segundo repo externo (que exigiria um servidor git/ssh).

import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { CheckpointEntry, CoreCheckpointContext } from "@cline/core";

const MARCA_DO_SHADOW = "cline shadow checkpoint repo";

/**
 * Identidade fixa nos commits do shadow. O `git commit-tree` aborta com
 * "Author identity unknown" quando a maquina nao tem user.name/user.email
 * globais — e o hook do core engole o `undefined`, entao o checkpoint
 * simplesmente nao salvava em instalacao limpa. Aqui a identidade e do repo
 * sombra, nunca a do operador.
 */
const IDENTIDADE_GIT = {
	GIT_AUTHOR_NAME: "HTC checkpoint",
	GIT_AUTHOR_EMAIL: "checkpoint@htc.local",
	GIT_COMMITTER_NAME: "HTC checkpoint",
	GIT_COMMITTER_EMAIL: "checkpoint@htc.local",
};

/**
 * Diretorios que nunca entram no snapshot: sao regeneraveis e, num workspace
 * com node_modules, fazem o `git add` demorar minutos — o hook do core roda no
 * caminho do turno, entao "demora" vira "nao salvou".
 * Configuravel por HTC_CHECKPOINT_EXCLUDES (arquivo, um padrao por linha).
 */
const EXCLUDES_PADRAO = [
	"node_modules/",
	".git/",
	"dist/",
	"build/",
	"out/",
	".next/",
	".nuxt/",
	".cache/",
	"target/",
	"vendor/",
	"__pycache__/",
	"*.pyc",
	".venv/",
	"venv/",
	"coverage/",
	"*.log",
	// Binario e arquivo compactado nao sao entregaveis do agente e dominam o
	// `git add`: um zip de 600MB no workspace fazia o snapshot nunca terminar.
	"*.zip",
	"*.7z",
	"*.rar",
	"*.tar",
	"*.gz",
	"*.tgz",
	"*.iso",
	"*.img",
	"*.exe",
	"*.dll",
	"*.so",
	"*.dylib",
	"*.bin",
	"*.msi",
	"*.apk",
	"*.ipa",
	"*.jar",
	"*.whl",
];

/** Teto de tempo do git: acima disso o turno ficava esperando o snapshot. */
const TIMEOUT_GIT_MS = 60_000;

/**
 * Teto do `add` num workspace grande. 60s nao cobre um workspace de 200 mil
 * arquivos com indice frio: o processo era morto no meio, deixava `index.lock`
 * e o `write-tree` seguinte falhava — nenhum snapshot, toda vez. O valor e
 * configuravel porque o custo depende do disco e do volume do operador.
 */
function limite_git_ms(): number {
	const bruto = Number(process.env.HTC_CHECKPOINT_TIMEOUT_MS);
	if (Number.isFinite(bruto) && bruto >= 1_000) {
		return bruto;
	}
	return 600_000;
}

/** Prefixo dos refs que o core e o shadow compartilham. */
const PREFIXO_DE_REFS = "refs/cline/checkpoints/";

/**
 * Snapshots de seguranca do restore nao sao checkpoints do operador: nascem em
 * `restore-<timestamp>` e existem so para o reset ter para onde voltar. Listar
 * esses refs colocaria um "run 1" falso por cima do run 1 real no picker.
 */
const PREFIXO_DE_SESSAO_INTERNA = "restore-";

/**
 * Hash da arvore vazia do git. Quando o `add` nao consegue indexar NADA (disco
 * cheio, permissao, tudo excluido) o `write-tree` devolve esta arvore e o
 * commit viraria um "restore para o vazio": `reset --hard` + `clean -fd`
 * apagariam o workspace. Sem arquivo indexado nao existe snapshot.
 */
const ARVORE_VAZIA = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

/**
 * Marca que acompanha o `htc-index.lock` enquanto o preparo em background roda.
 * Sem ela o hook nao distingue "lock de processo vivo" de "lock de processo
 * morto" e removeria um lock em uso.
 */
const SUFIXO_DE_AQUECIMENTO = ".aquecendo";

/** Marcadores do bloco de config que o HTC escreve no shadow. */
const MARCA_INICIO_CONFIG = "# >>> htc checkpoint (gerado)";
const MARCA_FIM_CONFIG = "# <<< htc checkpoint";

/** Marca de aquecimento sem dono (processo morto) nao pode bloquear para sempre. */
function marca_vencida(marca: string): boolean {
	try {
		return Date.now() - statSync(marca).mtimeMs > limite_git_ms();
	} catch {
		return true;
	}
}

export interface ResultadoDoCheckpoint {
	ref: string;
	createdAt: number;
	runCount: number;
	kind: "stash" | "commit";
}

export type ControladorDeCheckpoint = (
	contexto: CoreCheckpointContext,
) => Promise<ResultadoDoCheckpoint | undefined>;

export interface LogDoShadow {
	log?: (mensagem: string, meta?: Record<string, unknown>) => void;
}

/**
 * Caminho normalizado para o hash: no Windows `C:\X` e `c:\x` sao o mesmo
 * diretorio mas geram hashes diferentes, e cada um ganharia um repo-sombra com
 * metade dos refs.
 */
function workspace_normalizado(workspace: string): string {
	const absoluto = resolve(workspace).replace(/\\/g, "/").replace(/\/+$/, "");
	return process.platform === "win32" ? absoluto.toLowerCase() : absoluto;
}

// Cria o diretorio do repo-sombra por workspace. O isolamento e por hash do
// caminho do workspace: dois diretorios diferentes nunca compartilham refs.
export function diretorio_do_shadow(workspace: string): string {
	const hash = createHash("sha256")
		.update(workspace_normalizado(workspace))
		.digest("hex")
		.slice(0, 16);
	const base =
		process.env.HTC_CHECKPOINT_DIR?.trim() || join(tmpdir(), "htc-checkpoints");
	return join(base, hash);
}

/** O workspace do checkpoint: mesma precedencia na criacao e no restore. */
export function resolver_workspace(entrada: {
	workspaceRoot?: string | null;
	cwd?: string | null;
	chatCommandState?: { workspaceRoot?: string | null; cwd?: string | null };
}): string {
	const doChat = entrada.chatCommandState?.workspaceRoot?.trim();
	const raiz = entrada.workspaceRoot?.trim();
	const cwd = entrada.cwd?.trim() || entrada.chatCommandState?.cwd?.trim();
	return doChat || raiz || cwd || process.cwd();
}

interface ContextoDoShadow {
	shadow: string;
	gitDir: string;
	workTree: string;
	excludes: string;
}

interface SaidaGit {
	ok: boolean;
	/** null quando o processo foi morto pelo timeout. */
	status: number | null;
	stdout: string;
	stderr: string;
	ms: number;
}

/**
 * O stderr do `git add` num workspace grande tem dezenas de milhares de linhas
 * ("LF will be replaced by CRLF", hints de repo embutido) e algumas de erro. O
 * log do operador chegou a 28 MB por causa disso. Aqui fica so o que identifica
 * a falha: quantos arquivos ficaram de fora e o primeiro erro nomeado.
 */
function resumir_saida_git(texto: string): string {
	const linhas = texto
		.split("\n")
		.map((linha) => linha.trim())
		.filter((linha) => linha.length > 0)
		.filter(
			(linha) =>
				!linha.startsWith("hint:") &&
				!linha.includes("LF will be replaced by CRLF") &&
				!linha.includes("CRLF will be replaced by LF"),
		);
	const erros = linhas.filter(
		(linha) => linha.startsWith("error:") || linha.startsWith("fatal:"),
	);
	const relevante = (erros.length > 0 ? erros : linhas).slice(0, 4).join(" | ");
	const total = relevante.length > 600 ? `${relevante.slice(0, 600)}...` : relevante;
	return `${erros.length} erro(s), ${linhas.length} linha(s): ${total || "sem detalhe"}`;
}

/**
 * Variante assincrona usada no caminho do turno.
 *
 * `spawnSync` bloqueia o event loop: com o snapshot levando ~1s, a TUI parava
 * de renderizar e o operador via a queda de FPS ao enviar o prompt. Com
 * `spawn` o git roda fora do loop — o turno espera o mesmo tempo, mas a tela
 * continua desenhando a 60fps.
 */
function rodar_git_assincrono(
	contexto: ContextoDoShadow,
	args: string[],
	extraEnv?: Record<string, string>,
	limiteMs: number = limite_git_ms(),
): Promise<SaidaGit> {
	return new Promise<SaidaGit>((resolver) => {
		const inicio = Date.now();
		let stdout = "";
		let stderr = "";
		let mortoPorTempo = false;
		const filho = spawn(
			"git",
			["--git-dir", contexto.gitDir, "--work-tree", contexto.workTree, ...args],
			{
				cwd: contexto.workTree,
				windowsHide: true,
				env: { ...process.env, ...IDENTIDADE_GIT, ...extraEnv },
			},
		);
		const alarme = setTimeout(() => {
			mortoPorTempo = true;
			filho.kill();
		}, limiteMs);
		// O stderr do `add` chega a dezenas de MB num workspace grande. Guardar
		// so a cabeca e a cauda mantem o diagnostico sem segurar o resto.
		filho.stdout?.on("data", (pedaco: Buffer) => {
			stdout = capaz(stdout, pedaco.toString(), 8 * 1024);
		});
		filho.stderr?.on("data", (pedaco: Buffer) => {
			stderr = capaz(stderr, pedaco.toString(), 64 * 1024);
		});
		filho.on("error", (erro) => {
			clearTimeout(alarme);
			resolver({
				ok: false,
				status: null,
				stdout: stdout.trim(),
				stderr: `${stderr}${String(erro)}`.trim(),
				ms: Date.now() - inicio,
			});
		});
		filho.on("close", (codigo) => {
			clearTimeout(alarme);
			resolver({
				ok: codigo === 0,
				status: mortoPorTempo ? null : codigo,
				stdout: stdout.trim(),
				stderr: stderr.trim(),
				ms: Date.now() - inicio,
			});
		});
	});
}

/** Mantem no maximo ~`limite` caracteres, preservando o fim (onde o erro mora). */
function capaz(acumulado: string, pedaco: string, limite: number): string {
	const total = acumulado + pedaco;
	if (total.length <= limite) {
		return total;
	}
	const cabeca = total.slice(0, 4096);
	return `${cabeca}\n[... ${total.length - limite} bytes omitidos ...]\n${total.slice(-(limite - 4096))}`;
}

/**
 * Toda chamada usa `--git-dir`/`--work-tree` explicitos, com cwd no workspace.
 * `git -C <shadow> add -- .` resolvia o pathspec `.` a partir do cwd do shadow,
 * FORA do work tree — funcionava em git 2.55 e falhava em versoes onde o
 * pathspec e validado contra o work tree. Explicito nao tem versao.
 *
 * Esta variante sincrona fica para os caminhos frios (config do shadow,
 * diagnostico, adocao de diretorio) — nenhum deles roda dentro do turno.
 */
function rodar_git(
	contexto: ContextoDoShadow,
	args: string[],
	extraEnv?: Record<string, string>,
	limiteMs: number = limite_git_ms(),
): SaidaGit {
	const inicio = Date.now();
	const resultado = spawnSync(
		"git",
		["--git-dir", contexto.gitDir, "--work-tree", contexto.workTree, ...args],
		{
			cwd: contexto.workTree,
			encoding: "utf8",
			windowsHide: true,
			timeout: limiteMs,
			maxBuffer: 64 * 1024 * 1024,
			env: { ...process.env, ...IDENTIDADE_GIT, ...extraEnv },
		},
	);
	return {
		ok: resultado.status === 0,
		status: resultado.status,
		stdout: (resultado.stdout ?? "").trim(),
		stderr: (resultado.stderr ?? "").trim(),
		ms: Date.now() - inicio,
	};
}

/**
 * O diretorio existe mas perdeu a marca (versao anterior, escrita interrompida,
 * antivirus). Antes isso desligava o checkpoint para aquele workspace PARA
 * SEMPRE, em silencio. Agora a marca e reconstruida quando o repo aponta para o
 * MESMO workTree; um `.git` de terceiro continua intocado.
 */
function adotar_diretorio_existente(diretorio: string, workspace: string): boolean {
	const gitDir = join(diretorio, ".git");
	if (!existsSync(gitDir)) {
		return false;
	}
	const apontado = spawnSync("git", ["--git-dir", gitDir, "config", "core.workTree"], {
		encoding: "utf8",
		windowsHide: true,
		timeout: TIMEOUT_GIT_MS,
	});
	const workTree = (apontado.stdout ?? "").trim().replace(/\\/g, "/").toLowerCase();
	if (!workTree || workTree !== workspace_normalizado(workspace)) {
		return false;
	}
	writeFileSync(join(diretorio, "HTC_SHADOW"), MARCA_DO_SHADOW, "utf8");
	return true;
}

function marcar_como_nosso(diretorio: string, workspace: string): boolean {
	try {
		const marker = join(diretorio, "HTC_SHADOW");
		if (existsSync(marker)) {
			return readFileSync(marker, "utf8").trim() === MARCA_DO_SHADOW;
		}
		// Diretorio ja existe sem a marca: so adota se for um shadow nosso orfao.
		if (existsSync(join(diretorio, ".git"))) {
			return adotar_diretorio_existente(diretorio, workspace);
		}
		mkdirSync(diretorio, { recursive: true });
		writeFileSync(marker, MARCA_DO_SHADOW, "utf8");
		return true;
	} catch {
		return false;
	}
}

function escrever_excludes(diretorio: string): string {
	const externo = process.env.HTC_CHECKPOINT_EXCLUDES?.trim();
	// Arquivo do operador: nao reescrever nunca.
	if (externo) return externo;
	const caminho = join(diretorio, "exclude");
	const conteudo = `${EXCLUDES_PADRAO.join("\n")}\n`;
	try {
		// Reescreve quando a lista muda: shadows antigos ficavam presos nas regras
		// da primeira execucao e continuavam varrendo node_modules.
		if (!existsSync(caminho) || readFileSync(caminho, "utf8") !== conteudo) {
			writeFileSync(caminho, conteudo, "utf8");
		}
	} catch {
		// Sem excludes o snapshot ainda funciona, so fica mais lento.
	}
	return caminho;
}

/**
 * Shadows ja configurados neste processo. Cada checkpoint chamava 4 `git config`
 * antes do trabalho de verdade — num Windows/OneDrive isso e ~200ms por turno
 * pagos para reescrever o que ja estava certo.
 */
const shadow_preparado = new Set<string>();

/**
 * Escreve o bloco de configuracao do shadow direto no arquivo.
 *
 * Eram 8 `git config` por processo (~70ms cada, ~560ms medidos) bem no primeiro
 * turno — o operador via o travamento. O formato de config do git e texto: o
 * bloco entre marcadores e reescrito a cada preparo, sem spawn nenhum.
 */
function escrever_config_do_shadow(contexto: ContextoDoShadow): void {
	const caminho = join(contexto.gitDir, "config");
	const workTree = contexto.workTree.replace(/\\/g, "/");
	const bloco = [
		MARCA_INICIO_CONFIG,
		"[core]",
		`\tworkTree = "${workTree}"`,
		"\tbare = false",
		// Sem longpaths o git recusa indexar caminho acima de MAX_PATH e o
		// `add` inteiro morre em "Filename too long" — foi o que parou de
		// salvar checkpoint no workspace com repack de APK.
		"\tlongpaths = true",
		// Snapshot tem que devolver o byte exato: nada de converter linha.
		"\tautocrlf = false",
		"\tsafecrlf = false",
		// 200 mil arquivos: sem cache o `add` relê diretorio que nao mudou.
		"\tuntrackedCache = true",
		"\tpreloadIndex = true",
		`\texcludesFile = "${contexto.excludes.replace(/\\/g, "/")}"`,
		"[advice]",
		"\tdetachedHead = false",
		"\taddEmbeddedRepo = false",
		MARCA_FIM_CONFIG,
		"",
	].join("\n");
	try {
		const atual = existsSync(caminho) ? readFileSync(caminho, "utf8") : "";
		const inicio = atual.indexOf(MARCA_INICIO_CONFIG);
		const fim = atual.indexOf(MARCA_FIM_CONFIG);
		const base =
			inicio >= 0 && fim > inicio
				? `${atual.slice(0, inicio)}${atual.slice(fim + MARCA_FIM_CONFIG.length + 1)}`
				: atual;
		const novo = `${base.replace(/\s+$/, "")}\n${bloco}`;
		if (novo !== atual) {
			writeFileSync(caminho, novo, "utf8");
		}
	} catch {
		// Config pela metade ainda funciona; o proximo preparo reescreve.
	}
}

/**
 * Garante o repo-sombra pronto: git init + workTree no diretorio real. O
 * `core.workTree` absoluto com `core.bare=false` e o que permite ler os
 * arquivos do workspace sem copiar nada.
 */
function preparar_shadow(
	workspace: string,
	logger?: LogDoShadow,
): ContextoDoShadow | undefined {
	if (!workspace.trim() || !existsSync(workspace)) {
		logger?.log?.(`checkpoint: workspace inexistente (${workspace})`);
		return undefined;
	}
	const workTree = resolve(workspace);
	const shadow = diretorio_do_shadow(workTree);
	if (resolve(shadow) === workTree) {
		return undefined;
	}
	if (!marcar_como_nosso(shadow, workTree)) {
		logger?.log?.(
			`checkpoint: ${shadow} existe sem a marca do HTC e nao aponta para ${workTree}; nao vou mexer`,
		);
		return undefined;
	}
	const contexto: ContextoDoShadow = {
		shadow,
		gitDir: join(shadow, ".git"),
		workTree,
		excludes: escrever_excludes(shadow),
	};
	// O gitDir pode ter sido limpo (tempdir, antivirus) entre dois turnos.
	if (!existsSync(contexto.gitDir)) {
		shadow_preparado.delete(shadow);
		const init = rodar_git(contexto, ["init", "--quiet"]);
		if (!init.ok) {
			logger?.log?.(`checkpoint: git init falhou em ${shadow}: ${init.stderr}`);
			return undefined;
		}
	}
	if (!shadow_preparado.has(shadow)) {
		escrever_config_do_shadow(contexto);
		shadow_preparado.add(shadow);
	}
	return contexto;
}

interface CommitDoShadow {
	commit: string;
	arvore: string;
}

/**
 * Monta o commit do snapshot (add + write-tree + commit-tree) e devolve os
 * hashes. Nao cria ref: quem chama decide se aquilo vira checkpoint do
 * operador ou apenas o snapshot de seguranca do restore.
 *
 * `commit` vazio significa "nada indexavel" — nao e falha, e ausencia de estado
 * a proteger.
 */
async function montar_commit_do_shadow(
	contexto: CoreCheckpointContext,
	workspace: string,
	logger?: LogDoShadow,
): Promise<CommitDoShadow | undefined> {
	const shadow = preparar_shadow(workspace, logger);
	if (!shadow) {
		return undefined;
	}
	// Indice PERSISTENTE por workspace. Um indice novo a cada turno obrigava o
	// git a rehashar o workspace inteiro (214 mil arquivos neste: minutos); o
	// turno estourava o teto de tempo, o `add` era morto no meio e nada era
	// salvo. Reaproveitado, o `add` so recalcula o que mudou desde o turno
	// anterior.
	const indice = join(shadow.shadow, "htc-index");
	const variaveisDeIndice = { GIT_INDEX_FILE: indice };
	const rodar_add = () =>
		rodar_git_assincrono(
			shadow,
			["add", "-A", "--ignore-errors"],
			variaveisDeIndice,
		);
	try {
		// `--ignore-errors` continua indexando o que der e sai != 0 no fim. Um
		// unico arquivo patologico (caminho acima de MAX_PATH, arquivo travado
		// por outro processo, nome invalido vindo de repack de APK) abortava o
		// `add` inteiro: o turno ficava SEM snapshot e o operador so via
		// "No checkpoints available". Agora o que da para indexar vira snapshot
		// e o que ficou de fora vai para o log como aviso.
		let add = await rodar_add();
		// Processo morto no meio (teto de tempo, terminal fechado) deixa o
		// `index.lock` e trava todo `add` seguinte com "index.lock: File
		// exists" — foi o que apareceu depois da primeira correcao. O indice e
		// do shadow, nunca do repo do operador: remover o lock e seguro, MAS
		// so quando ninguem esta escrevendo nele.
		if (!add.ok && existsSync(`${indice}.lock`)) {
			const marca = `${indice}${SUFIXO_DE_AQUECIMENTO}`;
			if (existsSync(marca) && !marca_vencida(marca)) {
				logger?.log?.(
					"checkpoint: indice ainda em preparo no background; snapshot deste turno adiado",
				);
				return undefined;
			}
			rmSync(`${indice}.lock`, { force: true });
			add = await rodar_add();
		}
		if (!add.ok) {
			if (add.status === null) {
				// Morto pelo teto: o indice pode estar pela metade e a arvore
				// sairia incompleta. Restaurar isso apagaria arquivos que so
				// nao chegaram a ser indexados — melhor nao ter snapshot.
				logger?.log?.(
					`checkpoint: git add interrompido em ${Math.round(add.ms / 1000)}s; snapshot descartado (ajuste HTC_CHECKPOINT_TIMEOUT_MS)`,
				);
				return undefined;
			}
			logger?.log?.(
				`checkpoint: git add parcial em ${add.ms}ms: ${resumir_saida_git(add.stderr)}`,
			);
		} else if (add.ms > 10_000) {
			// Workspace grande: o operador precisa ver o custo real do snapshot.
			logger?.log?.(`checkpoint: snapshot do workspace levou ${add.ms}ms`);
		}
		const arvore = await rodar_git_assincrono(
			shadow,
			["write-tree"],
			variaveisDeIndice,
		);
		if (!arvore.ok || !arvore.stdout) {
			logger?.log?.(
				`checkpoint: write-tree falhou: ${resumir_saida_git(arvore.stderr)}`,
			);
			return undefined;
		}
		if (arvore.stdout === ARVORE_VAZIA) {
			return { commit: "", arvore: arvore.stdout };
		}
		const mensagem = `cline checkpoint session=${contexto.sessionId} run=${contexto.runCount} ${Date.now()}`;
		const commit = await rodar_git_assincrono(shadow, [
			"commit-tree",
			arvore.stdout,
			"-m",
			mensagem,
		]);
		if (!commit.ok || !commit.stdout) {
			logger?.log?.(`checkpoint: commit-tree falhou: ${resumir_saida_git(commit.stderr)}`);
			return undefined;
		}
		return { commit: commit.stdout, arvore: arvore.stdout };
	} catch (erro) {
		logger?.log?.(`checkpoint: snapshot falhou: ${String(erro)}`);
		return undefined;
	}
}

/**
 * Publica o commit montado como checkpoint da sessao e confere que ele ficou
 * legivel. Separado de `montar_commit_do_shadow` porque o restore tambem monta
 * um commit de seguranca — e esse nao vira checkpoint do operador.
 */
export async function criar_checkpoint_no_shadow(
	contexto: CoreCheckpointContext,
	workspace: string,
	logger?: LogDoShadow,
): Promise<ResultadoDoCheckpoint | undefined> {
	const montado = await montar_commit_do_shadow(contexto, workspace, logger);
	if (!montado) {
		return undefined;
	}
	if (!montado.commit) {
		logger?.log?.(
			"checkpoint: nenhum arquivo indexavel; snapshot descartado (restore dele apagaria o workspace)",
		);
		return undefined;
	}
	const shadow = preparar_shadow(workspace, logger);
	if (!shadow) {
		return undefined;
	}
	const ref = `${PREFIXO_DE_REFS}${contexto.sessionId}/${contexto.runCount}`;
	const publicado = await rodar_git_assincrono(shadow, [
		"update-ref",
		ref,
		montado.commit,
	]);
	if (!publicado.ok) {
		logger?.log?.(`checkpoint: update-ref ${ref} falhou`);
		return undefined;
	}
	// `update-ref` nao falha quando o objeto sumiu do disco (tempdir limpo,
	// antivirus). Sem esta checagem o metadata guardava um ref que o restore
	// nao conseguiria abrir — "checkpoint existe e nao volta".
	const legivel = await rodar_git_assincrono(shadow, [
		"cat-file",
		"-e",
		`${montado.commit}^{commit}`,
	]);
	if (!legivel.ok) {
		logger?.log?.(
			`checkpoint: commit ${montado.commit} sumiu depois do update-ref; snapshot descartado`,
		);
		return undefined;
	}
	return {
		ref: montado.commit,
		createdAt: Date.now(),
		runCount: contexto.runCount,
		kind: "commit",
	};
}

export interface CheckpointDoShadow extends CheckpointEntry {
	/**
	 * Sessao que gravou o snapshot. O restore de um run que nao esta na
	 * transcricao atual precisa saber de onde ler as mensagens.
	 */
	sessionId: string;
}

/**
 * Todo snapshot que o shadow guarda para o workspace, independente de sessao.
 *
 * O metadata da sessao e a unica coisa que o picker lia — e ele nasce vazio
 * quando o id muda (modelo novo, `--resume` de outra sessao, processo que
 * morreu antes de gravar). Os refs continuavam no disco: o snapshot existia e
 * ficava inalcancavel. Ler o ref e a fonte de verdade; o metadata e cache.
 */
export async function listar_checkpoints_do_shadow(
	workspace: string,
	logger?: LogDoShadow,
): Promise<CheckpointDoShadow[]> {
	const shadow = preparar_shadow(workspace, logger);
	if (!shadow) {
		return [];
	}
	// Assincrono: o `/undo` roda com a TUI viva, e um `spawnSync` aqui era mais
	// um travamento de frame ao abrir o picker.
	const saida = await rodar_git_assincrono(shadow, [
		"for-each-ref",
		"--format=%(refname)%09%(objectname)%09%(committerdate:unix)",
		PREFIXO_DE_REFS,
	]);
	if (!saida.ok || !saida.stdout) {
		return [];
	}
	const porRun = new Map<string, CheckpointDoShadow>();
	for (const linha of saida.stdout.split("\n")) {
		const [nome, objeto, quando] = linha.split("\t");
		if (!nome?.startsWith(PREFIXO_DE_REFS) || !objeto) {
			continue;
		}
		const partes = nome.slice(PREFIXO_DE_REFS.length).split("/");
		const sessionId = partes[0]?.trim() ?? "";
		const runCount = Number(partes[1]);
		if (
			!sessionId ||
			sessionId.startsWith(PREFIXO_DE_SESSAO_INTERNA) ||
			!Number.isInteger(runCount) ||
			runCount < 1
		) {
			continue;
		}
		const entrada: CheckpointDoShadow = {
			ref: objeto,
			createdAt: (Number(quando) || 0) * 1000,
			runCount,
			kind: "commit",
			sessionId,
		};
		// A chave e sessao+run, nao run: duas sessoes no mesmo workspace (modelo
		// novo, resume de outra sessao) comecam as duas no run 1 — com chave so
		// por run, a mais nova apagava a antiga e o snapshot sumia do picker.
		const chave = `${sessionId}/${runCount}`;
		const atual = porRun.get(chave);
		if (!atual || entrada.createdAt >= atual.createdAt) {
			porRun.set(chave, entrada);
		}
	}
	return [...porRun.values()].sort(
		(a, b) => a.runCount - b.runCount || a.createdAt - b.createdAt,
	);
}

/**
 * Aplica um snapshot do shadow no workspace. Existe porque o restore do core
 * roda `git -C <cwd>` — e o commit do checkpoint mora no repo-sombra, nao no
 * repo (ou nao-repo) do operador. Sem isto o snapshot era criado e ficava
 * inalcancavel: a lista mostrava o checkpoint e o restore nao achava o objeto.
 *
 * Antes de sobrescrever, tira um snapshot de seguranca do estado atual. Se nem
 * isso der certo, nao aplica — restore destrutivo sem rede de seguranca nao roda.
 */
export async function aplicar_snapshot_do_shadow(
	workspace: string,
	ref: string,
	logger?: LogDoShadow,
): Promise<boolean> {
	const shadow = preparar_shadow(workspace, logger);
	if (!shadow) {
		return false;
	}
	const existe = await rodar_git_assincrono(shadow, [
		"cat-file",
		"-e",
		`${ref}^{commit}`,
	]);
	if (!existe.ok) {
		logger?.log?.(`checkpoint: commit ${ref} nao existe no shadow`);
		return false;
	}
	const seguranca = await montar_commit_do_shadow(
		{ cwd: workspace, sessionId: `restore-${Date.now()}`, runCount: 1 },
		workspace,
		logger,
	);
	if (!seguranca) {
		logger?.log?.(
			"checkpoint: snapshot de seguranca falhou; restore do workspace abortado",
		);
		return false;
	}
	if (seguranca.commit) {
		// Guarda o objeto atras de um ref para o gc nao leva-lo: e a unica copia
		// do estado anterior ao restore.
		await rodar_git_assincrono(shadow, [
			"update-ref",
			`${PREFIXO_DE_REFS}restore-${Date.now()}/1`,
			seguranca.commit,
		]);
	}
	// Sem commit a arvore saiu vazia: nao havia nada indexavel para proteger e
	// `clean -fd` respeita o exclude, entao o que sobrou (node_modules, dist)
	// nao seria apagado. O restore pode seguir.
	const reset = await rodar_git_assincrono(shadow, ["reset", "--hard", ref]);
	if (!reset.ok) {
		logger?.log?.(`checkpoint: reset --hard falhou: ${reset.stderr}`);
		return false;
	}
	// `clean` remove o que foi criado depois do snapshot. Respeita o exclude
	// file do shadow, entao node_modules/dist nao somem.
	await rodar_git_assincrono(shadow, ["clean", "-fd"]);
	// O `reset --hard` deixa `.git/index` exatamente na arvore restaurada. Usar
	// esse indice como base mantem o proximo snapshot quente e coerente com o
	// estado que acabou de voltar (sem isso o `add` seguinte rehasha tudo).
	try {
		copyFileSync(join(shadow.gitDir, "index"), join(shadow.shadow, "htc-index"));
	} catch {
		// Sem copia o proximo add reconstroi o indice: lento, nao errado.
	}
	return true;
}

/**
 * Preparo do indice do checkpoint fora do turno.
 *
 * O primeiro snapshot de um workspace grande custa minutos com indice frio
 * (medido: 373s para 202 mil arquivos). Rodar isso quando a sessao abre evita
 * que o primeiro turno pague a conta — o `add` do turno encontra o indice
 * quente e leva menos de 1s (medido: 0,6-0,8s).
 *
 * A marca `.aquecendo` existe para o hook saber que ha um `add` em andamento:
 * sem ela o hook removeria o `index.lock` de um processo vivo e corromperia o
 * indice.
 */
export function aquecer_indice_do_shadow(
	workspace: string,
	logger?: LogDoShadow,
): void {
	const shadow = preparar_shadow(workspace, logger);
	if (!shadow) {
		return;
	}
	const indice = join(shadow.shadow, "htc-index");
	if (existsSync(indice)) {
		return;
	}
	const marca = `${indice}${SUFIXO_DE_AQUECIMENTO}`;
	if (existsSync(marca) && !marca_vencida(marca)) {
		return;
	}
	try {
		writeFileSync(marca, String(process.pid), "utf8");
	} catch {
		return;
	}
	const encerrar = (): void => {
		try {
			rmSync(marca, { force: true });
		} catch {
			// marca orfa: `marca_vencida` a descarta no proximo turno
		}
	};
	const filho = spawn(
		"git",
		[
			"--git-dir",
			shadow.gitDir,
			"--work-tree",
			shadow.workTree,
			"add",
			"-A",
			"--ignore-errors",
		],
		{
			cwd: shadow.workTree,
			stdio: "ignore",
			windowsHide: true,
			env: { ...process.env, ...IDENTIDADE_GIT, GIT_INDEX_FILE: indice },
		},
	);
	filho.on("error", encerrar);
	filho.on("close", encerrar);
	logger?.log?.(`checkpoint: preparando indice de ${workspace} em background`);
}

/** Diagnostico de uma linha para o operador (TUI/`htc debug`). */
export function diagnostico_do_shadow(workspace: string): string {
	const shadow = preparar_shadow(workspace);
	if (!shadow) {
		return `checkpoint: sem repo-sombra para ${workspace} (git ausente, fs somente leitura ou diretorio sem a marca)`;
	}
	const refs = rodar_git(shadow, [
		"for-each-ref",
		"--format=%(refname)",
		"refs/cline/checkpoints",
	]);
	if (!refs.ok) {
		return `checkpoint: shadow em ${shadow.shadow} sem refs legiveis`;
	}
	const total = refs.stdout ? refs.stdout.split("\n").filter(Boolean).length : 0;
	return `checkpoint: shadow em ${shadow.shadow} com ${total} snapshot(s)`;
}

/**
 * Monta o controlador de checkpoint para uma sessao. Sempre prefere o repo-sombra
 * por workspace: em diretorio git ele nao conflita com o repo do operador (o
 * checkpoint sai do `git add`/`commit-tree`, nao de um `git stash` no repo dele),
 * e em diretorio sem git ele TAPA a lacuna que hoje faz o checkpoint sumir.
 */
export function criar_controlador_de_checkpoint(
	workspace: string,
	logger?: LogDoShadow,
): ControladorDeCheckpoint {
	return (contexto) => criar_checkpoint_no_shadow(contexto, workspace, logger);
}

/** Aviso legivel quando o shadow nao pode ser criado (git ausente, fs somente leitura). */
export function aviso_do_shadow_indisponivel(workspace: string, logger?: { log?: (m: string) => void }): void {
	logger?.log?.(
		`checkpoint: repo-sombra indisponivel para ${workspace}; o restore ficara sem snapshots nesta sessao`,
	);
}
