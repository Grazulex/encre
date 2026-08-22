// Détection des noms d'entités connus dans un texte brut, pour la liaison
// automatique en mentions (Task 12).
//
// Point critique : le texte peut contenir des caractères accentués (é, à…).
// `normalize('NFD')` décompose chaque caractère précomposé en base + marque(s)
// combinante(s) — ça ALLONGE la chaîne (é → 2 code units). Une normalisation
// globale du texte (`fold(text)` appliqué tel quel à toute la haystack) fait
// donc dériver les index trouvés dans la chaîne repliée par rapport aux index
// de la chaîne d'origine dès qu'un caractère accentué précède la zone
// recherchée — exactement le cas couvert par le test « mara arrive à BREST »
// (le « à » avant BREST). On construit donc le repliement caractère par
// caractère, avec une table qui fait correspondre chaque unité de code de la
// chaîne repliée à l'index (dans la chaîne d'origine) du caractère dont elle
// est issue ; les positions des correspondances sont reconverties via cette
// table avant d'être renvoyées, et `matched` est toujours extrait du texte
// D'ORIGINE (jamais de la version repliée).

export interface AutolinkTarget {
  id: number
  kind: string
  names: string[] // nom + alias
}

export interface TextMatch {
  start: number
  end: number
  entityId: number
  kind: string
  matched: string
}

// Repliement d'un fragment autonome (utilisé pour les noms cherchés : pas
// besoin de table d'index, on ne s'en sert que comme motif à chercher).
function fold(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

// Repliement du texte source avec table d'index : `map[i]` est l'index (dans
// `text`, en unités de code UTF-16) du caractère d'origine dont provient
// `folded[i]`. Un caractère d'origine peut produire 0, 1 ou plusieurs
// caractères repliés (accents composés, casse spéciale) : on replie chaque
// caractère d'origine indépendamment et on pousse une entrée de map par
// caractère replié produit, ce qui garde `map.length === folded.length` et
// permet de retrouver, pour n'importe quelle plage `[i, j)` dans `folded`,
// la plage d'origine correspondante via `map[i]` (début) et `map[j - 1] + 1`
// (fin, puisque chaque caractère d'origine occupe exactement une unité de
// code dans `text`).
function foldWithMap(text: string): { folded: string; map: number[] } {
  let folded = ''
  const map: number[] = []
  for (let i = 0; i < text.length; i++) {
    const piece = fold(text[i])
    for (const c of piece) {
      folded += c
      map.push(i)
    }
  }
  return { folded, map }
}

const isBoundaryChar = (c: string): boolean => c === '' || !/\p{L}/u.test(c)

export function findNameMatches(text: string, targets: AutolinkTarget[]): TextMatch[] {
  const { folded: haystack, map } = foldWithMap(text)
  const candidates: TextMatch[] = []

  for (const t of targets) {
    for (const name of t.names) {
      const needle = fold(name)
      if (!needle) continue
      let from = 0
      while (true) {
        const i = haystack.indexOf(needle, from)
        if (i === -1) break
        const matchEndFolded = i + needle.length
        // Frontières de mots : vérifiées sur les caractères repliés voisins,
        // équivalent aux caractères d'origine correspondants puisque le
        // repliement (suppression des marques diacritiques + minuscule) ne
        // change jamais le statut "lettre" d'un caractère.
        const before = i === 0 ? '' : haystack[i - 1]
        const after = matchEndFolded >= haystack.length ? '' : haystack[matchEndFolded]
        if (isBoundaryChar(before) && isBoundaryChar(after)) {
          const start = map[i]
          const end = map[matchEndFolded - 1] + 1
          candidates.push({
            start,
            end,
            entityId: t.id,
            kind: t.kind,
            matched: text.slice(start, end)
          })
        }
        from = i + 1
      }
    }
  }

  // Nom le plus long d'abord, puis position croissante ; on écarte ensuite
  // tout candidat qui chevauche un candidat déjà retenu (donc plus long, ou
  // de même longueur mais plus précoce).
  candidates.sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start)
  const kept: TextMatch[] = []
  for (const c of candidates) {
    if (kept.every((k) => c.end <= k.start || c.start >= k.end)) kept.push(c)
  }
  return kept.sort((a, b) => a.start - b.start)
}
