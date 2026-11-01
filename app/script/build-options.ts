// language: TypeScript, file: script/build-options.ts, runtime: bun/node
// Reconstruido em 2026-10-29: a pasta `script/` foi perdida e estes simbolos eram
// importados por src/commands/build-options.test.ts. Contrato vem do teste, nao de chute:
// --single desliga variantes nativas; build multi-alvo exige --install-native-variants.

export type BuildOptions = {
	single: boolean;
	installNativeVariants: boolean;
};

export function parseBuildOptions(argv: string[]): BuildOptions {
	const options: BuildOptions = { single: false, installNativeVariants: false };
	for (const arg of argv) {
		if (arg === "--single") {
			options.single = true;
			continue;
		}
		if (arg === "--install-native-variants") {
			options.installNativeVariants = true;
		}
	}
	return options;
}

export function shouldInstallNativeVariants(input: {
	options: BuildOptions;
	opentuiVersion: string;
}): boolean {
	return input.options.installNativeVariants && !input.options.single;
}

export function validateBuildOptions(input: {
	options: BuildOptions;
	opentuiVersion: string;
	targetCount: number;
}): string | undefined {
	if (input.targetCount > 1 && !shouldInstallNativeVariants(input)) {
		return `build para ${input.targetCount} alvos exige --install-native-variants (opentui ${input.opentuiVersion})`;
	}
	return undefined;
}
