// Logique d'affichage des mentions (Task T6c), extraite en pur pour être
// testable hors DOM — voir editor/mention.ts pour la NodeView qui l'utilise.
//
// Règle : le texte VISIBLE d'une mention est TOUJOURS le `label` figé au
// moment de l'insertion/liaison — le texte exact du manuscrit — jamais le
// nom courant de l'entité (bug corrigé : « L'appartement » affiché comme
// « calle Predicadors » parce que le label ne figurait pas parmi les alias).
// Le nom de l'entité ne sert de repli que si `label` est vide/absent.
// L'identité réelle (nom courant + type, qui suit les renommages) n'apparaît
// qu'en infobulle, jamais dans le texte du nœud.
import type { Entity, EntityKind } from './types'

export type MentionDisplayAttrs = {
  label?: string | null
}

// Libellé français du type d'entité, pour l'infobulle uniquement. `EntityKind`
// ne connaît aujourd'hui que character/place ; le repli 'entité' couvre un
// type futur inconnu sans planter l'affichage.
export function kindLabelFr(kind: EntityKind | null | undefined): string {
  switch (kind) {
    case 'character':
      return 'personnage'
    case 'place':
      return 'lieu'
    default:
      return 'entité'
  }
}

// Texte visible du nœud : le `label` stocké, verbatim. Chaîne vide si absent
// (l'appelant applique alors son propre repli, ex. le nom de l'entité).
export function mentionDisplayText(attrs: MentionDisplayAttrs): string {
  return attrs.label && attrs.label.length > 0 ? attrs.label : ''
}

// Contenu de l'infobulle (`title`) : identité réelle de l'entité — nom
// courant et type en français. Chaîne vide si l'entité n'existe plus (rien
// de plus à montrer que le texte déjà visible).
export function mentionTooltip(entity: Entity | undefined | null): string {
  if (!entity) return ''
  return `${entity.name} — ${kindLabelFr(entity.kind)}`
}
