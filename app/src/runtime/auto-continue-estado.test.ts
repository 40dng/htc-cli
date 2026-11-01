import { describe, expect, it } from "vitest";
import { resolverAutoContinue } from "./interactive/session-runtime";

describe("resolverAutoContinue", () => {
	it("com trabalho pendente e sem decisao explicita, retoma sozinho", () => {
		expect(resolverAutoContinue(undefined, () => true).enabled).toBe(true);
		expect(
			resolverAutoContinue({ max: 10 }, () => true).enabled,
		).toBe(true);
	});

	it("sem trabalho pendente, um turno por mensagem", () => {
		expect(resolverAutoContinue(undefined, () => false).enabled).toBe(false);
	});

	it("decisao explicita vence o estado do disco", () => {
		expect(resolverAutoContinue({ enabled: false }, () => true).enabled).toBe(
			false,
		);
		expect(resolverAutoContinue({ enabled: true }, () => false).enabled).toBe(
			true,
		);
	});

	it("preserva o resto da configuracao", () => {
		const cfg = resolverAutoContinue(
			{ max: 7, stopOnQuestion: false },
			() => true,
		);
		expect(cfg.max).toBe(7);
		expect(cfg.stopOnQuestion).toBe(false);
	});
});
