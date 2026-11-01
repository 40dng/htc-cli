import { spawn } from "node:child_process";
import {
	existsSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { caminho_da_retomada } from "./heartbeat";
import { executar_supervisor } from "./supervisor";

const ativo = process.env.HTC_SUPERVISOR_LIVE === "1";
const talvez = ativo ? describe : describe.skip;

talvez("supervisor E2E", () => {
	it("kills a frozen process and records the resume", async () => {
		const dir = mkdtempSync(join(tmpdir(), "htc-sup-e2e-"));
		const alvo = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
			stdio: "ignore",
		});
		await new Promise((resolve) => setTimeout(resolve, 500));
		const pid = alvo.pid;
		expect(typeof pid).toBe("number");
		const heartbeat = join(dir, "hb.json");
		const abort = join(dir, "abort.json");
		// Batimento parado ha 2s: conta como congelado (limiar 1s), mas ainda
		// dentro do limite de "morto". Deve pedir abort, esperar a graca e matar.
		writeFileSync(
			heartbeat,
			JSON.stringify({
				v: 1,
				pid,
				seq: 1,
				atualizado_ms: Date.now() - 2_000,
				fase: "tool_start",
			}),
			"utf8",
		);
		await executar_supervisor({
			heartbeat,
			abort,
			pid: pid as number,
			cwd: dir,
			modo: "act",
			tty: false,
			nudge: "resume",
			poll_ms: 100,
			logica: {
				limiar_freeze_ms: 1_000,
				limiar_morto_ms: 60_000,
				grace_abort_ms: 100,
				max_episodios: 2,
			},
		});
		let vivo = true;
		try {
			process.kill(pid as number, 0);
		} catch {
			vivo = false;
		}
		expect(vivo).toBe(false);
		expect(existsSync(caminho_da_retomada(pid as number))).toBe(true);
		rmSync(dir, { recursive: true, force: true });
	}, 20_000);
});
