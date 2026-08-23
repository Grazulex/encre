// Nœud illustration (spec 2026-08-23) : planche pleine largeur insérée au
// curseur. Atome bloc comme sceneBreak/pageBreak — même fabrique d'insertion
// (curseur repositionné après le nœud, paragraphe ajouté en fin de document).
// Le src n'est PAS un attribut persisté : il est dérivé de fileName au rendu
// (encre-media://, seul protocole d'image autorisé par la CSP) — le JSON en
// base ne contient que fileName/displayName.
import { Node, mergeAttributes } from '@tiptap/core'
import { insertBlockAtomCommand } from './formatNodes'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    illustration: {
      /**
       * Insère une illustration de la bibliothèque du livre au curseur.
       */
      insertIllustration: (attrs: { fileName: string; displayName: string }) => ReturnType
    }
  }
}

export const Illustration = Node.create({
  name: 'illustration',

  group: 'block',
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      fileName: {
        default: '',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-illustration') ?? '',
        renderHTML: () => ({}) // porté par le renderHTML global ci-dessous
      },
      displayName: {
        default: '',
        parseHTML: (element: HTMLElement) => element.getAttribute('alt') ?? '',
        renderHTML: () => ({})
      }
    }
  },

  parseHTML() {
    return [{ tag: 'img[data-illustration]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    const fileName = String(node.attrs.fileName ?? '')
    return [
      'img',
      mergeAttributes(HTMLAttributes, {
        'data-illustration': fileName,
        alt: String(node.attrs.displayName ?? ''),
        src: `encre-media://${encodeURIComponent(fileName)}`
      })
    ]
  },

  addCommands() {
    return {
      // Pas de cast nécessaire : TypeScript accepte l'assignation malgré la
      // signature `attrs?: Record<string, unknown>` de la fabrique générique
      // (moins précise que `{ fileName; displayName }` déclaré ci-dessus),
      // les deux étant structurellement compatibles.
      insertIllustration: insertBlockAtomCommand(this.name)
    }
  }
})
