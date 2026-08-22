// Normalisation partagée pour la recherche « floue » insensible aux accents
// et à la casse (palette de commandes, suggestion de mention @).
//
// Ne pas confondre avec `fold`/`foldWithMap` de src/shared/autolink.ts : ce
// dernier a besoin d'une table d'index (position repliée → position
// d'origine) pour retrouver les correspondances dans le texte source. Ici on
// ne compare jamais de sous-chaînes à des positions précises, donc ce simple
// normalize suffit et reste mutualisé.
export function normalizeForSearch(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}
