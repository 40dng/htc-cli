/**
 * HTC — PATH do OpenCode
 *
 * O provider local sobe `opencode serve` por spawn do nome puro. Quando o
 * binario existe fora do PATH (npm/desktop), o spawn morre com ENOENT
 * ("Failed to start OpenCode server"). Aqui a pasta do binario resolvido entra
 * na frente do PATH — vale para o processo e para os filhos.
 */
import { existsSync } from "node:fs";
import { delimiter, dirname } from "node:path";
import { resolver_binario_opencode } from "../bridge/opencode_binario";

export function garantir_opencode_no_path(): string | undefined {
	if (process.env.HTC_NO_OPENCODE_PATH === "1") {
		return undefined;
	}
	try {
		const binario = resolver_binario_opencode();
		if (!binario || !existsSync(binario)) {
			return undefined;
		}
		const dir = dirname(binario);
		const partes = (process.env.PATH ?? "").split(delimiter);
		if (!partes.includes(dir)) {
			process.env.PATH = `${dir}${delimiter}${process.env.PATH ?? ""}`;
		}
		process.env.HTC_OPENCODE_BIN = binario;
		return binario;
	} catch {
		return undefined;
	}
}
