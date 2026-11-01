/**
 * HTC — providers free (compat)
 *
 * O estado real vive em `prefs.json` (utils/prefs.ts). Este modulo mantem a
 * API antiga (`lerFree`/`definirFree`/`freeLigado`) para o resto do codigo.
 */
import {
	type CanalFree,
	caminhoPrefs,
	definirFree as definirFreePref,
	freeLigado as freeLigadoPref,
	lerPrefs,
	salvarPrefs,
} from "./prefs";

export type FreeState = Record<CanalFree, boolean>;

export function caminhoFree(): string {
	return caminhoPrefs();
}

export function lerFree(): FreeState {
	return lerPrefs().free;
}

export function definirFree(id: CanalFree, ligado: boolean): FreeState {
	return definirFreePref(id, ligado).free;
}

export function freeLigado(id: CanalFree): boolean {
	return freeLigadoPref(id);
}

export { salvarPrefs };
