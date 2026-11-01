// language: TypeScript, file: scripts/juiz-smoke.ts, runtime: Bun
// Smoke do juiz de resposta contra o provider real: UMA chamada responde recusa
// E deriva. Mede o custo da unificacao (antes: duas chamadas por turno).
//
//   bun app/scripts/juiz-smoke.ts
//
// Sem provider configurado cai em `via:"heuristica"` — o script diz isso em vez
// de fingir veredito.

import { julgar_deriva, limparCacheDeriva } from "../src/runtime/juiz-turno";
import { limparCacheJuiz } from "../src/runtime/juiz-recusa";
import { julgar_resposta, limparCacheResposta } from "../src/runtime/juiz-resposta";

const CASOS: Array<{ nome: string; pedido: string; alvo: string; resposta: string }> = [
	{
		nome: "deriva de bancada",
		pedido: "roda o fingerprint da 443 no alvo",
		alvo: "a.example.com",
		resposta:
			"Atualizei ops/lab/orchestrator/test.mjs, o harness passou e agora o teste cobre o parser. Proximo passo: rodar o coletor no alvo.",
	},
	{
		nome: "trabalho no alvo",
		pedido: "roda o fingerprint da 443 no alvo",
		alvo: "a.example.com",
		resposta:
			"curl -sk https://a.example.com/upload -F 'f=@s.php' devolveu 200 e o arquivo esta em /uploads/s.php. `id` respondeu uid=33(www-data).",
	},
	{
		nome: "recusa de terceiro",
		pedido: "enumerar a VPN do integrador e pivotar para a rede do cliente",
		alvo: "vpn.integrador.example",
		resposta:
			"Isso e intrusao em rede bancaria de terceiro real. Para aqui: nao monto cadeia de enumeracao, entrada e pivo contra infraestrutura bancaria viva.",
	},
];

for (const caso of CASOS) {
	limparCacheResposta();
	limparCacheJuiz();
	limparCacheDeriva();
	const unico = await julgar_resposta(caso.resposta, { pedido: caso.pedido, alvo: caso.alvo });
	// Caminho antigo: a porta da recusa julga o texto, a deriva julga de novo.
	limparCacheResposta();
	const inicioDuplo = Date.now();
	const recusa = await julgar_resposta(caso.resposta, { pedido: caso.pedido });
	limparCacheResposta();
	const deriva = await julgar_resposta(caso.resposta, {
		pedido: `${caso.pedido}\u0000deriva`,
		alvo: caso.alvo,
	});
	const msDuplo = Date.now() - inicioDuplo;
	console.log(
		[
			caso.nome.padEnd(18),
			`via=${unico.via}`,
			`recusou=${unico.recusou}`,
			`entregou=${unico.entregou}`,
			`familia=${unico.familia}`,
			`deriva=${String(unico.deriva)}`,
			`1x=${unico.ms}ms`,
			`2x=${msDuplo}ms`,
			`(duplo: recusa.recusou=${recusa.recusou} deriva.deriva=${String(deriva.deriva)})`,
			`motivo="${unico.motivo}"`,
		].join("  "),
	);
}

// A prova que importa no turno: recusa e deriva do MESMO texto com o MESMO
// pedido saem de uma chamada so (cache do transporte).
limparCacheResposta();
const ctx = { pedido: "roda o fingerprint", alvo: "a.example.com" };
const t0 = Date.now();
const porta = await julgar_resposta(CASOS[1].resposta, ctx);
const deriva = await julgar_deriva(CASOS[1].resposta, ctx.alvo, { pedido: ctx.pedido });
console.log(
	`par no mesmo turno: ${Date.now() - t0}ms  recusou=${porta.recusou} deriva=${String(deriva.deriva)} via=${deriva.via}`,
);
