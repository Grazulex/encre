import { describe, it, expect } from 'vitest'
import { locateQuote, type DocNode } from './quoteLocator'

describe('locateQuote', () => {
  it('localise un extrait dans un unique paragraphe (doc: 0, texte: 1)', () => {
    const doc: DocNode = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Bonjour le monde.' }] }]
    }
    // <p> = pos 0 ; 'B' = pos 1 (jeton d'ouverture franchi) — repère connu de
    // la doc ProseMirror pour <p>hello</p>. "Bonjour " fait 8 caractères
    // (B-o-n-j-o-u-r-espace), donc 'l' de "le monde" est au caractère
    // d'index 8 du texte → position 1 + 8 = 9.
    expect(locateQuote(doc, 'le monde')).toEqual({ found: true, from: 9, to: 17 })
  })

  it("localise la citation même répartie sur plusieurs nœuds texte (marques différentes)", () => {
    const doc: DocNode = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Elle était ' },
            { type: 'text', text: 'vraiment', marks: [{ type: 'bold' }] },
            { type: 'text', text: ' fatiguée.' }
          ]
        }
      ]
    }
    // fullText = "Elle était vraiment fatiguée." — "vraiment fatiguée" chevauche
    // la frontière entre le 2e et le 3e nœud texte. "Elle était " fait 11
    // caractères, donc l'extrait démarre au caractère d'index 11 → position
    // 1 + 11 = 12 ; il fait 17 caractères (vraiment=8 + espace=1 +
    // fatiguée=8) donc se termine (exclusif) à la position 1 + 11 + 17 = 29.
    const result = locateQuote(doc, 'vraiment fatiguée')
    expect(result).toEqual({ found: true, from: 12, to: 29 })
  })

  it('renvoie la PREMIÈRE occurrence quand la citation apparaît plusieurs fois', () => {
    const doc: DocNode = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'chat chat chat' }] }
      ]
    }
    const result = locateQuote(doc, 'chat')
    expect(result).toEqual({ found: true, from: 1, to: 5 })
  })

  it('retrouve des positions correctes à travers deux paragraphes (jetons ouverture/fermeture comptés)', () => {
    const doc: DocNode = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'hi' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'ok' }] }
      ]
    }
    // <p1> 0 h 1 i 2 </p1> 3 <p2> 4 o 5 k 6 </p2> 7 — pos du nœud texte 'hi' = 1,
    // pos du nœud texte 'ok' = 5 (après jeton fermeture p1 (pos 3) + jeton
    // ouverture p2 (pos 4) = 5).
    expect(locateQuote(doc, 'hi')).toEqual({ found: true, from: 1, to: 3 })
    expect(locateQuote(doc, 'ok')).toEqual({ found: true, from: 5, to: 7 })
  })

  it('retourne found:false si la citation est introuvable (texte modifié entre-temps)', () => {
    const doc: DocNode = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Bonjour le monde.' }] }]
    }
    expect(locateQuote(doc, 'texte disparu')).toEqual({ found: false })
  })

  it('retourne found:false pour une citation vide', () => {
    const doc: DocNode = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Bonjour.' }] }]
    }
    expect(locateQuote(doc, '')).toEqual({ found: false })
  })

  it('ne trouve pas une citation qui traverse un nœud atomique (mention/sceneBreak/hardBreak)', () => {
    const doc: DocNode = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Elle vit ' },
            { type: 'mention', attrs: { id: 1, label: 'Nieves' } },
            { type: 'text', text: ' arriver.' }
          ]
        }
      ]
    }
    // fullText = "Elle vit  arriver." (aucun caractère apporté par la mention) :
    // une citation qui suppose le nom de la mention entre les deux passages
    // reste introuvable.
    expect(locateQuote(doc, 'vit Nieves arriver')).toEqual({ found: false })
    // Mais chaque côté de la mention reste localisable individuellement (+1
    // pour le jeton d'ouverture du paragraphe, comme les autres cas).
    expect(locateQuote(doc, 'Elle vit')).toEqual({ found: true, from: 1, to: 9 })
  })

  it('gère un document vide (content absent ou vide)', () => {
    expect(locateQuote({ type: 'doc' }, 'quoi que ce soit')).toEqual({ found: false })
    expect(locateQuote({ type: 'doc', content: [] }, 'quoi que ce soit')).toEqual({ found: false })
  })
})
