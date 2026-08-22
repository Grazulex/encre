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
// n'apporte aucun caractère. Ça n'empêche PAS forcément une citation de le
// « traverser » dans le texte concaténé (les runs de part et d'autre restent
// simplement collés bord à bord) — seul un nœud explicitement traité comme
// une FRONTIÈRE DE BLOC (voir GARDE STRUCTURELLE ci-dessous : les blocs de
// premier niveau, et hardBreak — correctif M3, vague finale 3c) fait rejeter
// une telle occurrence. Les autres nœuds atomiques inline (mention, image…)
// ne sont PAS traités comme des frontières : une citation qui les
// traverserait resterait en pratique introuvable la plupart du temps (leurs
// attributs, ex. le nom d'une mention, n'apparaissent jamais dans le texte
// concaténé), mais ce n'est qu'une conséquence indirecte de l'absence de
// texte, pas une garantie structurelle comme pour hardBreak/blocs.
//
// GARDE STRUCTURELLE (correctif review, étendu par le correctif M3) : cette
// concaténation SANS séparateur signifie que la fin du texte d'un passage
// (bloc de premier niveau, ou ligne séparée par un hardBreak À L'INTÉRIEUR
// d'un même bloc) est immédiatement suivie, dans le texte de repérage, par le
// début du texte du passage SUIVANT — un `indexOf` naïf peut donc « trouver »
// une citation dont la moitié vient de la fin d'un passage et l'autre moitié
// du début du suivant (ex. paragraphe A finissant par « …hi », paragraphe B
// commençant par « ok… », citation "hiok" ; ou une ligne finissant par
// « ligne1 » suivie d'un hardBreak puis « ligne2 », citation "ligne1ligne2"
// qui omet le \n implicite du hardBreak — l'appliquer supprimerait
// silencieusement le saut de ligne). Une suggestion de relecture porte
// TOUJOURS sur un extrait d'un seul passage continu (jamais une réécriture à
// cheval sur deux paragraphes NI sur un saut de ligne dur) : chaque run de
// texte est donc étiqueté avec un index de `block` qui avance aussi bien à
// chaque bloc de premier niveau qu'à chaque hardBreak rencontré pendant le
// parcours (voir walkNode/collectTextRuns), et `locateQuote` rejette
// explicitement toute occurrence dont le premier et le dernier caractère
// matché ne partagent pas le même `block` (en cherchant l'occurrence
// suivante à la place) — rendu « not-found » plutôt qu'une correspondance
// fautive, jamais une fusion silencieuse de deux passages par la transaction
// de remplacement.

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

// Compteur de bloc MUTABLE et PARTAGÉ sur tout le parcours d'un document
// (correctif M3, vague finale 3c) : contrairement à un simple `block: number`
// figé par l'appelant, `blockRef.value` peut être incrémenté PENDANT le
// parcours (voir walkNode ci-dessous, cas hardBreak) — une même référence est
// donc transmise à tous les appels récursifs pour qu'une frontière franchie
// au milieu d'un bloc de premier niveau soit visible par le reste du parcours
// de ce bloc, sans avoir à faire remonter une valeur par retour de fonction.
interface BlockRef {
  value: number
}

// Parcourt un nœud et ses descendants (profondeur quelconque — listes,
// citations imbriquées…), collectant chaque nœud texte rencontré avec sa
// position PM de départ et le `block` COURANT (blockRef.value au moment du
// passage, pas figé pour tout le sous-arbre — voir hardBreak ci-dessous).
function walkNode(node: DocNode, pos: number, blockRef: BlockRef, runs: TextRun[]): void {
  if (typeof node.text === 'string') {
    if (node.text.length > 0) runs.push({ text: node.text, pos, block: blockRef.value })
    return
  }
  if (Array.isArray(node.content)) {
    let childPos = pos + 1 // franchit le jeton d'ouverture de ce nœud
    for (const child of node.content) {
      walkNode(child, childPos, blockRef, runs)
      childPos += nodeSize(child)
    }
    return
  }
  // Nœud atomique (ni texte ni content) : aucune contribution au texte de
  // repérage, seule sa taille (1, via nodeSize côté appelant) fait avancer
  // la position du frère suivant. hardBreak fait EN PLUS avancer blockRef —
  // traité comme une frontière à part entière (au même titre qu'un bloc de
  // premier niveau, voir commentaire d'en-tête) : les runs de texte avant et
  // après ce hardBreak ne partagent alors plus le même `block`, donc
  // locateQuote rejette toute occurrence qui les engloberait tous les deux
  // (elle omettrait le \n implicite du hardBreak). Les autres nœuds
  // atomiques (mention, sceneBreak, pageBreak, image…) ne sont PAS des
  // frontières : seul hardBreak a une contrepartie textuelle implicite (un
  // saut de ligne) dont l'omission changerait silencieusement le sens du
  // texte si elle passait inaperçue.
  if (node.type === 'hardBreak') blockRef.value += 1
}

// Point d'entrée du parcours : itère les enfants DIRECTS de `doc` (pas de
// jeton propre pour la racine — ses enfants démarrent à la position 0, pas
// 1, voir commentaire d'en-tête), en avançant blockRef à CHAQUE bloc de
// premier niveau (comme avant le correctif M3) — walkNode se charge en plus
// de l'avancer pour chaque hardBreak rencontré à l'intérieur d'un bloc.
function collectTextRuns(doc: DocNode): TextRun[] {
  const runs: TextRun[] = []
  const topLevel = doc.content ?? []
  let pos = 0
  const blockRef: BlockRef = { value: 0 }
  topLevel.forEach((node) => {
    walkNode(node, pos, blockRef, runs)
    pos += nodeSize(node)
    blockRef.value += 1
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
