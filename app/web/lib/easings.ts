/** Easings nomeados. better-ui: cubic-bezier(0.2, 0, 0, 1) e o padrao de saida. */
export const ease = {
  power2Out: [0.2, 0, 0, 1] as const,
  power3Out: [0.16, 1, 0.3, 1] as const,
  power3InOut: [0.65, 0, 0.35, 1] as const,
};

export const duracao = {
  hover: 0.12,
  press: 0.15,
  ui: 0.2,
  entrada: 0.3,
  saida: 0.15,
};
