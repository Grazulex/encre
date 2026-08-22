// Plafond partagé par toutes les textareas auto-grow de l'app (résumé de
// chapitre, notes de plan — globales et par chapitre —, description
// d'événement de chronologie) : au-delà de 40 % de la hauteur de la fenêtre,
// la textarea arrête de grandir et défile en interne plutôt que de pousser le
// reste de la mise en page hors champ (bug utilisateur : notes très longues
// rendant certaines zones illisibles/inaccessibles, aucun scroll possible).
//
// Le ratio est calculé dynamiquement via window.innerHeight à chaque appel
// (pas une valeur figée en px) pour rester synchronisé avec la règle CSS
// `max-height: 40vh` posée sur chacune de ces textareas — les deux doivent
// toujours s'accorder, sous peine de voir la hauteur JS et le plafond CSS se
// contredire (l'un imposerait une hauteur que l'autre couperait aussitôt).
const MAX_HEIGHT_RATIO = 0.4

export function autoGrowClamped(el: HTMLTextAreaElement): void {
  el.style.height = 'auto'
  const cap = window.innerHeight * MAX_HEIGHT_RATIO
  el.style.height = `${Math.min(el.scrollHeight, cap)}px`
}
