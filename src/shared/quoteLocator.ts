// Localisation d'une citation exacte dans un document TipTap (JSON) et
// traduction en positions ProseMirror (Task 3, plan 3c — relecture) :
// applySuggestionIntoEditor (EditorPane) doit remplacer par transaction un
// extrait de texte repéré par simple recherche de chaîne, sans jamais
// instancier de vrai document ProseMirror ici (ce module reste pur/testable
// sous vitest — voir vitest.config.ts, limité à src/main + src/shared).
//
// Reproduit la convention de positions de ProseMirror (voir sa doc
// « Positions ») directement sur l'arbre JSON, sans dépendre du schéma réel
// de l'éditeur :
// - un nœud TEXTE occupe `text.length` positions ;
// - un nœud avec `content` (bloc ou inline non-atomique) occupe 2 positions
//   de plus que la somme de son contenu (jeton d'ouverture + de fermeture) ;
// - un nœud sans `content` et sans texte (nœud atomique : sceneBreak,
//   pageBreak, mention, hardBreak, image…) occupe exactement 1 position.
// Le nœud racine `doc` lui-même n'a PAS de jeton d'ouverture/fermeture propre
// (ses enfants directs démarrent à la position 0, pas 1) — cas spécial
// géré par `locateQuote` ci-dessous plutôt que par `nodeSize`.
//
// Le texte de repérage est la concaténation BRUTE (sans séparateur ajouté)
// des nœuds texte du document, dans l'ordre de parcours : un nœud atomique
// n'apporte aucun caractère, donc une citation qui engloberait un tel nœud
// (ex. traverse une mention @Personnage) ne pourra JAMAIS être retrouvée —
// comportement documenté et accepté par le brief de la Task 3, pas un bug.

export interface DocNode {
  type?: string
  text?: string
  content?: DocNode[]
  [key: string]: unknown
}

export type LocateResult = { found: true; from: number; to: number } | { found: false }

interface TextRun {
  text: string
  pos: number // position ProseMirror juste avant le premier caractère de ce nœud texte
}

// Taille ProseMirror d'un nœud (voir commentaire d'en-tête) — utilisée pour
// avancer la position courante d'un frère au suivant lors du parcours.
function nodeSize(node: DocNode): number {
  if (typeof node.text === 'string') return node.text.length
  if (Array.isArray(node.content)) {
    return 2 + node.content.reduce((sum, child) => sum + nodeSize(child), 0)
  }
  return 1
}

// Parcourt une liste de nœuds FRÈRES en avançant `pos` nœud après nœud,
// collectant chaque nœud texte rencontré (à n'importe quelle profondeur) avec
// sa position PM de départ. `startPos` est la position juste avant le premier
// de ces frères — pour les enfants directs de `doc` (racine, sans jeton
// propre) c'est l'appelant (locateQuote) qui passe 0 ; pour les enfants d'un
// nœud normal (paragraphe, etc.) c'est `parentPos + 1` (après son jeton
// d'ouverture), géré dans la branche `content` ci-dessous.
function walkChildren(nodes: DocNode[], startPos: number, runs: TextRun[]): void {
  let pos = startPos
  for (const node of nodes) {
    if (typeof node.text === 'string') {
      if (node.text.length > 0) runs.push({ text: node.text, pos })
    } else if (Array.isArray(node.content)) {
      walkChildren(node.content, pos + 1, runs)
    }
    // Nœud atomique (ni texte ni content) : aucune contribution au texte de
    // repérage, seule sa taille (1) fait avancer `pos` ci-dessous.
    pos += nodeSize(node)
  }
}

// Position ProseMirror du CARACTÈRE à l'index `idx` du texte concaténé (voir
// walkChildren) — `idx` doit désigner un caractère réel (0 <= idx <
// fullText.length), jamais une position "juste après la fin".
//
// Intervalle demi-ouvert [consumed, consumed+length) strict, pas <= : deux
// runs consécutifs séparés par un nœud sans texte (jeton de fermeture/
// ouverture d'un bloc, nœud atomique) occupent des positions PM DIFFÉRENTES
// bien que numériquement adjacentes dans le texte concaténé (aucun caractère
// n'existe "entre les deux" pour représenter cet écart) — un test <= au lieu
// de < résoudrait à tort la position de FIN du run précédent au lieu de la
// position de DÉBUT du run suivant dès que idx tombe pile sur cette frontière
// (ex. citation qui commence juste après un saut de paragraphe).
function charPos(runs: TextRun[], idx: number): number {
  let consumed = 0
  for (const run of runs) {
    if (idx < consumed + run.text.length) return run.pos + (idx - consumed)
    consumed += run.text.length
  }
  // Ne devrait pas arriver (idx toujours borné par fullText.length par
  // l'appelant) — filet de sécurité plutôt qu'une exception.
  const last = runs[runs.length - 1]
  return last ? last.pos + last.text.length : 0
}

/**
 * Localise la PREMIÈRE occurrence exacte de `quote` dans le texte du document
 * `doc` (nœud racine `doc`, avec son `content`), et renvoie les positions
 * ProseMirror `[from, to)` de cet extrait (`to` exclusif, comme
 * `tr.replaceWith`/`tr.delete`/`tr.insertText`).
 *
 * `{ found: false }` si `quote` est vide ou introuvable — citation caduque
 * (texte modifié depuis la génération de la suggestion) ou citation
 * traversant un nœud atomique (mention, saut de scène/page…), voir
 * commentaire d'en-tête.
 */
export function locateQuote(doc: DocNode, quote: string): LocateResult {
  if (!quote) return { found: false }
  const runs: TextRun[] = []
  walkChildren(doc.content ?? [], 0, runs)
  const fullText = runs.map((run) => run.text).join('')
  const index = fullText.indexOf(quote)
  if (index === -1) return { found: false }
  // `to` dérivé de la position du DERNIER caractère réellement matché
  // (index + quote.length - 1), jamais de l'offset "juste après" — voir
  // charPos ci-dessus pour la raison (ambiguïté aux frontières de bloc).
  const from = charPos(runs, index)
  const to = charPos(runs, index + quote.length - 1) + 1
  return { found: true, from, to }
}
