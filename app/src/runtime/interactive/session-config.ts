import type { TeamEvent } from "@cline/core";
import type { ChatCommandState } from "../../utils/chat-commands";
import type { Config } from "../../utils/types";
import {
	criar_controlador_de_checkpoint,
	resolver_workspace,
} from "../checkpoint-shadow";
import {
	CLI_DEFAULT_CHECKPOINT_CONFIG,
	CLI_DEFAULT_LOOP_DETECTION,
} from "../defaults";

export function buildInteractiveSessionConfig(input: {
	config: Config;
	chatCommandState: ChatCommandState;
	runtimeHooks: { hooks?: Config["hooks"] };
	onTeamEvent: (event: TeamEvent) => void;
	resolveMistakeLimitDecision: Config["onConsecutiveMistakeLimitReached"];
}): Config {
	// Mesma resolucao usada na criacao e no restore (ver session-runtime.ts).
	// Divergir aqui gravava o snapshot no shadow de um diretorio e o restore
	// procurava em outro.
	const workspace = resolver_workspace({
		workspaceRoot:
			input.chatCommandState.workspaceRoot?.trim() || input.config.workspaceRoot,
		cwd: input.config.cwd,
		chatCommandState: input.chatCommandState,
	});
	// O checkpoint do core exige que o cwd ja seja um repo git; em pasta sem git
	// ele vira no-op silencioso. Injetamos um snapshot em repo-sombra por workspace
	// (ver checkpoint-shadow.ts) para o checkpoint valer em QUALQUER diretorio.
	const checkpoint = {
		...(input.config.checkpoint ?? CLI_DEFAULT_CHECKPOINT_CONFIG),
		createCheckpoint: criar_controlador_de_checkpoint(
			workspace,
			input.config.logger,
		),
	};
	return {
		...input.config,
		execution: {
			...input.config.execution,
			loopDetection:
				input.config.execution?.loopDetection ?? CLI_DEFAULT_LOOP_DETECTION,
		},
		checkpoint,
		enableTools: input.chatCommandState.enableTools,
		cwd: input.chatCommandState.cwd,
		workspaceRoot: input.chatCommandState.workspaceRoot,
		hooks: input.runtimeHooks.hooks,
		onTeamEvent: input.onTeamEvent,
		onConsecutiveMistakeLimitReached: input.resolveMistakeLimitDecision,
	};
}
