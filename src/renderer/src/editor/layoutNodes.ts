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
        // Optionnel (Task « sous-titre ») : la devise du chapitre, quand
        // l'auteur en use une — absente pour la grande majorité des chapitres.
        sousTitre?: string
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

// Groupe `miseEnPage` (Fix 1, revue finale) : les quatre nœuds de mise en
// page restent des `block` ordinaires (insertables en tête de chapitre via
// le menu ¶+), mais portent EN PLUS ce groupe pour pouvoir être exclus du
// contenu de FrontMatterPage ci-dessous. Un nœud de mise en page imbriqué
// DANS une page liminaire romprait la segmentation du PDF : html.ts découpe
// le rendu sur les marqueurs %%ENCRE-SECTION%% qui entourent chaque section
// de premier niveau, et le nœud imbriqué émettrait sa propre paire de
// marqueurs à l'intérieur de la section `<section class="liminaire">…</section>`
// du parent — celle-ci se retrouve alors coupée en deux par le split, avec une
// balise `<section>` non refermée et une `</section>` orpheline : la page
// suivante du PDF hérite d'un DOM invalide, et le sommaire (qui cite les
// ancres par position dans ce flux) pointe sur la mauvaise page.
export const ChapterOpening = Node.create({
  name: 'chapterOpening',

  group: 'block miseEnPage',
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
      // Sous-titre optionnel (la devise du chapitre, quand l'auteur en use
      // une) : même round-trip via data- que enseigne/titre ci-dessus, défaut
      // '' pour les chapitres qui n'en portent pas.
      sousTitre: {
        default: '',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-sous-titre') ?? '',
        renderHTML: (attributes: Record<string, unknown>) => ({
          'data-sous-titre': attributes.sousTitre
        })
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

  // enseigne et sous-titre restent de purs attributs, affichés côté éditeur
  // par les pseudo-éléments ::before/::after de theme.css (attr(data-…)) —
  // mais un élément n'a que DEUX pseudo-éléments, et l'ordre visuel voulu est
  // à TROIS temps (enseigne, titre, sous-titre). Le titre devient donc ici un
  // enfant réel (texte statique dérivé de node.attrs, pas de contenu
  // éditable — le nœud reste un atome) : ::before garde l'enseigne, ::after
  // récupère le sous-titre, et le titre — entre les deux dans le DOM — se
  // repositionne visuellement en dernier via `order` en CSS (voir theme.css).
  renderHTML({ node, HTMLAttributes }) {
    const attrs = mergeAttributes(HTMLAttributes, { 'data-ouverture': '' })
    const titre = String(node.attrs.titre ?? '')
    return ['div', attrs, ['span', { class: 'ouverture-titre-editeur' }, titre]]
  },

  addCommands() {
    return {
      // Pas de cast nécessaire (comme illustration.ts) : la signature générique
      // `attrs?: Record<string, unknown>` de la fabrique reste structurellement
      // compatible avec `{ enseigne; titre; sousTitre; recto }` déclaré ci-dessus.
      insertChapterOpening: insertBlockAtomCommand(this.name)
    }
  }
})

export const PartOpening = Node.create({
  name: 'partOpening',

  group: 'block miseEnPage',
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

  group: 'block miseEnPage',
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
// (dédicace, épigraphe, avertissement…), donc `content: '(…)+'` plutôt que
// `atom: true`. La commande insère directement le nœud via insertContent
// (pas insertBlockAtomCommand, qui suppose un atome sans contenu) et lui
// donne un paragraphe vide de départ pour que le curseur ait où atterrir.
//
// Contenu volontairement énuméré plutôt que `'block+'` (Fix 1, revue finale) :
// le groupe `block` inclurait aussi les quatre nœuds de mise en page
// eux-mêmes (voir leur groupe `block miseEnPage` ci-dessus), permettant au
// menu ¶+ d'insérer par ex. un sommaire DANS une page liminaire. Voir le
// commentaire au-dessus de ChapterOpening pour la raison précise (rupture de
// la segmentation en sections du PDF). Cette énumération couvre les blocs
// ordinaires (paragraphe, titre, citation, listes) et les atomes de mise en
// forme existants (séparateur de scène, saut de page, illustration), mais
// aucun `miseEnPage`.
export const FrontMatterPage = Node.create({
  name: 'frontMatterPage',

  group: 'block miseEnPage',
  content:
    '(paragraph | heading | blockquote | bulletList | orderedList | sceneBreak | pageBreak | illustration)+',
  defining: true,

  addAttributes() {
    return {
      genre: {
        default: 'titre',
        // Clamp (Fix 5, revue finale) : un HTML collé de l'extérieur peut
        // porter n'importe quelle valeur dans data-genre (ex. "junk"), ce qui
        // produirait une classe CSS `liminaire-junk` sans alignement vertical
        // défini. On retombe sur 'titre' pour toute valeur qui n'est pas l'un
        // des trois genres reconnus — même clamp que draftFromLayoutNode côté
        // EditorPane.vue.
        parseHTML: (element: HTMLElement) => {
          const v = element.getAttribute('data-genre')
          return v === 'colophon' || v === 'dedicace' ? v : 'titre'
        },
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
