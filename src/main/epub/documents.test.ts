import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, it, expect, beforeAll } from 'vitest'
import { openDb } from '../db/connection'
import { createApi } from '../api'
import { buildEpubDocuments } from './documents'

function doc(...content: any[]): string {
  return JSON.stringify({ type: 'doc', content })
}
const para = (t: string) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })
const illustration = (fileName: string, displayName: string) => ({
  type: 'illustration',
  attrs: { fileName, displayName }
})
const vignette = (fileName: string, displayName: string) => ({
  type: 'illustration',
  attrs: { fileName, displayName, taille: 'vignette' }
})

async function livre(langue = 'fr') {
  const db = openDb(':memory:')
  const api = createApi(db)
  const book = await api.books.create({ title: 'LA MAISON', author: 'JMS', language: langue })
  return { db, api, book }
}

// Répertoire d'illustrations réel : les gardes de buildEpubDocuments testent
// l'existence du fichier sur disque, un mock ne les exercerait pas.
let mediaDir = ''
beforeAll(() => {
  mediaDir = mkdtempSync(join(tmpdir(), 'encre-epub-'))
  for (const nom of ['planche.png', 'Élan gris.jpg', 'refusee.gif']) {
    writeFileSync(join(mediaDir, nom), Buffer.from([0x00]))
  }
})

describe('buildEpubDocuments', () => {
  it('sort une ouverture de chapitre en document, sans répéter le titre', async () => {
    const { db, api, book } = await livre()
    const ch = await api.chapters.create(book.id, 'Un')
    await api.chapters.saveContent(
      ch.id,
      doc(
        {
          type: 'chapterOpening',
          attrs: {
            enseigne: 'CHAPITRE 1',
            titre: 'TROIS HEURES',
            sousTitre: '« La reconnaissance »'
          }
        },
        para('Le cri.'),
        para('Elle était debout.')
      ),
      'Le cri. Elle était debout.'
    )

    const { documents } = buildEpubDocuments(db, book.id, [])
    expect(documents).toHaveLength(1)
    const d = documents[0]
    expect(d.nom).toBe('chapitre-00.xhtml')
    expect(d.kind).toBe('chapitre')
    expect(d.titre).toBe('CHAPITRE 1 — TROIS HEURES')
    expect(d.nav).toBe('CHAPITRE 1 — TROIS HEURES')
    expect(d.corps).toContain('<section epub:type="chapter">')
    expect(d.corps).toContain('<p class="enseigne">CHAPITRE 1</p>')
    expect(d.corps).toContain('<h2 class="titre-chapitre">TROIS HEURES</h2>')
    expect(d.corps).toContain('<p class="sous-titre">« La reconnaissance »</p>')
    expect(d.corps).toContain('<div class="filet"></div>')
    // Ordre de l'en-tête : enseigne, titre, sous-titre, filet.
    expect(d.corps.indexOf('enseigne')).toBeLessThan(d.corps.indexOf('titre-chapitre'))
    expect(d.corps.indexOf('titre-chapitre')).toBeLessThan(d.corps.indexOf('sous-titre'))
    expect(d.corps.indexOf('sous-titre')).toBeLessThan(d.corps.indexOf('filet'))
    // Le double titre de l'ancienne version : le titre n'apparaît qu'une fois.
    expect(d.corps.match(/TROIS HEURES/g)).toHaveLength(1)
    expect(d.corps).not.toContain('<h1')
  })

  it('replie sur le titre du chapitre quand aucune ouverture n’est posée', async () => {
    const { db, api, book } = await livre()
    const ch = await api.chapters.create(book.id, 'Sans ouverture')
    await api.chapters.saveContent(ch.id, doc(para('Texte.')), 'Texte.')

    const { documents } = buildEpubDocuments(db, book.id, [])
    expect(documents).toHaveLength(1)
    expect(documents[0].corps).toContain('<h1 class="titre-chapitre">Sans ouverture</h1>')
    expect(documents[0].titre).toBe('Sans ouverture')
    expect(documents[0].nav).toBe('Sans ouverture')
  })

  it('ne replie pas quand une ouverture est posée', async () => {
    const { db, api, book } = await livre()
    const ch = await api.chapters.create(book.id, 'Titre en base')
    await api.chapters.saveContent(
      ch.id,
      doc(
        { type: 'chapterOpening', attrs: { enseigne: 'CH. 1', titre: 'Titre posé' } },
        para('Texte.')
      ),
      'Texte.'
    )

    const { documents } = buildEpubDocuments(db, book.id, [])
    expect(documents[0].corps).not.toContain('Titre en base')
    expect(documents[0].corps).not.toContain('<h1 class="titre-chapitre">')
  })

  it('rattache au chapitre les segments de corps qui précèdent son ouverture', async () => {
    const { db, api, book } = await livre()
    const ch = await api.chapters.create(book.id, 'Un')
    await api.chapters.saveContent(
      ch.id,
      doc(
        illustration('planche.png', 'Planche'),
        { type: 'chapterOpening', attrs: { enseigne: 'CHAPITRE 1', titre: 'TROIS HEURES' } },
        para('Le cri.')
      ),
      'Le cri.'
    )

    const { documents } = buildEpubDocuments(db, book.id, [], mediaDir)
    // Un seul document : pas d'orphelin portant l'étiquette de repli, donc pas
    // de seconde entrée de navigation pour le même chapitre.
    expect(documents).toHaveLength(1)
    const d = documents[0]
    expect(d.nom).toBe('chapitre-00.xhtml')
    expect(d.titre).toBe('CHAPITRE 1 — TROIS HEURES')
    expect(d.nav).toBe('CHAPITRE 1 — TROIS HEURES')
    // La planche précède l'en-tête du chapitre qu'elle ouvre.
    expect(d.corps.indexOf('<img')).toBeLessThan(d.corps.indexOf('<div class="ouverture">'))
    // Régression du défaut 2 : la planche n'a pas consommé le drapeau.
    expect(d.corps).toContain('<p class="premier">Le cri.</p>')
    // Aucun titre inventé : le PDF n'en pose pas là où l'auteur a mis une ouverture.
    expect(d.corps).not.toContain('<h1 class="titre-chapitre">')
  })

  it('laisse la partie à part et rattache la planche au chapitre qui suit', async () => {
    const { db, api, book } = await livre()
    const ch = await api.chapters.create(book.id, 'Un')
    await api.chapters.saveContent(
      ch.id,
      doc(
        { type: 'partOpening', attrs: { label: 'Première partie' } },
        illustration('planche.png', 'Planche'),
        { type: 'chapterOpening', attrs: { enseigne: 'CHAPITRE 1', titre: 'TROIS HEURES' } },
        para('Le cri.')
      ),
      'Le cri.'
    )

    const { documents } = buildEpubDocuments(db, book.id, [], mediaDir)
    expect(documents.map((d) => d.nom)).toEqual(['partie-00.xhtml', 'chapitre-00.xhtml'])
    expect(documents[0].corps).not.toContain('<img')
    expect(documents[1].corps).toContain('<img src="images/planche.png"')
    expect(documents[1].corps.indexOf('<img')).toBeLessThan(
      documents[1].corps.indexOf('<div class="ouverture">')
    )
    expect(documents[1].corps).toContain('<p class="premier">Le cri.</p>')
  })

  it('reproduit l’ouverture d’un livre réel sans document orphelin', async () => {
    // Séquence relevée sur L'ENVERS tome 2 : liminaires, partie, planche pleine
    // page, puis seulement l'ouverture du chapitre.
    const { db, api, book } = await livre()
    const ch = await api.chapters.create(book.id, 'LE TROISIÈME JEUDI D’AVRIL')
    await api.chapters.saveContent(
      ch.id,
      doc(
        { type: 'frontMatterPage', attrs: { genre: 'titre' }, content: [para('L’ENVERS')] },
        { type: 'frontMatterPage', attrs: { genre: 'colophon' }, content: [para('© 2026')] },
        { type: 'partOpening', attrs: { label: 'Première partie' } },
        illustration('planche.png', 'Planche'),
        {
          type: 'chapterOpening',
          attrs: { enseigne: 'CHAPITRE 1', titre: 'LE TROISIÈME JEUDI D’AVRIL' }
        },
        para('Le cri.')
      ),
      'Le cri.'
    )

    const { documents } = buildEpubDocuments(db, book.id, [], mediaDir)
    expect(documents.map((d) => d.nom)).toEqual([
      'titre.xhtml',
      'colophon.xhtml',
      'partie-00.xhtml',
      'chapitre-00.xhtml'
    ])
    // Une seule entrée de navigation cite le chapitre.
    const entrees = documents.filter((d) => d.nav?.includes('LE TROISIÈME JEUDI D’AVRIL'))
    expect(entrees).toHaveLength(1)
    expect(entrees[0].nav).toBe('CHAPITRE 1 — LE TROISIÈME JEUDI D’AVRIL')
    expect(documents[3].corps).toContain('<p class="premier">Le cri.</p>')
  })

  it('sort chaque page liminaire en document distinct, avec son epub:type', async () => {
    const { db, api, book } = await livre()
    const ch = await api.chapters.create(book.id, 'Liminaires')
    await api.chapters.saveContent(
      ch.id,
      doc(
        { type: 'frontMatterPage', attrs: { genre: 'titre' }, content: [para('LA MAISON')] },
        { type: 'frontMatterPage', attrs: { genre: 'colophon' }, content: [para('© 2026')] },
        { type: 'frontMatterPage', attrs: { genre: 'dedicace' }, content: [para('À elle.')] }
      ),
      ''
    )

    const { documents } = buildEpubDocuments(db, book.id, [])
    expect(documents.map((d) => d.nom)).toEqual(['titre.xhtml', 'colophon.xhtml', 'dedicace.xhtml'])
    expect(documents.every((d) => d.kind === 'liminaire')).toBe(true)
    expect(documents[0].corps).toContain('<section epub:type="titlepage">')
    expect(documents[0].corps).toContain('<div class="liminaire liminaire-titre">')
    expect(documents[0].corps).toContain('<p>LA MAISON</p>')
    expect(documents[0].nav).toBe('Page de titre')
    expect(documents[1].corps).toContain('<section epub:type="copyright-page">')
    expect(documents[1].corps).toContain('<div class="liminaire liminaire-colophon">')
    expect(documents[1].nav).toBeNull()
    expect(documents[2].corps).toContain('<section epub:type="dedication">')
    expect(documents[2].nav).toBeNull()
  })

  it('suffixe un genre de liminaire qui revient', async () => {
    const { db, api, book } = await livre()
    const ch = await api.chapters.create(book.id, 'Liminaires')
    await api.chapters.saveContent(
      ch.id,
      doc(
        { type: 'frontMatterPage', attrs: { genre: 'titre' }, content: [para('Un')] },
        { type: 'frontMatterPage', attrs: { genre: 'titre' }, content: [para('Deux')] }
      ),
      ''
    )

    const { documents } = buildEpubDocuments(db, book.id, [])
    expect(documents.map((d) => d.nom)).toEqual(['titre.xhtml', 'titre-2.xhtml'])
  })

  it('sort une ouverture de partie en document distinct avec son libellé en nav', async () => {
    const { db, api, book } = await livre()
    const ch = await api.chapters.create(book.id, 'Un')
    await api.chapters.saveContent(
      ch.id,
      doc(
        { type: 'partOpening', attrs: { label: 'Première partie' } },
        { type: 'chapterOpening', attrs: { enseigne: '', titre: 'TROIS HEURES' } },
        para('Le cri.')
      ),
      'Le cri.'
    )

    const { documents } = buildEpubDocuments(db, book.id, [])
    expect(documents.map((d) => d.nom)).toEqual(['partie-00.xhtml', 'chapitre-00.xhtml'])
    const partie = documents[0]
    expect(partie.kind).toBe('partie')
    expect(partie.nav).toBe('Première partie')
    expect(partie.titre).toBe('Première partie')
    expect(partie.corps).toContain('<section epub:type="part" class="page-partie">')
    expect(partie.corps).toContain('<p class="partie-label">Première partie</p>')
    expect(partie.corps).toContain('<div class="filet"></div>')
    // Sans enseigne, l'étiquette du chapitre est le titre seul.
    expect(documents[1].nav).toBe('TROIS HEURES')
  })

  it('numérote chapitres et parties globalement au livre', async () => {
    const { db, api, book } = await livre()
    const c1 = await api.chapters.create(book.id, 'Un')
    await api.chapters.saveContent(
      c1.id,
      doc({ type: 'chapterOpening', attrs: { titre: 'A' } }, para('Un.')),
      'Un.'
    )
    const c2 = await api.chapters.create(book.id, 'Deux')
    await api.chapters.saveContent(
      c2.id,
      doc(
        { type: 'partOpening', attrs: { label: 'Deuxième partie' } },
        { type: 'chapterOpening', attrs: { titre: 'B' } },
        para('Deux.')
      ),
      'Deux.'
    )

    const { documents } = buildEpubDocuments(db, book.id, [])
    expect(documents.map((d) => d.nom)).toEqual([
      'chapitre-00.xhtml',
      'partie-00.xhtml',
      'chapitre-01.xhtml'
    ])
  })

  it('omet le sommaire sans laisser de trace', async () => {
    const { db, api, book } = await livre()
    const ch = await api.chapters.create(book.id, 'Un')
    await api.chapters.saveContent(
      ch.id,
      doc(
        { type: 'chapterOpening', attrs: { titre: 'A' } },
        { type: 'tableOfContents', attrs: { titre: 'SOMMAIRE' } },
        para('Le cri.')
      ),
      'Le cri.'
    )

    const { documents } = buildEpubDocuments(db, book.id, [])
    expect(documents).toHaveLength(1)
    const corps = documents[0].corps
    expect(corps).not.toContain('SOMMAIRE')
    expect(corps).not.toContain('sommaire')
    expect(corps).not.toContain('ENCRE-BLOC')
    // Un seul segment de corps : le sommaire n'a pas coupé le chapitre.
    expect(corps).toContain('<p class="premier">Le cri.</p>')
  })

  it('garde l’illustration dans le flux, avec un src encodé et un inventaire littéral', async () => {
    const { db, api, book } = await livre()
    const ch = await api.chapters.create(book.id, 'Un')
    await api.chapters.saveContent(
      ch.id,
      doc(
        { type: 'chapterOpening', attrs: { titre: 'A' } },
        para('Avant.'),
        illustration('Élan gris.jpg', 'Élan & gris'),
        illustration('planche.png', 'Planche'),
        illustration('planche.png', 'Planche'),
        para('Après.')
      ),
      'Avant. Après.'
    )

    const { documents, images } = buildEpubDocuments(db, book.id, [], mediaDir)
    // Une illustration n'est pas une page : elle ne produit aucun document.
    expect(documents).toHaveLength(1)
    const corps = documents[0].corps
    expect(corps).toContain(`<img src="images/${encodeURIComponent('Élan gris.jpg')}"`)
    expect(corps).toContain('alt="Élan &amp; gris"')
    expect(corps).toContain('<img src="images/planche.png"')
    expect(corps).not.toContain('src="images/Élan gris.jpg"')
    // Le flux n'est pas coupé : la planche vit entre les deux paragraphes.
    expect(corps.indexOf('Avant.')).toBeLessThan(corps.indexOf('<div class="illustration">'))
    expect(corps.indexOf('<div class="illustration">')).toBeLessThan(corps.indexOf('Après.'))
    // Chemins de zip : littéraux, dans l'ordre de première rencontre, dédupliqués.
    expect(images).toEqual(['Élan gris.jpg', 'planche.png'])
  })

  it('classe une illustration en vignette pour que la CSS la réduise', async () => {
    const { db, api, book } = await livre()
    const ch = await api.chapters.create(book.id, 'Restons en contact')
    await api.chapters.saveContent(
      ch.id,
      doc(para('Merci.'), vignette('planche.png', 'QR'), para('jmauteur.com')),
      'Merci. jmauteur.com'
    )
    const { documents, images } = buildEpubDocuments(db, book.id, [], mediaDir)
    expect(documents[0].corps).toContain('<div class="illustration illustration-vignette">')
    expect(images).toEqual(['planche.png'])
  })

  it('omet une illustration qui échoue à l’une des trois gardes', async () => {
    const { db, api, book } = await livre()
    const ch = await api.chapters.create(book.id, 'Un')
    await api.chapters.saveContent(
      ch.id,
      doc(
        para('Texte.'),
        illustration('../planche.png', 'Traversée'),
        illustration('absente.png', 'Absente'),
        illustration('refusee.gif', 'Extension inconnue')
      ),
      'Texte.'
    )

    const { documents, images } = buildEpubDocuments(db, book.id, [], mediaDir)
    expect(images).toEqual([])
    expect(documents[0].corps).not.toContain('<img')
    expect(documents[0].corps).not.toContain('illustration')
  })

  it('omet toute illustration quand aucun mediaDir n’est fourni', async () => {
    const { db, api, book } = await livre()
    const ch = await api.chapters.create(book.id, 'Un')
    await api.chapters.saveContent(
      ch.id,
      doc(para('Texte.'), illustration('planche.png', 'Planche')),
      'Texte.'
    )

    const { documents, images } = buildEpubDocuments(db, book.id, [])
    expect(images).toEqual([])
    expect(documents[0].corps).not.toContain('<img')
  })

  it('pose premier et apres-scene, et jamais les deux sur le même paragraphe', async () => {
    const { db, api, book } = await livre()
    const ch = await api.chapters.create(book.id, 'Un')
    await api.chapters.saveContent(
      ch.id,
      doc(para('Avant.'), { type: 'sceneBreak' }, para('Après.')),
      'Avant. Après.'
    )

    const { documents } = buildEpubDocuments(db, book.id, [])
    expect(documents[0].corps).toContain('<p class="premier">Avant.</p>')
    expect(documents[0].corps).toContain('<p class="apres-scene">Après.</p>')
  })

  it('un chapitre qui commence par un séparateur de scène pose apres-scene, pas premier', async () => {
    const { db, api, book } = await livre()
    const ch = await api.chapters.create(book.id, 'Un')
    await api.chapters.saveContent(ch.id, doc({ type: 'sceneBreak' }, para('Après.')), 'Après.')

    const { documents } = buildEpubDocuments(db, book.id, [])
    expect(documents[0].corps).toContain('<p class="apres-scene">Après.</p>')
    expect(documents[0].corps).not.toContain('class="premier"')
  })

  it('ne produit aucun document chapitre pour un chapitre sans segment de corps', async () => {
    const { db, api, book } = await livre()
    const ch = await api.chapters.create(book.id, 'Liminaires')
    await api.chapters.saveContent(
      ch.id,
      doc({ type: 'frontMatterPage', attrs: { genre: 'colophon' }, content: [para('© 2026')] }),
      ''
    )

    const { documents } = buildEpubDocuments(db, book.id, [])
    expect(documents).toHaveLength(1)
    expect(documents[0].kind).toBe('liminaire')
  })

  it('bascule les libellés de navigation en anglais quand le livre est en anglais', async () => {
    const { db, api, book } = await livre('en')
    const ch = await api.chapters.create(book.id, 'Front matter')
    await api.chapters.saveContent(
      ch.id,
      doc({ type: 'frontMatterPage', attrs: { genre: 'titre' }, content: [para('THE HOUSE')] }),
      ''
    )

    const { documents } = buildEpubDocuments(db, book.id, [])
    expect(documents[0].nav).toBe('Title page')
    expect(documents[0].titre).toBe('Title page')
  })

  it('ne retient que les chapitres demandés', async () => {
    const { db, api, book } = await livre()
    const c1 = await api.chapters.create(book.id, 'Un')
    await api.chapters.saveContent(c1.id, doc(para('Un.')), 'Un.')
    const c2 = await api.chapters.create(book.id, 'Deux')
    await api.chapters.saveContent(c2.id, doc(para('Deux.')), 'Deux.')

    const { documents } = buildEpubDocuments(db, book.id, [c2.id])
    expect(documents).toHaveLength(1)
    expect(documents[0].titre).toBe('Deux')
  })
})
