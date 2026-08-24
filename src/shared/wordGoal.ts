// Objectif de mots d'un chapitre, saisi à la main dans la StatusBar.
//
// La valeur brute vient d'un `<input type="number">` : Vue y caste le v-model
// en NOMBRE dès que la saisie est numérique, mais un champ vidé le repasse à
// la chaîne vide. Les deux formes arrivent donc ici, et une seule des deux
// supporte `.trim()` — d'où ce passage par String() plutôt qu'un traitement
// de chaîne direct, qui levait un TypeError interrompant la sauvegarde.
//
// Tout ce qui n'est pas un entier strictement positif vaut « pas d'objectif »
// (null) : c'est aussi le geste qui EFFACE une cible existante, en validant
// le champ vide.
export function parseWordGoal(raw: unknown): number | null {
  const texte = String(raw ?? '').trim()
  if (texte === '') return null
  const valeur = Number.parseInt(texte, 10)
  return Number.isFinite(valeur) && valeur > 0 ? valeur : null
}
