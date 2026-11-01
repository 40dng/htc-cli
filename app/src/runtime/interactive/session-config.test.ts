import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChatCommandState } from "../../utils/chat-commands";
import type { Config } from "../../utils/types";
import { diretorio_do_shadow } from "../checkpoint-shadow";
import { buildInteractiveSessionConfig } from "./session-config";

let raiz = "";
let workspace = "";
let cwd = "";

beforeEach(() => {
	raiz = mkdtempSync(join(tmpdir(), "htc-scfg-"));
	workspace = join(raiz, "ws");
	cwd = join(raiz, "cwd");
	mkdirSync(workspace, { recursive: true });
	mkdirSync(cwd, { recursive: true });
	process.env.HTC_CHECKPOINT_DIR = join(raiz, "shadow");
});

afterEach(() => {
	delete process.env.HTC_CHECKPOINT_DIR;
	rmSync(raiz, { recursive: true, force: true });
});

describe("config interativa — checkpoint", () => {
	it("mantem o checkpoint ligado e com controlador proprio", () => {
		const config = buildInteractiveSessionConfig({
			config: { cwd } as unknown as Config,
			chatCommandState: { cwd, workspaceRoot: workspace } as unknown as ChatCommandState,
			runtimeHooks: {},
			onTeamEvent: () => {},
			resolveMistakeLimitDecision: undefined as never,
		});
		expect(config.checkpoint?.enabled).toBe(true);
		expect(typeof config.checkpoint?.createCheckpoint).toBe("function");
	});

	it("grava o snapshot no workspaceRoot, nao no cwd", async () => {
		writeFileSync(join(workspace, "alvo.txt"), "estado\n");
		const config = buildInteractiveSessionConfig({
			config: { cwd } as unknown as Config,
			chatCommandState: { cwd, workspaceRoot: workspace } as unknown as ChatCommandState,
			runtimeHooks: {},
			onTeamEvent: () => {},
			resolveMistakeLimitDecision: undefined as never,
		});
		const resultado = await config.checkpoint?.createCheckpoint?.({
			cwd,
			sessionId: "sessao-config",
			runCount: 1,
		} as never);
		expect(resultado?.ref).toMatch(/^[0-9a-f]{40}$/);
		expect(existsSync(diretorio_do_shadow(workspace))).toBe(true);
		expect(existsSync(diretorio_do_shadow(cwd))).toBe(false);
	});
});
