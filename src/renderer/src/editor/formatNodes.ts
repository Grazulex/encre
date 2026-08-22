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
import { Node, mergeAttributes, nodeInputRule } from '@tiptap/core'

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
      setSceneBreak:
        () =>
        ({ chain }) =>
          chain().insertContent({ type: this.name }).run()
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
      setPageBreak:
        () =>
        ({ chain }) =>
          chain().insertContent({ type: this.name }).run()
    }
  }
})
