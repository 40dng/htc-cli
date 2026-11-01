import type { AgentSideConnection } from "@agentclientprotocol/sdk";
import type { AgentEvent } from "@cline/core";
import { describe, expect, it, vi } from "vitest";
import { forwardAgentEvent } from "./session-updates";

describe("forwardAgentEvent", () => {
	it("forwards generated images as ACP agent message chunks", () => {
		const sessionUpdate = vi.fn().mockResolvedValue(undefined);
		const connection = { sessionUpdate } as unknown as AgentSideConnection;

		forwardAgentEvent(connection, "session-1", {
			type: "content_end",
			contentType: "media",
			media: {
				id: "generated-1",
				modality: "image",
				mediaType: "image/png",
				source: { type: "base64", data: "aGVsbG8=" },
			},
		} as AgentEvent);

		expect(sessionUpdate).toHaveBeenCalledWith({
			sessionId: "session-1",
			update: {
				sessionUpdate: "agent_message_chunk",
				content: {
					type: "image",
					data: "aGVsbG8=",
					mimeType: "image/png",
				},
			},
		});
	});

	it("does not forward the model's reasoning by default", () => {
		const sessionUpdate = vi.fn().mockResolvedValue(undefined);
		const connection = { sessionUpdate } as unknown as AgentSideConnection;
		const anterior = process.env.HTC_MOSTRAR_PENSAMENTO;
		delete process.env.HTC_MOSTRAR_PENSAMENTO;
		try {
			forwardAgentEvent(connection, "session-1", {
				type: "content_start",
				contentType: "reasoning",
				reasoning: "rascunho do modelo",
			} as AgentEvent);
			expect(sessionUpdate).not.toHaveBeenCalled();
		} finally {
			if (anterior !== undefined) process.env.HTC_MOSTRAR_PENSAMENTO = anterior;
		}
	});

	it("forwards reasoning as thought chunk when HTC_MOSTRAR_PENSAMENTO=1", () => {
		const sessionUpdate = vi.fn().mockResolvedValue(undefined);
		const connection = { sessionUpdate } as unknown as AgentSideConnection;
		const anterior = process.env.HTC_MOSTRAR_PENSAMENTO;
		process.env.HTC_MOSTRAR_PENSAMENTO = "1";
		try {
			forwardAgentEvent(connection, "session-1", {
				type: "content_start",
				contentType: "reasoning",
				reasoning: "rascunho do modelo",
			} as AgentEvent);
			expect(sessionUpdate).toHaveBeenCalledWith({
				sessionId: "session-1",
				update: {
					sessionUpdate: "agent_thought_chunk",
					content: { type: "text", text: "rascunho do modelo" },
				},
			});
		} finally {
			if (anterior === undefined) delete process.env.HTC_MOSTRAR_PENSAMENTO;
			else process.env.HTC_MOSTRAR_PENSAMENTO = anterior;
		}
	});
});
