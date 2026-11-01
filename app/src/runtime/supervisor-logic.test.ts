import { describe, expect, it } from "vitest";
import { avaliar_supervisor, type ConfigSupervisorLogica } from "./supervisor-logic";

const config: ConfigSupervisorLogica = {
	limiar_freeze_ms: 12_000,
	limiar_morto_ms: 60_000,
	grace_abort_ms: 5_000,
	max_episodios: 3,
};

describe("avaliar_supervisor", () => {
	it("waits while the heartbeat is fresh", () => {
		expect(
			avaliar_supervisor({
				idade_ms: 3_000,
				episodio: 0,
				abort_pedido_ha_ms: undefined,
				config,
			}),
		).toBe("aguardar");
	});

	it("asks for an abort on the first frozen episode", () => {
		expect(
			avaliar_supervisor({
				idade_ms: 13_000,
				episodio: 0,
				abort_pedido_ha_ms: undefined,
				config,
			}),
		).toBe("pedir_abort");
	});

	it("waits out the grace period before killing", () => {
		expect(
			avaliar_supervisor({
				idade_ms: 13_000,
				episodio: 1,
				abort_pedido_ha_ms: 1_000,
				config,
			}),
		).toBe("aguardar");
	});

	it("kills once the grace has elapsed and it is still frozen", () => {
		expect(
			avaliar_supervisor({
				idade_ms: 20_000,
				episodio: 1,
				abort_pedido_ha_ms: 6_000,
				config,
			}),
		).toBe("matar");
	});

	it("kills immediately when the heartbeat is far too old", () => {
		expect(
			avaliar_supervisor({
				idade_ms: 90_000,
				episodio: 0,
				abort_pedido_ha_ms: undefined,
				config,
			}),
		).toBe("matar");
	});

	it("gives up when the heartbeat vanished (clean exit)", () => {
		expect(
			avaliar_supervisor({
				idade_ms: undefined,
				episodio: 0,
				abort_pedido_ha_ms: undefined,
				config,
			}),
		).toBe("desistir");
	});

	it("gives up after the maximum episodes", () => {
		expect(
			avaliar_supervisor({
				idade_ms: 20_000,
				episodio: 3,
				abort_pedido_ha_ms: 10_000,
				config,
			}),
		).toBe("desistir");
	});

	it("tightens the freeze threshold when a HIGH-risk tool is in flight", () => {
		const comAlto: ConfigSupervisorLogica = {
			...config,
			limiar_freeze_ms_alto: 6_000,
			grace_abort_ms_alto: 2_000,
		};
		// 7s: abaixo do limiar normal (12s), acima do limiar HIGH (6s).
		expect(
			avaliar_supervisor({
				idade_ms: 7_000,
				risco: "high",
				episodio: 0,
				abort_pedido_ha_ms: undefined,
				config: comAlto,
			}),
		).toBe("pedir_abort");
		expect(
			avaliar_supervisor({
				idade_ms: 7_000,
				episodio: 0,
				abort_pedido_ha_ms: undefined,
				config: comAlto,
			}),
		).toBe("aguardar");
	});
});
