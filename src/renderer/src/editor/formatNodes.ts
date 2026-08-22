// Nœuds canoniques de mise en forme (Task 3) : deux atomes bloc, tous deux
// représentés en HTML par un simple <hr data-kind="…">, distingués l'un de
// l'autre uniquement par cet attribut (jamais deux tags différents, pour
// rester dans le vocabulaire HTML standard du format canonique).
//
// Rendu éditeur : pas de NodeView JS pour l'un ou l'autre — un <hr> vide
// suffit, le glyphe/texte affiché (⁂ pour sceneBreak, « — saut de page — »
// pour pageBreak) est posé en CSS pur via ::after sur le sélecteur
// `hr[data-kind="…"]` (voir theme.css). Plus simple qu'une NodeView pour un
// résultat purement visuel qui ne dépend d'aucun état réactif du nœud.
import { Node, mergeAttributes, nodeInputRule, canInsertNode, isNodeSelection } from '@tiptap/core'
import type { Command } from '@tiptap/core'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    sceneBreak: {
      /**
       * Insère un séparateur de scène (⁂) au curseur.
       */
      setSceneBreak: () => ReturnType
    }
    pageBreak: {
      /**
       * Insère un saut de page forcé au curseur.
       */
      setPageBreak: () => ReturnType
    }
  }
}

export interface SceneBreakOptions {
  HTMLAttributes: Record<string, unknown>
}

// Règle de saisie : le déclencheur est la touche Entrée, pas la frappe d'un
// caractère de plus. TipTap (voir @tiptap/core InputRule.ts, handleKeyDown)
// relance le moteur de règles d'entrée sur Entrée avec un texte simulé
// `'\n'` ajouté à la fin du texte du bloc courant — d'où le `\n` final dans
// chacune des regex ci-dessous : elles ne peuvent donc JAMAIS matcher pendant
// la frappe normale (aucun caractère inséré via handleTextInput n'est un
// `\n` littéral), seulement au moment où l'auteur appuie sur Entrée avec pour
// SEUL contenu du paragraphe l'un des trois marqueurs reconnus. Une ligne qui
// contient l'un de ces marqueurs au milieu d'un texte plus long (ancres `^…$`
// sur tout le contenu du bloc) n'est jamais convertie : l'auteur reste libre
// d'écrire ce qu'il veut en pleine ligne de texte.
const SCENE_BREAK_INPUT_REGEX = /^(?:\*\*\*|---|\* \* \*)\n$/

// Garde fin-de-document (correctif review — piège classique de l'atome en fin
// de document) : mirroring de HorizontalRule.setHorizontalRule (voir
// node_modules/@tiptap/extension-horizontal-rule/src/horizontal-rule.ts). Une
// insertContent() nue laisse ProseMirror poser une NodeSelection sur l'atome
// fraîchement inséré quand il n'y a rien après lui (Selection.near retombe
// dessus faute de position textuelle) : la frappe suivante REMPLACE alors le
// marqueur au lieu de continuer d'écrire après. Après insertion : s'il existe
// un nœud après ($to.nodeAfter), le curseur y est repositionné (texte ou
// sélection de nœud selon son type, comme en amont) ; sinon (fin de
// document) un paragraphe vide est ajouté et le curseur y est placé. Utilisé
// par sceneBreak ET pageBreak — seul le nom du nœud à insérer change.
function insertBlockAtomCommand(nodeName: string): () => Command {
  return () =>
    ({ chain, state }) => {
      if (!canInsertNode(state, state.schema.nodes[nodeName])) return false

      const { selection } = state
      const { $to: $originTo } = selection
      const currentChain = chain()

      if (isNodeSelection(selection)) {
        currentChain.insertContentAt($originTo.pos, { type: nodeName })
      } else {
        currentChain.insertContent({ type: nodeName })
      }

      return currentChain
        .command(({ state: chainState, tr, dispatch }) => {
          if (dispatch) {
            const { $to } = tr.selection
            const posAfter = $to.end()

            if ($to.nodeAfter) {
              if ($to.nodeAfter.isTextblock) {
                tr.setSelection(TextSelection.create(tr.doc, $to.pos + 1))
              } else if ($to.nodeAfter.isBlock) {
                tr.setSelection(NodeSelection.create(tr.doc, $to.pos))
              } else {
                tr.setSelection(TextSelection.create(tr.doc, $to.pos))
              }
            } else {
              // Fin de document : rien après le marqueur — un paragraphe vide
              // donne au curseur un endroit textuel où continuer d'écrire.
              const paragraphType =
                chainState.schema.nodes.paragraph || $to.parent.type.contentMatch.defaultType
              const node = paragraphType?.create()
              if (node) {
                tr.insert(posAfter, node)
                tr.setSelection(TextSelection.create(tr.doc, posAfter + 1))
              }
            }
            tr.scrollIntoView()
          }
          return true
        })
        .run()
    }
}

export const SceneBreak = Node.create<SceneBreakOptions>({
  name: 'sceneBreak',

  addOptions() {
    return { HTMLAttributes: {} }
  },

  group: 'block',
  atom: true,
  selectable: true,

  parseHTML() {
    return [{ tag: 'hr[data-kind="scene"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'hr',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { 'data-kind': 'scene' })
    ]
  },

  addCommands() {
    return {
      setSceneBreak: insertBlockAtomCommand(this.name)
    }
  },

  addInputRules() {
    return [
      nodeInputRule({
        find: SCENE_BREAK_INPUT_REGEX,
        type: this.type
      })
    ]
  }
})

export interface PageBreakOptions {
  HTMLAttributes: Record<string, unknown>
}

// Pas de règle de saisie ici (brief) : un saut de page est toujours un geste
// volontaire (menu « ¶+ » ou palette ⌘K), jamais déclenché par la frappe.
export const PageBreak = Node.create<PageBreakOptions>({
  name: 'pageBreak',

  addOptions() {
    return { HTMLAttributes: {} }
  },

  group: 'block',
  atom: true,
  selectable: true,

  parseHTML() {
    return [{ tag: 'hr[data-kind="page"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'hr',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { 'data-kind': 'page' })
    ]
  },

  addCommands() {
    return {
      setPageBreak: insertBlockAtomCommand(this.name)
    }
  }
})
