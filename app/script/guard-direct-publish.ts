// language: TypeScript, file: script/guard-direct-publish.ts, runtime: bun/node
// Reconstruido em 2026-10-29 (a pasta `script/` foi perdida).
// Existe para impedir publicar o FONTE direto no npm: o contrato e' o binario compilado,
// conforme docs/SEGURANCA.md ("o artefato publicado nao pode permitir reconstruir src/").

export const DIRECT_PUBLISH_GUARD_MESSAGE =
	"Direct packaging or publishing from apps/cli is disabled. Use the release flow (bun run compile:all) so dist/ is packaged instead of src/.";

export function shouldAllowDirectPublish(
	env: Record<string, string | undefined>,
): boolean {
	return env.CLINE_ALLOW_DIRECT_PUBLISH === "1";
}
