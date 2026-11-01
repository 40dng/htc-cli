#!/usr/bin/env bun
import { claimHubDaemonProcess } from "@cline/shared";

// `__supervisor` e o loop que vigia o agente e o relanca se congelar. Sem este dispatch,
// o spawn em iniciar_supervisor re-executava o CLI inteiro e subia outro supervisor em
// cadeia (medido: 56 processos em 20 s). O despacho tem de vir ANTES de qualquer coisa.
if (process.argv[2] === "__supervisor") {
	const spec = JSON.parse(process.argv[3] ?? "{}");
	const { executar_supervisor } = await import("./runtime/supervisor");
	await executar_supervisor(spec);
	process.exit(0);
}

// O sentinela escolhe a personalidade ANTES de qualquer parse de argumento:
// daemon do hub (hospeda runtimes de sessao) ou a CLI.
if (claimHubDaemonProcess()) {
	await import("@cline/core/hub/daemon-entry");
} else {
	const { runCli } = await import("./main");
	await runCli();
}
