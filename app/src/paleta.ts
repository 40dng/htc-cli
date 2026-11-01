export const paleta = {
  act:       "#CB1B45",
  plan:      "#E4597A",
  success:   "#4CC38A",
  error:     "#FF5C5C",
  warn:      "#E8B04B",
  muted:     "gray",
  textOnAct: "white",
} as const;

export const paleta_tema = {
  dark: {
    act:     paleta.act,
    plan:    paleta.plan,
    success: paleta.success,
  },
  light: {
    act:     "#8E1330",
    plan:    "#B03050",
    success: "#0F7A4F",
  },
} as const;

// Gradiente da marca (#FF5C7A → #A81E3B) por linha, para o banner de entrada
export function linha_gradiente(idx: number, total: number): string {
  const t = total <= 1 ? 0 : idx / (total - 1);
  const r = Math.round(255 - t * (255 - 168));
  const g = Math.round(92 - t * (92 - 30));
  const b = Math.round(122 - t * (122 - 59));
  return `\x1b[38;2;${r};${g};${b}m\x1b[1m`;
}

export const RESET = "\x1b[0m";
export const DIM   = "\x1b[2m";
export const BOLD  = "\x1b[1m";
export const WHITE = "\x1b[97m";
