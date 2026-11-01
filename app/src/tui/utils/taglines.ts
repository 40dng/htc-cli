export const TAGLINES = [
	"security is an illusion.",
	"hack the planet!",
	"i don't even see the code.",
	"trust no input.",
	"there is no patch for human stupidity.",
	"access is a state of mind.",
	"the quieter you become, the more you hear.",
	"assume breach.",
	"enumeration is the answer.",
	"the network remembers.",
	"find the bottleneck, own the system.",
	"everything is a file.",
	"permission is a suggestion.",
	"read the source, luke.",
	"attack the weakest link: us.",
] as const;

export function sortearTagline(): string {
	const i = Math.floor(Math.random() * TAGLINES.length);
	return TAGLINES[i] ?? TAGLINES[0];
}
