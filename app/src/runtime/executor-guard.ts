// language: TypeScript, file: src/runtime/executor-guard.ts, target: Bun / Windows
// Embrulha os executores de tool no vigia de EXECUCAO (teto por chamada +
// reexecucao com os mesmos argumentos). Um write/edit/read que passa do teto
// (ou perde o fluxo) e abortado e retomado, sem prompt novo.
//
// Bash fica de fora de proposito: a guarda de comando (`command-guard.ts`) ja
// barra o que pendura o shell, o core injeta um `executionController` proprio no
// run_commands (teto de 30s + `taskkill /T /F`) e reexecutar um comando de
// terminal nao e idempotente — repetir um `rm`/`mv` que ja rodou pela metade
// seria pior que esperar. O turno inteiro continua coberto pelo vigia de FLUXO.

import { createDefaultExecutors, type ToolExecutors } from "@cline/core";
import { embrulhar_executor_com_vigia } from "./stall-watchdog";

export function criar_executores_com_vigia(
	base: Partial<ToolExecutors> = createDefaultExecutors(),
): Partial<ToolExecutors> {
	// Devolve SO os executores embrulhados (nao espalha o `base` inteiro): assim
	// o override cobre exatamente editor/apply_patch/read_files e o core continua
	// dono de bash/search/webFetch. Espalhar o base trocaria o executor de bash
	// do core pelo default do CLI, quebrando o executionController dele.
	const vigiados: Partial<ToolExecutors> = {};
	if (base.editor) {
		vigiados.editor = embrulhar_executor_com_vigia("editor", base.editor);
	}
	if (base.applyPatch) {
		vigiados.applyPatch = embrulhar_executor_com_vigia(
			"apply_patch",
			base.applyPatch,
		);
	}
	if (base.readFile) {
		vigiados.readFile = embrulhar_executor_com_vigia(
			"read_files",
			base.readFile,
		);
	}
	return vigiados;
}
