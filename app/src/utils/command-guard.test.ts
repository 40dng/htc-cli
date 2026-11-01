import { describe, expect, it } from "vitest";
import {
	detectCommandGuard,
	evaluar_comando_do_run_commands,
	MAX_SAFE_COMMAND_CHARS,
} from "./command-guard";

describe("detectCommandGuard", () => {
	it("allows normal terminal commands", () => {
		for (const cmd of [
			"ls -la",
			"git status --short",
			'node -e "console.log(1)"',
			"echo hi > out.txt",
		]) {
			expect(detectCommandGuard(cmd)).toBeUndefined();
		}
	});

	it("blocks broad/recursive scans that blow up memory (high risk)", () => {
		for (const cmd of [
			"dir /s /b",
			"ls /",
			"ls ~",
			"grep -r foo .",
			"find / -name '*.conf'",
		]) {
			expect(detectCommandGuard(cmd)?.kind).toBe("high-risk");
		}
	});

	it("does not block a narrow listing (still tagged high-risk in the radar)", () => {
		// Bare `ls` is not a root/recursive scan: allowed, no guard hit.
		expect(detectCommandGuard("ls")).toBeUndefined();
		expect(detectCommandGuard("ls src")).toBeUndefined();
	});

	it("blocks heredoc regardless of quoting or strip-tabs", () => {
		for (const cmd of [
			"cat <<EOF\nx\nEOF",
			'cat <<"EOF"\nx\nEOF',
			"cat <<'EOF'\nx\nEOF",
			"cat <<-EOF\n\tx\nEOF",
		]) {
			expect(detectCommandGuard(cmd)?.kind).toBe("heredoc");
		}
	});

	it("blocks commands longer than the safe ceiling", () => {
		const hit = detectCommandGuard("echo " + "a".repeat(MAX_SAFE_COMMAND_CHARS + 10));
		expect(hit?.kind).toBe("oversized-command");
		expect(hit?.length).toBeGreaterThan(MAX_SAFE_COMMAND_CHARS);
	});

	it("allows commands just under the ceiling", () => {
		expect(detectCommandGuard("a".repeat(MAX_SAFE_COMMAND_CHARS))).toBeUndefined();
	});

	it("blocks chained multi-line commands", () => {
		expect(detectCommandGuard("echo a &&\necho b")?.kind).toBe(
			"oversized-multiline",
		);
	});

	it("blocks commands that wait for stdin instead of returning", () => {
		for (const cmd of [
			"pause",
			"choice /c YN",
			"set /p answer=",
			"more big.txt",
			"echo done; pause",
			"vim notes.md",
			"read line",
		]) {
			expect(detectCommandGuard(cmd)?.kind).toBe("interactive-stdin");
		}
	});

	it("does not flag interactive words used as arguments", () => {
		for (const cmd of [
			"echo more",
			"grep -in pause log.txt",
			"node -e \"console.log('read')\"",
			"set PATH=%PATH%;C:\\bin",
		]) {
			expect(detectCommandGuard(cmd)).toBeUndefined();
		}
	});

	it("allows a single trailing newline", () => {
		expect(detectCommandGuard("ls -la\n")).toBeUndefined();
	});
});

describe("evaluar_comando_do_run_commands", () => {
	it("flags a heredoc inside a commands array", () => {
		const result = evaluar_comando_do_run_commands({
			commands: ["ls", "cat <<EOF\nx\nEOF"],
		});
		expect(result?.hit.kind).toBe("heredoc");
	});

	it("returns undefined for a clean commands array", () => {
		expect(evaluar_comando_do_run_commands({ commands: ["ls", "pwd"] })).toBeUndefined();
	});

	it("handles the structured {command, args} shape", () => {
		const result = evaluar_comando_do_run_commands({
			commands: [{ command: "bash", args: ["-c", "cat <<EOF\nx\nEOF"] }],
		});
		expect(result?.hit.kind).toBe("heredoc");
	});
});
