// Classes de paragraphe posées à l'assemblage, partagées par les exports PDF et
// EPUB. Elles sont posées ici, sur la chaîne rendue, plutôt qu'en sélecteurs CSS
// positionnels (:first-of-type, .scene-break + p) : ceux-ci ne survivent pas à la
// fragmentation de paged.js — un export réel de 340 pages a montré la coupure de
// page recomposant le DOM et perdant ces sélecteurs (le premier paragraphe
// restait indenté, l'après-scène aussi).
//
// ORDRE IMPORTANT : poserApresScene doit tourner AVANT poserPremier. Un chapitre
// qui commence par un séparateur de scène a son premier <p> déjà classé
// "apres-scene" une fois le premier appel passé ; poserPremier, qui cherche un
// `<p>` nu, ne le retague alors plus — sans quoi ce paragraphe recevait "premier"
// au lieu de "apres-scene". Un paragraphe ne peut jamais porter les deux classes.

// Pose la classe du premier paragraphe (repli text-indent + petites capitales).
// Ne touche que la toute première occurrence de `<p>` littéral dans ce segment —
// le lookahead négatif exclut un `<p></p>` vide en tête : un paragraphe vide n'a
// ni lettrine ni petites capitales à afficher, la classe irait sur le mauvais
// paragraphe.
export function poserPremier(contenu: string): string {
  return contenu.replace(/<p>(?!<\/p>)/, '<p class="premier">')
}

// Le paragraphe qui suit immédiatement un séparateur de scène reçoit sa classe
// à l'assemblage, pour la même raison que poserPremier.
// Le paragraphe qui suit immédiatement une illustration en vignette (le QR de
// la page « Restons en contact », par exemple) est une légende : centré, sans
// alinéa. Même mécanique, pour la même raison ; la vignette est un <figure> en
// PDF et un <div> en EPUB. À poser AVANT poserPremier, sans quoi une vignette en
// tête de chapitre laisserait son paragraphe recevoir « premier ».
export function poserLegende(contenu: string): string {
  return contenu.replace(
    /(<(figure|div) class="illustration illustration-vignette">[\s\S]*?<\/\2>\s*)<p>/g,
    '$1<p class="legende">'
  )
}

export function poserApresScene(contenu: string): string {
  return contenu.replace(
    /(<div class="scene-break">[\s\S]*?<\/div>\s*)<p>/g,
    '$1<p class="apres-scene">'
  )
}
