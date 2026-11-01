import type { CheckpointEntry } from "@cline/core";
import type { MessageWithMetadata } from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	checkpoint_para_run,
	mesclar_historico_de_checkpoint,
	run_esta_na_transcricao,
} from "./checkpoint-history";

function entrada(runCount: number, ref = `ref-${runCount}`): CheckpointEntry {
	return { ref, createdAt: runCount * 1000, runCount, kind: "commit" };
}

function prompt(texto: string): MessageWithMetadata {
	return { role: "user", content: [{ type: "text", text: texto }] } as MessageWithMetadata;
}

describe("mesclar_historico_de_checkpoint", () => {
	it("junta metadata da sessao com os refs do shadow", () => {
		const sessao = [entrada(2, "da-sessao")];
		const shadow = [entrada(1), entrada(2, "do-shadow"), entrada(3)];

		expect(mesclar_historico_de_checkpoint(sessao, shadow)).toEqual([
			entrada(1),
			entrada(2, "da-sessao"),
			entrada(3),
		]);
	});

	it("snapshot de outra sessao no mesmo run sobrevive ao merge", () => {
		const daSessao: CheckpointEntry[] = [
			{ ref: "da-sessao", createdAt: 2000, runCount: 1, kind: "commit" },
		];
		const doShadow: CheckpointEntry[] = [
			{
				ref: "de-outra-sessao",
				createdAt: 1000,
				runCount: 1,
				kind: "commit",
				...( { sessionId: "sessao-x" } as object),
			} as CheckpointEntry,
		];
		expect(
			mesclar_historico_de_checkpoint(daSessao, doShadow).map((e) => e.ref),
		).toEqual(["de-outra-sessao", "da-sessao"]);
	});

	it("devolve o historico do shadow quando a sessao nasceu sem metadata", () => {
		// Troca de modelo / sessao nova: metadata vazio, snapshots no disco.
		const shadow = [entrada(3), entrada(1), entrada(2)];
		expect(mesclar_historico_de_checkpoint([], shadow).map((e) => e.runCount)).toEqual([
			1, 2, 3,
		]);
	});

	it("descarta entrada sem ref ou com run invalido", () => {
		const invalidas = [
			{ ref: "", createdAt: 1, runCount: 1, kind: "commit" },
			{ ref: "x", createdAt: 1, runCount: 0, kind: "commit" },
		] as CheckpointEntry[];
		expect(mesclar_historico_de_checkpoint(invalidas, [entrada(5)])).toEqual([
			entrada(5),
		]);
	});
});

describe("checkpoint_para_run", () => {
	it("escolhe o snapshot mais alto em ou antes do run", () => {
		const historico = [entrada(1), entrada(4), entrada(7)];
		expect(checkpoint_para_run(historico, 5)?.runCount).toBe(4);
		expect(checkpoint_para_run(historico, 7)?.runCount).toBe(7);
	});

	it("nao devolve nada antes do primeiro snapshot", () => {
		expect(checkpoint_para_run([entrada(3)], 2)).toBeUndefined();
	});
});

describe("run_esta_na_transcricao", () => {
	it("conta so turno real do operador", () => {
		const mensagens = [
			prompt("um"),
			{
				role: "user",
				content: [{ type: "tool_result", tool_use_id: "t", content: "ok" }],
			} as unknown as MessageWithMetadata,
			prompt("dois"),
		];
		expect(run_esta_na_transcricao(mensagens, 1)).toBe(true);
		expect(run_esta_na_transcricao(mensagens, 2)).toBe(true);
		expect(run_esta_na_transcricao(mensagens, 3)).toBe(false);
	});

	it("recusa run dobrado num resumo de compactacao", () => {
		const resumo = {
			role: "user",
			content: [{ type: "text", text: "contexto compactado" }],
			metadata: { kind: "compaction", userRunSpan: 2 },
		} as unknown as MessageWithMetadata;
		expect(run_esta_na_transcricao([resumo], 1)).toBe(false);
		expect(run_esta_na_transcricao([resumo], 2)).toBe(true);
	});
});
