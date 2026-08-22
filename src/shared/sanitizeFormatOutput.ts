// Défense (BINDING, controller precisions Task 6) : si le modèle enveloppe sa
// sortie dans un bloc de code Markdown (```` ```markdown ... ``` ```` ou
// ```` ``` ... ``` ````) malgré la consigne système, on l'ôte avant de
// réimporter le texte via mdToTiptapJson — sinon les ``` seraient traités
// comme un bloc de code littéral du récit (ou, pire, deviendraient un noeud
// de type inconnu pour le schéma courant). Ne traite que le cas où
// l'INTÉGRALITÉ du texte est enveloppée d'une seule paire de fences (le seul
// cas réaliste ici : buildFormatPrompt demande "le Markdown complet du
// chapitre, rien d'autre").
export function stripMarkdownFences(markdown: string): string {
  const trimmed = markdown.trim()
  const match = trimmed.match(/^```[^\n]*\n([\s\S]*?)\n?```$/)
  return match ? match[1] : trimmed
}

// Task 6b (défaut vécu en usage réel) : malgré la consigne de sortie directe
// (voir buildFormatPrompt), Claude ajoute parfois une phrase d'annonce
// ("Voici le texte harmonisé :") et/ou recopie le titre "## CHAPITRE
// (Markdown)" du prompt en tête de sa réponse. stripMarkdownFences seul ne
// traite que les fences ``` — ceci ôte, en plus, ces deux formes de préambule
// EN TÊTE de texte uniquement, jamais après que le vrai contenu ait commencé.
//
// Deux formes reconnues, chacune seulement si suivie d'une ligne vide (pour
// ne jamais manger un début de chapitre légitime) :
//  - l'écho du titre de section ("## CHAPITRE ...") ;
//  - une courte ligne d'annonce se terminant par ":" (bornée en longueur pour
//    ne pas confondre avec un vrai incipit se terminant par deux-points).
// Boucle bornée : gère l'ordre "annonce puis titre" ou l'inverse.
const HEADING_ECHO_RE = /^##\s*CHAPITRE\b.*$/i
const MAX_ANNOUNCEMENT_LENGTH = 100
const MAX_PREAMBLE_LINES = 5

export function sanitizeFormatOutput(markdown: string): string {
  let text = stripMarkdownFences(markdown)

  for (let i = 0; i < MAX_PREAMBLE_LINES; i++) {
    const lines = text.split('\n')
    if (lines.length < 2) break

    const first = lines[0].trim()
    const followedByBlank = (lines[1] ?? '').trim() === ''
    if (!followedByBlank) break

    const isHeadingEcho = HEADING_ECHO_RE.test(first)
    const isAnnouncement =
      !isHeadingEcho && first.length > 0 && first.length < MAX_ANNOUNCEMENT_LENGTH && first.endsWith(':')

    if (!isHeadingEcho && !isAnnouncement) break

    text = lines.slice(2).join('\n')
  }

  return text
}
