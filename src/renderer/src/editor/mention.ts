// Extension @ mentions (Task 11) : étend le nœud `mention` officiel avec un
// attribut `kind` (personnage/lieu) et une NodeView plain-JS.
//
// Règle d'affichage (Task T6c — bug utilisateur : la liaison automatique
// réécrivait la prose, ex. « L'appartement qu'elle louait… » affiché
// « calle Predicadors qu'elle louait… ») : le texte VISIBLE est TOUJOURS le
// `label` figé à l'insertion — le texte exact du manuscrit — jamais le nom
// courant de l'entité. Le nom de l'entité ne sert de repli que si `label`
// est vide/absent. L'identité réelle de l'entité (nom courant + type,
// suivant les renommages via un watch Pinia) n'apparaît qu'en infobulle
// (`title`), jamais dans le texte du nœud.
import Mention from '@tiptap/extension-mention'
import { VueRenderer } from '@tiptap/vue-3'
import type { SuggestionKeyDownProps, SuggestionOptions, SuggestionProps } from '@tiptap/suggestion'
import tippy, { type GetReferenceClientRect, type Instance as TippyInstance } from 'tippy.js'
import { watch } from 'vue'
import { useEntitiesStore } from '../stores/entities'
import { normalizeForSearch } from '../../../shared/textNormalize'
import { mentionDisplayText, mentionTooltip } from '../../../shared/mentionDisplay'
import type { Entity, EntityKind } from '../../../shared/types'
import MentionList from '../components/MentionList.vue'

// L'extension officielle ne connaît que MentionNodeAttrs (id: string | null,
// label). Nos nœuds stockent réellement un id numérique (celui de l'entité)
// et portent en plus `kind`, ajouté via addAttributes ci-dessous — d'où ce
// type de lecture propre à ce fichier plutôt qu'une extension de
// MentionNodeAttrs (dont le champ `id` est incompatible).
export type EntityMentionAttrs = {
  id: number | null
  label?: string | null
  kind?: EntityKind | null
}

export interface MentionSuggestionItem {
  id: number
  label: string
  kind: EntityKind
}

const MAX_SUGGESTIONS = 8

function matchesQuery(entity: Entity, query: string): boolean {
  if (!query) return true
  const q = normalizeForSearch(query)
  if (normalizeForSearch(entity.name).includes(q)) return true
  return entity.aliases.some((alias) => normalizeForSearch(alias).includes(q))
}

// Personnages d'abord, puis lieux (brief), chaque groupe filtré par la
// frappe courante ; le store est lu à chaque appel plutôt que capturé une
// fois, pour refléter les fiches créées/renommées pendant que l'éditeur est
// ouvert.
function suggestionItems({ query }: { query: string }): MentionSuggestionItem[] {
  const store = useEntitiesStore()
  const matching = store.entities.filter((entity) => matchesQuery(entity, query))
  const characters = matching.filter((entity) => entity.kind === 'character')
  const places = matching.filter((entity) => entity.kind === 'place')
  return [...characters, ...places]
    .slice(0, MAX_SUGGESTIONS)
    .map((entity) => ({ id: entity.id, label: entity.name, kind: entity.kind }))
}

// Pattern officiel TipTap v3 + Vue 3 : VueRenderer(MentionList) monté dans
// un tippy piloté manuellement (trigger 'manual', positionné via
// clientRect). onKeyDown délègue à la liste exposée (defineExpose) pour que
// ↑/↓/Entrée pilotent la sélection sans jamais quitter l'éditeur.
function suggestionRender(): NonNullable<
  SuggestionOptions<MentionSuggestionItem>['render']
> {
  return () => {
    let component: VueRenderer
    let popup: TippyInstance[] | undefined

    return {
      onStart: (props: SuggestionProps<MentionSuggestionItem>) => {
        component = new VueRenderer(MentionList, { props, editor: props.editor })
        if (!props.clientRect) return
        popup = tippy('body', {
          getReferenceClientRect: props.clientRect as GetReferenceClientRect,
          appendTo: () => document.body,
          content: component.element as Element,
          showOnCreate: true,
          interactive: true,
          trigger: 'manual',
          placement: 'bottom-start'
        })
      },
      onUpdate(props: SuggestionProps<MentionSuggestionItem>) {
        component.updateProps(props)
        if (!props.clientRect) return
        popup?.[0]?.setProps({ getReferenceClientRect: props.clientRect as GetReferenceClientRect })
      },
      onKeyDown(props: SuggestionKeyDownProps) {
        if (props.event.key === 'Escape') {
          popup?.[0]?.hide()
          return true
        }
        return (component.ref as { onKeyDown?: (p: SuggestionKeyDownProps) => boolean } | null)
          ?.onKeyDown?.(props) ?? false
      },
      onExit() {
        popup?.[0]?.destroy()
        component.destroy()
      }
    }
  }
}

export const EntityMention = Mention.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      kind: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-kind'),
        renderHTML: (attributes: { kind?: EntityKind | null }) => {
          if (!attributes.kind) return {}
          return { 'data-kind': attributes.kind }
        }
      }
    }
  },
  // NodeView plain-JS (pas de composant Vue monté par nœud) : un simple
  // <span> dont le texte suit, via un watch() Pinia, le nom courant de
  // l'entité. Le watcher est arrêté dans destroy() pour ne pas fuir quand le
  // nœud sort du document (suppression, undo, etc.).
  addNodeView() {
    return ({ node }) => {
      const store = useEntitiesStore()
      const dom = document.createElement('span')
      dom.setAttribute('data-type', 'mention')

      const applyClasses = (attrs: EntityMentionAttrs): void => {
        dom.className = attrs.kind === 'place' ? 'mention mention-place' : 'mention'
        if (attrs.id != null) dom.setAttribute('data-id', String(attrs.id))
      }

      const render = (attrs: EntityMentionAttrs): void => {
        const entity = store.entities.find((e) => e.id === attrs.id)
        // Texte visible : toujours le label du manuscrit (jamais le nom de
        // l'entité) — voir mentionDisplayText. Repli sur le nom courant
        // uniquement si le label est vide/absent.
        const text = mentionDisplayText(attrs) || entity?.name || ''
        dom.textContent = `@${text}`
        const tooltip = mentionTooltip(entity)
        if (tooltip) dom.setAttribute('title', tooltip)
        else dom.removeAttribute('title')
      }

      applyClasses(node.attrs as EntityMentionAttrs)

      // Le watch ne pilote plus que l'infobulle (nom courant + type, suit les
      // renommages) — jamais le texte visible du nœud, qui reste figé au
      // label stocké tant que l'attribut lui-même ne change pas.
      const stopWatch = watch(
        () => {
          const entity = store.entities.find((e) => e.id === node.attrs.id)
          return entity ? `${entity.name} ${entity.kind}` : undefined
        },
        () => render(node.attrs as EntityMentionAttrs),
        { immediate: true }
      )

      return {
        dom,
        update(updatedNode) {
          if (updatedNode.type.name !== node.type.name) return false
          node = updatedNode
          applyClasses(node.attrs as EntityMentionAttrs)
          render(node.attrs as EntityMentionAttrs)
          return true
        },
        destroy() {
          stopWatch()
        }
      }
    }
  }
}).configure({
  suggestion: {
    char: '@',
    items: suggestionItems,
    command: ({ editor, range, props }) => {
      // La signature générique de SuggestionOptions.command retombe sur
      // MentionNodeAttrs (id: string | null) quand elle n'est pas
      // spécialisée par .configure() ; l'objet reçu ici est en réalité
      // exactement celui retourné par suggestionItems (MentionSuggestionItem).
      const item = props as unknown as MentionSuggestionItem
      editor
        .chain()
        .focus()
        .insertContentAt(range, [
          { type: 'mention', attrs: { id: item.id, label: item.label, kind: item.kind } },
          { type: 'text', text: ' ' }
        ])
        .run()
    },
    render: suggestionRender()
  }
})
