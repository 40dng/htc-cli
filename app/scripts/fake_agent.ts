// file: scripts/fake_agent.ts — emula o contrato --json do CLI para testar o painel
// sem provider. Nao e usado em producao: HTC_WEB_AGENT_CMD aponta para ele no teste.
console.log(JSON.stringify({ type: "run_start", sessionId: "sess_fake_1", providerId: "fake", modelId: "fake" }));
for (const pedaco of ["turno ", "de teste ", "no painel\n"]) {
	console.log(JSON.stringify({ type: "agent_event", event: { type: "text", text: pedaco } }));
	await Bun.sleep(25);
}
console.log(JSON.stringify({ type: "agent_event", event: { type: "tool", name: "bash" } }));
console.log(JSON.stringify({ type: "stderr", line: "[auto-continue] turno 1/inf — retomando a fila" }));
console.log(JSON.stringify({ type: "exit", code: 0 }));
