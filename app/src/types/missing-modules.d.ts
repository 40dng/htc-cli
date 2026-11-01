// Stub declarations for optional packages not installed in HTC CLI
declare module "@agentclientprotocol/sdk" {
	const content: any;
	export default content;
	export * from content;
}

declare module "chat" {
	const content: any;
	export default content;
	export * from content;
}

declare module "@chat-adapter/discord" {
	const content: any;
	export default content;
	export * from content;
}

declare module "@chat-adapter/slack" {
	const content: any;
	export default content;
	export * from content;
}

declare module "@chat-adapter/gchat" {
	const content: any;
	export default content;
	export * from content;
}

declare module "@chat-adapter/telegram" {
	const content: any;
	export default content;
	export * from content;
}

declare module "@chat-adapter/whatsapp" {
	const content: any;
	export default content;
	export * from content;
}

declare module "@gramio/format/markdown" {
	const content: any;
	export default content;
	export * from content;
}

declare module "@cline/cline-hub" {
	export function startClineHubDashboardServer(): Promise<any>;
}

declare module "@microsoft/tui-test" {
	const content: any;
	export default content;
	export * from content;
}

declare module "@microsoft/tui-test/lib/terminal/term" {
	const content: any;
	export default content;
	export * from content;
}
