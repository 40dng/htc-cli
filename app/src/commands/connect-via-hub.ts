// HTC CLI: hub connector commands stubbed
const NOT_AVAILABLE = "Hub connector not available in HTC CLI";

export async function startConnectorViaHub(_args: unknown, _io: unknown): Promise<void> {
	throw new Error(NOT_AVAILABLE);
}

export async function stopConnectorsViaHub(_io: unknown): Promise<void> {
	throw new Error(NOT_AVAILABLE);
}

export async function listSupervisedConnectorsViaHub(): Promise<null> {
	return null;
}
