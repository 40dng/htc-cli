// launcher direto do painel: sobe o servidor sem passar pelo bootstrap do CLI
import { iniciarWeb } from "./web";

const porta = Number(process.env.PORT ?? Bun.argv[2] ?? 8787);
const { url } = iniciarWeb(porta);
console.log(`[htc web] ${url}`);
await new Promise(() => {});
