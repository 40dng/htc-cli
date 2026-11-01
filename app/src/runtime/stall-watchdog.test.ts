import { describe, expect, it } from "vitest";
import {
	embrulhar_executor_com_vigia,
	ExecucaoExcedeuTempo,
	executar_com_vigia,
	ler_timeout_execucao_ms,
	TOOL_TIMEOUT_MS_MINIMO,
	TOOL_TIMEOUT_MS_PADRAO,
	vigia_execucao_ativo,
} from "./stall-watchdog";

describe("vigia_execucao_ativo", () => {
	it("is on by default and off only for the off switch", () => {
		expect(vigia_execucao_ativo({} as NodeJS.ProcessEnv)).toBe(true);
		expect(
			vigia_execucao_ativo({ HTC_TOOL_WATCHDOG: "off" } as NodeJS.ProcessEnv),
		).toBe(false);
	});
});

describe("ler_timeout_execucao_ms", () => {
	it("uses the default when unset or below the minimum", () => {
		expect(ler_timeout_execucao_ms({} as NodeJS.ProcessEnv)).toBe(
			TOOL_TIMEOUT_MS_PADRAO,
		);
		expect(
			ler_timeout_execucao_ms({ HTC_TOOL_TIMEOUT_MS: "10" } as NodeJS.ProcessEnv),
		).toBe(TOOL_TIMEOUT_MS_PADRAO);
	});

	it("honours a valid override above the minimum", () => {
		expect(
			ler_timeout_execucao_ms({
				HTC_TOOL_TIMEOUT_MS: String(TOOL_TIMEOUT_MS_MINIMO + 1),
			} as NodeJS.ProcessEnv),
		).toBe(TOOL_TIMEOUT_MS_MINIMO + 1);
	});
});

function exec_pendurado(chamadas: { n: number }): (
	sinal: AbortSignal,
) => Promise<string> {
	return (sinal: AbortSignal) => {
		chamadas.n += 1;
		return new Promise<string>((_, rejeitar) => {
			if (sinal.aborted) {
				rejeitar(sinal.reason);
				return;
			}
			sinal.addEventListener("abort", () => rejeitar(sinal.reason), {
				once: true,
			});
		});
	};
}

describe("executar_com_vigia", () => {
	it("reexecuta a MESMA funcao ao estourar o tempo e resolve na retomada", async () => {
		const chamadas = { n: 0 };
		const travadas: number[] = [];
		const resultado = await executar_com_vigia(
			(sinal) => {
				chamadas.n += 1;
				if (chamadas.n >= 2) return Promise.resolve("ok");
				return new Promise<string>((_, rejeitar) => {
					sinal.addEventListener("abort", () => rejeitar(sinal.reason), {
						once: true,
					});
				});
			},
			{
				ferramenta: "editor",
				timeout_ms: 15,
				max_tentativas: 2,
				ao_travar: (info) => travadas.push(info.tentativa),
			},
		);
		expect(resultado).toBe("ok");
		expect(chamadas.n).toBe(2);
		expect(travadas).toEqual([1]);
	});

	it("resolve na primeira quando nao trava", async () => {
		let chamadas = 0;
		const resultado = await executar_com_vigia(
			() => {
				chamadas += 1;
				return "done";
			},
			{ ferramenta: "editor", timeout_ms: 50, max_tentativas: 2 },
		);
		expect(resultado).toBe("done");
		expect(chamadas).toBe(1);
	});

	it("propaga ExecucaoExcedeuTempo apos esgotar as tentativas", async () => {
		const chamadas = { n: 0 };
		await expect(
			executar_com_vigia(exec_pendurado(chamadas), {
				ferramenta: "editor",
				timeout_ms: 5,
				max_tentativas: 1,
			}),
		).rejects.toBeInstanceOf(ExecucaoExcedeuTempo);
		expect(chamadas.n).toBe(2);
	});

	it("aborta de imediato quando o sinal externo ja veio abortado", async () => {
		const controlador = new AbortController();
		controlador.abort(new Error("run abortado"));
		const chamadas = { n: 0 };
		await expect(
			executar_com_vigia(
				exec_pendurado(chamadas),
				{ ferramenta: "editor", timeout_ms: 1_000, max_tentativas: 2 },
				controlador.signal,
			),
		).rejects.toThrow("run abortado");
		expect(chamadas.n).toBe(1);
	});
});

describe("embrulhar_executor_com_vigia", () => {
	it("injeta o sinal da tentativa no contexto e reexecuta a mesma tool", async () => {
		let chamadas = 0;
		const exec = async (
			_input: unknown,
			_cwd: string,
			contexto: { signal?: AbortSignal },
		): Promise<string> => {
			chamadas += 1;
			if (chamadas === 1) {
				return await new Promise<string>((_, rejeitar) => {
					contexto.signal?.addEventListener(
						"abort",
						() => rejeitar(contexto.signal?.reason),
						{ once: true },
					);
				});
			}
			return contexto.signal ? "com-sinal" : "sem-sinal";
		};
		const embrulhado = embrulhar_executor_com_vigia("editor", exec, {
			timeout_ms: 15,
			max_tentativas: 2,
		});
		const resultado = await embrulhado(
			{ path: "a.ts" },
			"/tmp",
			{} as never,
		);
		expect(resultado).toBe("com-sinal");
		expect(chamadas).toBe(2);
	});
});
