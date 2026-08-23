// Quatre nœuds de mise en page (Task 6) : chacun produit une PAGE ENTIÈRE
// dans le PDF composé (chaîne de composition déjà consommatrice de ces types
// de nœuds — voir la tâche de composition PDF). Trois atomes bloc bâtis sur
// la même fabrique que sceneBreak/pageBreak/illustration
// (insertBlockAtomCommand, voir formatNodes.ts) : ChapterOpening, PartOpening,
// TableOfContents. Le quatrième, FrontMatterPage, est un nœud À CONTENU (une
// page liminaire contient du texte réel — dédicace, épigraphe…), donc pas
// construit sur la même fabrique : sa commande insère directement le nœud
// avec un paragraphe vide pour que le curseur ait où atterrir.
import { Node, mergeAttributes } from '@tiptap/core'
import { insertBlockAtomCommand } from './formatNodes'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    chapterOpening: {
      /**
       * Insère une page d'ouverture de chapitre au curseur.
       */
      insertChapterOpening: (attrs: {
        enseigne: string
        titre: string
        recto: boolean
      }) => ReturnType
    }
    partOpening: {
      /**
       * Insère une page d'ouverture de partie au curseur.
       */
      insertPartOpening: (attrs: { label: string; recto: boolean }) => ReturnType
    }
    tableOfContents: {
      /**
       * Insère une page de sommaire au curseur (contenu rempli à l'export).
       */
      insertTableOfContents: (attrs: { titre: string }) => ReturnType
    }
    frontMatterPage: {
      /**
       * Insère une page liminaire (dédicace, épigraphe…) au curseur.
       */
      insertFrontMatterPage: (attrs: { genre: string }) => ReturnType
    }
  }
}

// Le booléen `recto` se sérialise en 'true'/'false' dans l'attribut HTML
// (jamais un booléen brut, invalide en HTML) et se relit en traitant toute
// valeur autre que la chaîne 'false' comme vraie — un attribut absent (donc
// null) vaut ainsi recto par défaut, cohérent avec le défaut `true` ci-dessous.
function parseRecto(element: HTMLElement): boolean {
  return element.getAttribute('data-recto') !== 'false'
}

export const ChapterOpening = Node.create({
  name: 'chapterOpening',

  group: 'block',
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      enseigne: {
        default: '',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-enseigne') ?? '',
        renderHTML: (attributes: Record<string, unknown>) => ({
          'data-enseigne': attributes.enseigne
        })
      },
      titre: {
        default: '',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-titre') ?? '',
        renderHTML: (attributes: Record<string, unknown>) => ({ 'data-titre': attributes.titre })
      },
      recto: {
        default: true,
        parseHTML: parseRecto,
        renderHTML: (attributes: Record<string, unknown>) => ({
          'data-recto': String(attributes.recto)
        })
      }
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-ouverture]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-ouverture': '' })]
  },

  addCommands() {
    return {
      // Pas de cast nécessaire (comme illustration.ts) : la signature générique
      // `attrs?: Record<string, unknown>` de la fabrique reste structurellement
      // compatible avec `{ enseigne; titre; recto }` déclaré ci-dessus.
      insertChapterOpening: insertBlockAtomCommand(this.name)
    }
  }
})

export const PartOpening = Node.create({
  name: 'partOpening',

  group: 'block',
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      label: {
        default: '',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-label') ?? '',
        renderHTML: (attributes: Record<string, unknown>) => ({ 'data-label': attributes.label })
      },
      recto: {
        default: true,
        parseHTML: parseRecto,
        renderHTML: (attributes: Record<string, unknown>) => ({
          'data-recto': String(attributes.recto)
        })
      }
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-partie]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-partie': '' })]
  },

  addCommands() {
    return {
      insertPartOpening: insertBlockAtomCommand(this.name)
    }
  }
})

export const TableOfContents = Node.create({
  name: 'tableOfContents',

  group: 'block',
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      titre: {
        default: 'SOMMAIRE',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-titre') ?? 'SOMMAIRE',
        renderHTML: (attributes: Record<string, unknown>) => ({ 'data-titre': attributes.titre })
      }
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-sommaire]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-sommaire': '' })]
  },

  addCommands() {
    return {
      insertTableOfContents: insertBlockAtomCommand(this.name)
    }
  }
})

// Nœud à contenu (pas un atome) : une page liminaire porte du texte réel
// (dédicace, épigraphe, avertissement…), donc `content: 'block+'` plutôt que
// `atom: true`. La commande insère directement le nœud via insertContent
// (pas insertBlockAtomCommand, qui suppose un atome sans contenu) et lui
// donne un paragraphe vide de départ pour que le curseur ait où atterrir.
export const FrontMatterPage = Node.create({
  name: 'frontMatterPage',

  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      genre: {
        default: 'titre',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-genre') ?? 'titre',
        renderHTML: (attributes: Record<string, unknown>) => ({ 'data-genre': attributes.genre })
      }
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-liminaire]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-liminaire': '' }), 0]
  },

  addCommands() {
    return {
      insertFrontMatterPage:
        (attrs: { genre: string }) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs,
            content: [{ type: 'paragraph' }]
          })
    }
  }
})
