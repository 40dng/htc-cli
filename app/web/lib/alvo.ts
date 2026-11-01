/** Host de um alvo com ou sem esquema (comparacao missao x frota no cliente). */
export function hostDe(valor: string): string {
  try {
    return new URL(valor.includes("://") ? valor : `https://${valor}`).hostname.toLowerCase();
  } catch {
    return valor.trim().toLowerCase().replace(/\/+$/, "");
  }
}

export function mesmoAlvo(a: string, b: string): boolean {
  const ha = hostDe(a);
  const hb = hostDe(b);
  return ha === hb || ha.endsWith(`.${hb}`) || hb.endsWith(`.${ha}`);
}
