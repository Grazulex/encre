// Libellés fixes de la maquette EPUB. Ils suivent book.language : Encre porte
// déjà ce champ, et un EPUB anglais dont la table des matières s'appelle
// « Sommaire » se remarque tout de suite. Aucune autre langue n'est prévue —
// une valeur inconnue retombe sur le français.
export interface TextesEpub {
  sommaire: string
  pageTitre: string
  reperes: string
  couverture: string
  debutLecture: string
}

const TEXTES: Record<string, TextesEpub> = {
  fr: {
    sommaire: 'Sommaire',
    pageTitre: 'Page de titre',
    reperes: 'Repères',
    couverture: 'Couverture',
    debutLecture: 'Début de la lecture'
  },
  en: {
    sommaire: 'Contents',
    pageTitre: 'Title page',
    reperes: 'Landmarks',
    couverture: 'Cover',
    debutLecture: 'Start reading'
  }
}

export function textesEpub(langue: string): TextesEpub {
  return TEXTES[langue] ?? TEXTES.fr
}
