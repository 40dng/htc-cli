// language: TypeScript, file: src/runtime/supervisor.ts, target: Bun / Windows
// Supervisor EXTERNO do CLI. Qualquer vigia no mesmo event loop do agente nao
// alcanca o freeze que bloqueia o loop: nenhum timer interno dispara e "nada
// acontece" — exatamente o que a issue cline#13306 mostra.
//
// Este processo e separado. Ele le o batimento do CLI (heartbeat.ts); se a
// idade passar do limiar, pede abort (arquivo) e, se continuar congelado, MATA a
// arvore do processo. Se havia terminal e sessao conhecida, RELANCA o CLI com
// `--id <sessao>` e injeta externamente o "pensamento" de retomada via
// HTC_RESUME_NUDGE — o turno novo que destrava o estado congelado.

import { spawn, spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { caminho_da_retomada, ler_heartbeat } from "./heartbeat";
import {
	type AcaoSupervisor,
	avaliar_supervisor,
	type ConfigSupervisorLogica,
	ler_config_supervisor,
} from "./supervisor-logic";

export interface EspecificacaoSupervisor {
	heartbeat: string;
	abort: string;
	pid: number;
	sessao?: string;
	cwd: string;
	modo: string;
	tty: boolean;
	nudge: string;
	poll_ms?: number;
	logica?: Partial<ConfigSupervisorLogica>;
}

export const NUDGE_SUPERVISOR = [
	"[WATCHDOG RESUME — the previous run froze mid-execution and was restarted externally]",
	"Continue the task from exactly where it stopped; do not repeat completed work.",
	"If the last terminal command was a broad listing or recursive scan, do not repeat it:",
	"use a bounded command instead (narrow the path, add a limit/head, or read the file in ranges).",
].join("\n");

function dormir(ms: number): Promise<void> {
	return new Promise((resolve) => {
		// NAO usar unref() aqui. O loop do supervisor e a UNICA coisa que o
		// mantem vivo: com o timer unref'd o processo nao tem handle ref'd
		// nenhum e SAI antes de ler o primeiro batimento — era exatamente por
		// isso que "nada externo estava olhando". O encerramento limpo acontece
		// quando `avaliar_supervisor` devolve `desistir` (batimento sumiu).
		setTimeout(resolve, ms);
	});
}

/** Filhos diretos de `pid` (so Windows). Vazio quando o SO nao responde. */
function pids_filhos(pid: number): number[] {
	if (process.platform !== "win32") return [];
	try {
		const r = spawnSync(
			"powershell",
			[
				"-NoProfile",
				"-NonInteractive",
				"-Command",
				`(Get-CimInstance Win32_Process -Filter "ParentProcessId=${pid}").ProcessId`,
			],
			{ encoding: "utf8", windowsHide: true, timeout: 4_000 },
		);
		if (r.status !== 0 || !r.stdout) return [];
		return r.stdout
			.split(/\s+/)
			.map((s) => Number.parseInt(s, 10))
			.filter((n) => Number.isFinite(n) && n > 0);
	} catch {
		return [];
	}
}

/**
 * Mata o CLI e a arvore de filhos do CLI — mas NUNCA com `/T` no processo alvo.
 * `/T` segue a cadeia de PPID e alcancaria o PROPRIO supervisor (que e filho do
 * CLI), matando o vigia ANTES do relancamento: o freeze terminava sem retomada.
 * Entao: descobre os filhos primeiro, mata cada um (menos o supervisor) e por
 * fim o CLI sem `/T`.
 */
function matar_arvore(pid: number, auto_pid: number): void {
	if (!Number.isFinite(pid) || pid <= 0) return;
	if (process.platform === "win32") {
		for (const filho of pids_filhos(pid)) {
			if (filho === auto_pid || filho === pid) continue;
			try {
				spawnSync("taskkill", ["/PID", String(filho), "/T", "/F"], {
					stdio: "ignore",
					windowsHide: true,
					timeout: 4_000,
				});
			} catch {
				// Best-effort: o filho pode ja ter saido.
			}
		}
		try {
			spawnSync("taskkill", ["/PID", String(pid), "/F"], {
				stdio: "ignore",
				windowsHide: true,
				timeout: 4_000,
			});
		} catch {
			// Best-effort.
		}
		return;
	}
	try {
		process.kill(pid, "SIGKILL");
	} catch {
		// Ja morreu.
	}
}

function relancar(spec: EspecificacaoSupervisor): void {
	if (!spec.tty || !spec.sessao) return;
	const entrada = process.argv[1];
	if (!entrada) return;
	const args = [entrada, "--id", spec.sessao];
	// `--mode` so aceita plan/act no interativo; yolo/zen seriam rejeitados e a
	// retomada nao subiria.
	if (spec.modo === "act" || spec.modo === "plan") {
		args.push("--mode", spec.modo);
	}
	try {
		const filho = spawn(process.execPath, args, {
			detached: true,
			// Herda o terminal quando ele existe: e por este fd que o
			// relancamento (apos o kill) devolve uma TUI viva ao operador.
			stdio: spec.tty ? "inherit" : "ignore",
			cwd: spec.cwd,
			env: { ...process.env, HTC_RESUME_NUDGE: spec.nudge },
			windowsHide: false,
		});
		filho.unref();
	} catch {
		// Sem relancamento automatico; a retomada fica registrada em disco.
	}
}

export interface HandleSupervisor {
	pid?: number;
	parar: () => void;
}

/**
 * Sobe o supervisor como processo DETACHED. Ele sobrevive ao CLI: e o ponto
 * inteiro — vigiar de fora um processo que pode congelar por dentro.
 */
export function iniciar_supervisor(
	spec: EspecificacaoSupervisor,
): HandleSupervisor | undefined {
	// OFF por padrao: o loop do supervisor roda em `__supervisor`, e NADA no entry do CLI
	// despacha esse argumento. Sem o dispatch, o spawn re-executa o CLI inteiro, que sobe
	// outro supervisor — cadeia sem fim (medido: 56 processos em 20 s). Ligar exige
	// HTC_SUPERVISOR=on e o dispatch implementado.
	if ((process.env.HTC_SUPERVISOR ?? "off").trim().toLowerCase() !== "on") {
		return undefined;
	}
	const entrada = process.env.HTC_SUPERVISOR_ENTRY?.trim() || process.argv[1];
	if (!entrada) return undefined;
	// Guarda de forma: o filho roda `entrada __supervisor <spec>`. Se a entrada nao for o
	// CLI (script de teste, wrapper), o filho re-executa um programa que nao despacha esse
	// argumento e sobe outro supervisor — foi assim que 56 processos nasceram em 20 s.
	const base = entrada.replace(/\\/g, "/").split("/").pop() ?? "";
	if (!/^(index\.(ts|js)|htc(\.exe)?)$/i.test(base)) {
		return undefined;
	}
	let pid: number | undefined;
	try {
		const filho = spawn(
			process.execPath,
			[entrada, "__supervisor", JSON.stringify(spec)],
			{
				detached: true,
				// Herda o terminal quando ele existe: e por este fd que o
				// relancamento (apos o kill) devolve uma TUI viva ao operador.
				stdio: spec.tty ? "inherit" : "ignore",
				cwd: spec.cwd,
				env: { ...process.env, HTC_SUPERVISOR_CHILD: "1" },
				windowsHide: !spec.tty,
			},
		);
		pid = filho.pid;
		filho.unref();
	} catch {
		return undefined;
	}
	return {
		pid,
		parar() {
			// O supervisor encerra sozinho quando o batimento some (parar() do
			// CLI remove o arquivo). Nada a fazer aqui.
		},
	};
}

/**
 * Loop do supervisor. Roda DENTRO do processo filho (comando `__supervisor`).
 */
export async function executar_supervisor(
	spec: EspecificacaoSupervisor,
): Promise<void> {
	const config = { ...ler_config_supervisor(), ...spec.logica } as ConfigSupervisorLogica;
	const intervalo = spec.poll_ms ?? Math.max(1_000, Math.floor(config.limiar_freeze_ms / 4));
	let episodio = 0;
	let abort_pedido_em: number | undefined;

	for (;;) {
		await dormir(intervalo);
		const leitura = ler_heartbeat(spec.heartbeat);

		// Recuperou: zera o episodio pendente.
		if (leitura && leitura.idade_ms < config.limiar_freeze_ms) {
			abort_pedido_em = undefined;
			continue;
		}

		const acao: AcaoSupervisor = avaliar_supervisor({
			idade_ms: leitura?.idade_ms,
			// O risco vem do batimento (fase/tool em voo): HIGH encurta o limiar
			// de congelamento, porque e o comando que mais pendura e consome
			// memoria (ls/dir/find/grep -r numa arvore grande).
			risco: leitura?.estado.risco,
			episodio,
			abort_pedido_ha_ms:
				abort_pedido_em === undefined ? undefined : Date.now() - abort_pedido_em,
			config,
		});

		if (acao === "aguardar") continue;
		if (acao === "desistir") return;
		if (acao === "pedir_abort") {
			episodio += 1;
			abort_pedido_em = Date.now();
			try {
				writeFileSync(
					spec.abort,
					JSON.stringify({
						pedido_ms: abort_pedido_em,
						nudge: spec.nudge,
						episodio,
					}),
					"utf8",
				);
			} catch {
				// Se nao der para escrever o pedido, seguimos para o kill pela graca.
			}
			continue;
		}

		// acao === "matar"
		// A sessao VIVA pode ter sido criada depois do spawn (o CLI so a conhece
		// apos o start); o batimento carrega o id real. Preferi-lo ao inicial —
		// senao o relancamento retomaria uma sessao que nunca existiu.
		const sessao = leitura?.estado.sessao ?? spec.sessao;
		const specRetomada: EspecificacaoSupervisor = { ...spec, sessao };
		matar_arvore(spec.pid, process.pid);
		try {
			writeFileSync(
				caminho_da_retomada(spec.pid),
				JSON.stringify({
					pid: spec.pid,
					sessao,
					cwd: spec.cwd,
					modo: spec.modo,
					nudge: spec.nudge,
					em: Date.now(),
					motivo: "freeze_supervisor",
					episodios: episodio,
				}),
				"utf8",
			);
		} catch {
			// Registro best-effort.
		}
		relancar(specRetomada);
		return;
	}
}
