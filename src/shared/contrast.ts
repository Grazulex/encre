/**
 * Ratio de contraste WCAG 2.1 entre deux couleurs hexadécimales.
 *
 * Vit dans `shared/` parce que c'est une fonction pure sans dépendance, et
 * parce que la configuration vitest ne couvre que `main/` et `shared/` : un
 * test de thème posé dans `renderer/` ne serait jamais exécuté.
 */
export function relativeLuminance(hex: string): number {
  const h = hex.replace('#', '')
  const canaux = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
  const [r, v, b] = canaux.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * v + 0.0722 * b
}

export function contrastRatio(a: string, b: string): number {
  const [clair, sombre] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x)
  return (clair + 0.05) / (sombre + 0.05)
}

/** Seuil WCAG AA pour du texte de taille normale. */
export const AA_TEXTE_NORMAL = 4.5
