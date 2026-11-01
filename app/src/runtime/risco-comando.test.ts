import { describe, expect, it } from "vitest";
import {
	classificar_risco,
	classificar_risco_da_ferramenta,
	TIMEOUT_RISCO_MS,
} from "./risco-comando";

describe("classificar_risco", () => {
	it("marks bare/root listings as high risk of freeze", () => {
		for (const cmd of ["ls", "ls -la", "ls /", "dir /s", "dir /s /b", "tree"]) {
			expect(classificar_risco(cmd).nivel).toBe("high");
		}
	});

	it("marks recursive searches and scans as high", () => {
		for (const cmd of ["grep -r foo .", "rg --files /", "find / -name x"]) {
			expect(classificar_risco(cmd).nivel).toBe("high");
		}
	});

	it("keeps narrow listings and reads at medium", () => {
		expect(classificar_risco("ls src").nivel).toBe("medium");
		expect(classificar_risco("cat file.txt").nivel).toBe("medium");
	});

	it("keeps everyday commands at low", () => {
		for (const cmd of ["echo hi", "node -e \"console.log(1)\"", "npm test"]) {
			expect(classificar_risco(cmd).nivel).toBe("low");
		}
	});

	it("gives high-risk commands the shortest timeout", () => {
		expect(classificar_risco("ls /").timeout_ms).toBe(TIMEOUT_RISCO_MS.high);
		expect(classificar_risco("echo hi").timeout_ms).toBe(TIMEOUT_RISCO_MS.low);
	});
});

describe("classificar_risco_da_ferramenta", () => {
	it("treats a terminal tool as high when the command text is unknown", () => {
		expect(classificar_risco_da_ferramenta("run_commands")).toBe("high");
	});

	it("uses the fine-grained command analysis when the text is known", () => {
		expect(classificar_risco_da_ferramenta("run_commands", "echo hi")).toBe(
			"low",
		);
		expect(classificar_risco_da_ferramenta("run_commands", "ls")).toBe("high");
	});

	it("marks heavy file tools as medium", () => {
		expect(classificar_risco_da_ferramenta("read_files")).toBe("medium");
		expect(classificar_risco_da_ferramenta("search_codebase")).toBe("medium");
	});

	it("returns undefined for unclassified tools", () => {
		expect(classificar_risco_da_ferramenta("ask_question")).toBeUndefined();
		expect(classificar_risco_da_ferramenta(undefined)).toBeUndefined();
	});
});
