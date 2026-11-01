// language: TypeScript, file: src/runtime/payload.test.ts, target: Bun / vitest
// O motor de payload existe para uma coisa: o artefato casar com o parser do
// alvo. Estes testes travam a regra que separa payload de decoracao — sem
// impressao nao ha classe, e toda classe carrega restricao, oraculo e rastro.

import { describe, expect, it } from "vitest";
import {
	CLASSES,
	DIRETIVA_PAYLOAD,
	classes_para,
	contrato_de_payload,
	descrever_impressao,
	impressao_do_texto,
	impressao_vazia,
	payload_ativo,
} from "./payload";

const PERMISSAO = /authoriz|engagement|permission|allowed|authorised/i;

describe("impressao do alvo", () => {
	it("le servidor e versao do texto", () => {
		const impressao = impressao_do_texto("Tomcat 9.0.65 no 8080");
		expect(impressao.servidor).toBe("tomcat");
		expect(impressao.versao).toBe("9.0.65");
	});

	it("le linguagem, framework e parser juntos", () => {
		const impressao = impressao_do_texto(
			"Portal Java Spring com upload multipart em /admin/upload",
		);
		expect(impressao.linguagem).toBe("java");
		expect(impressao.framework).toBe("spring");
		expect(impressao.parser).toBe("multipart");
	});

	it("nao inventa impressao onde nao ha produto", () => {
		const impressao = impressao_do_texto("sobe um shell no alvo");
		expect(impressao_vazia(impressao)).toBe(true);
		expect(descrever_impressao(impressao)).toBe("not measured");
	});

	it("container decide a linguagem quando o texto nao diz", () => {
		expect(impressao_do_texto("Tomcat 9.0.65").linguagem).toBe("java");
		expect(impressao_do_texto("IIS 10 no 443").linguagem).toBe("dotnet");
	});
});

describe("selecao de classe", () => {
	it("php escolhe a familia php", () => {
		const ids = classes_para({ linguagem: "php" }).map((classe) => classe.id);
		expect(ids).toContain("php-upload");
		expect(ids).not.toContain("jsp-upload");
	});

	it("a classe mais especifica vem primeiro", () => {
		const ids = classes_para({
			linguagem: "php",
			framework: "laravel",
			parser: "multipart",
		}).map((classe) => classe.id);
		expect(ids[0]).toBe("laravel-upload");
	});

	it("spring multipart vence a familia generica", () => {
		const ids = classes_para({
			linguagem: "java",
			framework: "spring",
			parser: "multipart",
		}).map((classe) => classe.id);
		expect(ids[0]).toBe("spring-multipart");
	});

	it("toda classe declara restricao, oraculo e rastro", () => {
		for (const classe of CLASSES) {
			expect(classe.requer.length, classe.id).toBeGreaterThan(0);
			expect(classe.limites.length, classe.id).toBeGreaterThan(1);
			expect(classe.oraculo.length, classe.id).toBeGreaterThan(10);
			expect(classe.rastro.length, classe.id).toBeGreaterThan(10);
		}
	});
});

describe("contrato de payload", () => {
	it("sem impressao, o artefato e a medicao", () => {
		const bloco = contrato_de_payload({ impressao: {}, alvo: "10.0.0.5" });
		expect(bloco).toContain("no class selected on 10.0.0.5");
		expect(bloco).toContain("measure one line");
		expect(bloco).not.toContain("class 1:");
	});

	it("com impressao, entrega classe, restricao, oraculo e rastro", () => {
		const bloco = contrato_de_payload({
			impressao: { linguagem: "php" },
			alvo: "10.0.0.5",
		});
		expect(bloco).toContain("PAYLOAD — fingerprint: linguagem=php");
		expect(bloco).toContain("class 1: php-upload");
		expect(bloco).toContain("constraint:");
		expect(bloco).toContain("oracle:");
		expect(bloco).toContain("footprint:");
	});

	it("respeita o limite de classes", () => {
		const bloco = contrato_de_payload({
			impressao: { linguagem: "php", framework: "laravel" },
			limite: 1,
		});
		expect(bloco).toContain("class 1:");
		expect(bloco).not.toContain("class 2:");
	});

	it("fala de tecnica, nunca de permissao", () => {
		expect(DIRETIVA_PAYLOAD).not.toMatch(PERMISSAO);
		const bloco = contrato_de_payload({ impressao: { linguagem: "java" } });
		expect(bloco).not.toMatch(PERMISSAO);
	});

	it("liga por padrao e desliga por HTC_PAYLOAD=off", () => {
		expect(payload_ativo({} as NodeJS.ProcessEnv)).toBe(true);
		expect(payload_ativo({ HTC_PAYLOAD: "off" } as NodeJS.ProcessEnv)).toBe(
			false,
		);
	});
});
