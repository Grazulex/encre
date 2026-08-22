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
// (ses enfants directs démarrent à la position 0, pas 1) — cas spécial géré
// par `collectTextRuns` ci-dessous plutôt que par `nodeSize`.
//
// Le texte de repérage est la concaténation BRUTE (sans séparateur ajouté)
// des nœuds texte du document, dans l'ordre de parcours : un nœud atomique
// n'apporte aucun caractère, donc une citation qui engloberait un tel nœud
// (ex. traverse une mention @Personnage) ne pourra JAMAIS être retrouvée —
// comportement documenté et accepté par le brief de la Task 3, pas un bug.
//
// GARDE STRUCTURELLE (correctif review) : cette concaténation SANS séparateur
// signifie que la fin du texte d'un bloc de premier niveau (paragraphe...)
// est immédiatement suivie, dans le texte de repérage, par le début du texte
// du bloc SUIVANT — un `indexOf` naïf peut donc « trouver » une citation dont
// la moitié vient de la fin d'un paragraphe et l'autre moitié du début du
// suivant (ex. paragraphe A finissant par « …hi », paragraphe B commençant
// par « ok… », citation "hiok"). Une suggestion de relecture porte TOUJOURS
// sur un extrait d'un seul passage continu (jamais une réécriture à cheval
// sur deux paragraphes) : chaque run de texte est donc étiqueté avec l'index
// de son bloc de premier niveau (`block`, l'index de l'enfant direct de
// `doc`), et `locateQuote` rejette explicitement toute occurrence dont le
// premier et le dernier caractère matché ne partagent pas le même `block`
// (en cherchant l'occurrence suivante à la place) — rendu « not-found »
// plutôt qu'une correspondance fautive, jamais une fusion silencieuse de
// deux paragraphes par la transaction de remplacement.

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
  block: number // index de l'enfant direct de `doc` (bloc de premier niveau) qui porte ce run
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

// Parcourt un nœud et ses descendants (profondeur quelconque — listes,
// citations imbriquées…), collectant chaque nœud texte rencontré avec sa
// position PM de départ et le `block` de premier niveau transmis depuis
// l'appelant (collectTextRuns ci-dessous) — inchangé quelle que soit la
// profondeur, un nœud imbriqué appartient toujours au même bloc de premier
// niveau que son ancêtre direct de `doc`.
function walkNode(node: DocNode, pos: number, block: number, runs: TextRun[]): void {
  if (typeof node.text === 'string') {
    if (node.text.length > 0) runs.push({ text: node.text, pos, block })
    return
  }
  if (Array.isArray(node.content)) {
    let childPos = pos + 1 // franchit le jeton d'ouverture de ce nœud
    for (const child of node.content) {
      walkNode(child, childPos, block, runs)
      childPos += nodeSize(child)
    }
  }
  // Nœud atomique (ni texte ni content) : aucune contribution au texte de
  // repérage, seule sa taille (1, via nodeSize côté appelant) fait avancer
  // la position du frère suivant.
}

// Point d'entrée du parcours : itère les enfants DIRECTS de `doc` (pas de
// jeton propre pour la racine — ses enfants démarrent à la position 0, pas
// 1, voir commentaire d'en-tête), en attribuant à chacun son propre index de
// `block`.
function collectTextRuns(doc: DocNode): TextRun[] {
  const runs: TextRun[] = []
  const topLevel = doc.content ?? []
  let pos = 0
  topLevel.forEach((node, block) => {
    walkNode(node, pos, block, runs)
    pos += nodeSize(node)
  })
  return runs
}

// Retrouve le run contenant le caractère à l'index `idx` du texte concaténé
// (voir collectTextRuns), et l'offset de ce caractère À L'INTÉRIEUR de ce
// run — `idx` doit désigner un caractère réel (0 <= idx < fullText.length),
// jamais une position "juste après la fin".
//
// Intervalle demi-ouvert [consumed, consumed+length) strict, pas <= : deux
// runs consécutifs séparés par un nœud sans texte (jeton de fermeture/
// ouverture d'un bloc, nœud atomique) occupent des positions PM DIFFÉRENTES
// bien que numériquement adjacentes dans le texte concaténé (aucun caractère
// n'existe "entre les deux" pour représenter cet écart) — un test <= au lieu
// de < résoudrait à tort la position de FIN du run précédent au lieu de la
// position de DÉBUT du run suivant dès que idx tombe pile sur cette frontière
// (ex. citation qui commence juste après un saut de paragraphe).
function runAt(runs: TextRun[], idx: number): { run: TextRun; offset: number } | null {
  let consumed = 0
  for (const run of runs) {
    if (idx < consumed + run.text.length) return { run, offset: idx - consumed }
    consumed += run.text.length
  }
  return null
}

/**
 * Localise la PREMIÈRE occurrence exacte de `quote` dans le texte du document
 * `doc` (nœud racine `doc`, avec son `content`) qui reste entièrement à
 * l'intérieur d'un seul bloc de premier niveau, et renvoie les positions
 * ProseMirror `[from, to)` de cet extrait (`to` exclusif, comme
 * `tr.replaceWith`/`tr.delete`/`tr.insertText`).
 *
 * `{ found: false }` si `quote` est vide, introuvable, ou si TOUTES ses
 * occurrences dans le texte concaténé traversent une frontière de bloc de
 * premier niveau (voir commentaire d'en-tête — jamais une fusion silencieuse
 * de deux paragraphes) — même statut non bloquant qu'une citation caduque
 * (texte modifié depuis la génération de la suggestion) ou traversant un
 * nœud atomique (mention, saut de scène/page…).
 */
export function locateQuote(doc: DocNode, quote: string): LocateResult {
  if (!quote) return { found: false }
  const runs = collectTextRuns(doc)
  const fullText = runs.map((run) => run.text).join('')

  let searchFrom = 0
  for (;;) {
    const index = fullText.indexOf(quote, searchFrom)
    if (index === -1) return { found: false }

    const start = runAt(runs, index)
    // `index + quote.length - 1` = dernier caractère réellement matché,
    // jamais l'offset "juste après" (voir runAt/charPos ci-dessus pour la
    // raison : ambiguïté aux frontières de bloc/nœud atomique).
    const end = runAt(runs, index + quote.length - 1)
    if (!start || !end) return { found: false } // filet de sécurité, ne devrait pas arriver

    if (start.run.block === end.run.block) {
      return {
        found: true,
        from: start.run.pos + start.offset,
        to: end.run.pos + end.offset + 1
      }
    }
    // Occurrence à cheval sur deux blocs de premier niveau (voir commentaire
    // d'en-tête) : rejetée, on cherche l'occurrence suivante plutôt que de
    // renvoyer une plage qui fusionnerait deux paragraphes.
    searchFrom = index + 1
  }
}
