// HTC OPS: entrada do painel (@opentui/react, mesma TUI do CLI).
import { rodar } from "./ops/painel";

rodar().catch((e: unknown) => {
	process.stderr.write(`htc-ops: ${String(e)}\n`);
	process.exit(1);
});


