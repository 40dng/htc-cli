// HTC CLI: connector commands stubbed (no chat adapter deps)
const NOT_AVAILABLE = "Connect command not available in HTC CLI";

export async function stopAllConnectors(_io: unknown): Promise<{ executed: number; stopped: number; stoppedProcesses: number; stoppedSessions: number }> {
	return { executed: 0, stopped: 0, stoppedProcesses: 0, stoppedSessions: 0 };
}

export async function runConnect(_args: unknown, _io: unknown): Promise<void> {
	throw new Error(NOT_AVAILABLE);
}

export function formatAdapterList(): string { return ""; }

export async function runCleanupConnectorInstance(..._args: unknown[]): Promise<number> {
	throw new Error(NOT_AVAILABLE);
}

export async function runConnectAdapter(..._args: unknown[]): Promise<number> {
	throw new Error(NOT_AVAILABLE);
}

export async function runRestartConnector(..._args: unknown[]): Promise<number> {
	throw new Error(NOT_AVAILABLE);
}

export async function runStopAllConnectors(_io: unknown): Promise<number> {
	throw new Error(NOT_AVAILABLE);
}

export async function runStopConnector(..._args: unknown[]): Promise<number> {
	throw new Error(NOT_AVAILABLE);
}
