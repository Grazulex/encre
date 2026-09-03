import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { openDb, type Db } from '../db/connection'
import { createApi } from '../api'
import type { Book } from '../../shared/types'
import { buildBookHtml } from './html'

function doc(...content: unknown[]): string {
  return JSON.stringify({ type: 'doc', content })
}
const para = (t: string): unknown => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })

async function livre(): Promise<{ db: Db; api: ReturnType<typeof createApi>; book: Book }> {
  const db = openDb(':memory:')
  const api = createApi(db)
  const book = await api.books.create({ title: 'LA MAISON', author: 'JMS' })
  return { db, api, book }
}

describe('buildBookHtml', () => {
  it('sort les nœuds de mise en page en sections de premier niveau, corps en segments', async () => {
    const { db, api, book } = await livre()
    const ch = await api.chapters.create(book.id, 'Un')
    await api.chapters.saveContent(
      ch.id,
      doc(
        {
          type: 'chapterOpening',
          attrs: { enseigne: 'CHAPITRE 1', titre: 'TROIS HEURES', recto: true }
        },
        para('Le cri.'),
        para('Elle était debout.')
      ),
      'Le cri. Elle était debout.'
    )

    const html = buildBookHtml(db, book.id, [])
    expect(html).toContain('<section class="ouverture" id="ouv-1" data-recto="true">')
    expect(html).toContain('<p class="enseigne">CHAPITRE 1</p>')
    expect(html).toContain('<h2 class="titre-chapitre">TROIS HEURES</h2>')
    expect(html).toContain('<section class="chapitre">')
    // « Le cri. » est le premier paragraphe du corps du chapitre : il porte la
    // classe posée à l'assemblage (defect 2, round 3 de revue).
    expect(html).toContain('<p class="premier">Le cri.</p>')
    // l'ouverture n'est pas imbriquée dans le segment de corps
    expect(html.indexOf('<section class="ouverture"')).toBeLessThan(
      html.indexOf('<section class="chapitre">')
    )
    expect(html).not.toMatch(/<section class="chapitre">[\s\S]*<section class="ouverture"/)
  })

  it('développe le sommaire avec parties et chapitres dans l’ordre du livre', async () => {
    const { db, api, book } = await livre()
    const lim = await api.chapters.create(book.id, 'Liminaires')
    await api.chapters.saveContent(
      lim.id,
      doc({ type: 'tableOfContents', attrs: { titre: 'SOMMAIRE' } }),
      ''
    )
    const c1 = await api.chapters.create(book.id, 'Un')
    await api.chapters.saveContent(
      c1.id,
      doc(
        { type: 'partOpening', attrs: { label: 'Première partie', recto: true } },
        {
          type: 'chapterOpening',
          attrs: { enseigne: 'CHAPITRE 1', titre: 'TROIS HEURES', recto: true }
        },
        para('Le cri.')
      ),
      'Le cri.'
    )
    const c2 = await api.chapters.create(book.id, 'Deux')
    await api.chapters.saveContent(
      c2.id,
      doc(
        {
          type: 'chapterOpening',
          attrs: { enseigne: 'CHAPITRE 2', titre: 'CEUX QUI', recto: true }
        },
        para('Suite.')
      ),
      'Suite.'
    )

    const html = buildBookHtml(db, book.id, [])
    expect(html).toContain('<section class="sommaire">')
    expect(html).toContain('<h2>SOMMAIRE</h2>')
    expect(html).toContain('<li class="toc-partie">Première partie</li>')
    expect(html).toContain('<a href="#ouv-1">')
    expect(html).toContain('<a href="#ouv-2">')
    expect(html).toContain('<span class="toc-fill"></span>')
    expect(html.indexOf('href="#ouv-1"')).toBeLessThan(html.indexOf('href="#ouv-2"'))
    expect(html).toContain('id="part-1"')
  })

  it('replie sur le titre du chapitre quand aucune ouverture n’est posée', async () => {
    const { db, api, book } = await livre()
    const ch = await api.chapters.create(book.id, 'Sans ouverture')
    await api.chapters.saveContent(ch.id, doc(para('Texte.')), 'Texte.')

    const html = buildBookHtml(db, book.id, [])
    expect(html).toContain('<h1 class="titre-chapitre">Sans ouverture</h1>')
    expect(html).not.toContain('class="ouverture"')
  })

  it('ne replie pas quand une ouverture est posée', async () => {
    const { db, api, book } = await livre()
    const ch = await api.chapters.create(book.id, 'Titre en base')
    await api.chapters.saveContent(
      ch.id,
      doc(
        { type: 'chapterOpening', attrs: { enseigne: 'CH. 1', titre: 'Titre posé', recto: false } },
        para('Texte.')
      ),
      'Texte.'
    )

    const html = buildBookHtml(db, book.id, [])
    expect(html).not.toContain('<h1 class="titre-chapitre">Titre en base</h1>')
    expect(html).toContain('data-recto="false"')
  })

  it('embarque la feuille du bon format et le titre du livre', async () => {
    const { db, api, book } = await livre()
    await api.chapters.create(book.id, 'Un')
    expect(buildBookHtml(db, book.id, [])).toContain('size: 139.7mm 215.9mm')
    await api.books.update(book.id, { pageFormat: 'relie' })
    const html = buildBookHtml(db, book.id, [])
    expect(html).toContain('size: 6.14in 9.21in')
    expect(html).toContain('content: "LA MAISON"')
  })

  it('rend un sommaire vide sans erreur quand aucune ouverture n’est posée', async () => {
    const { db, api, book } = await livre()
    const ch = await api.chapters.create(book.id, 'Liminaires')
    await api.chapters.saveContent(
      ch.id,
      doc({ type: 'tableOfContents', attrs: { titre: 'SOMMAIRE' } }),
      ''
    )
    const html = buildBookHtml(db, book.id, [])
    expect(html).toContain('<section class="sommaire">')
    expect(html).not.toContain('<a href="#ouv-')
  })

  it('rend une page liminaire avec son contenu et son genre', async () => {
    const { db, api, book } = await livre()
    const ch = await api.chapters.create(book.id, 'Liminaires')
    await api.chapters.saveContent(
      ch.id,
      doc({ type: 'frontMatterPage', attrs: { genre: 'colophon' }, content: [para('© 2026')] }),
      '© 2026'
    )
    const html = buildBookHtml(db, book.id, [])
    expect(html).toContain('<section class="liminaire liminaire-colophon">')
    expect(html).toContain('<p>© 2026</p>')
  })

  it('rend le sous-titre entre le titre et le filet quand il est renseigné', async () => {
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
            sousTitre: '« La reconnaissance »',
            recto: true
          }
        },
        para('Le cri.')
      ),
      'Le cri.'
    )

    const html = buildBookHtml(db, book.id, [])
    expect(html).toContain('<p class="sous-titre">« La reconnaissance »</p>')
    const titreIdx = html.indexOf('<h2 class="titre-chapitre">TROIS HEURES</h2>')
    const sousTitreIdx = html.indexOf('<p class="sous-titre">')
    const filetIdx = html.indexOf('<div class="filet">')
    expect(titreIdx).toBeLessThan(sousTitreIdx)
    expect(sousTitreIdx).toBeLessThan(filetIdx)
  })

  it('n’émet aucun élément sous-titre quand il est absent', async () => {
    const { db, api, book } = await livre()
    const ch = await api.chapters.create(book.id, 'Un')
    await api.chapters.saveContent(
      ch.id,
      doc(
        {
          type: 'chapterOpening',
          attrs: { enseigne: 'CHAPITRE 1', titre: 'TROIS HEURES', recto: true }
        },
        para('Le cri.')
      ),
      'Le cri.'
    )

    const html = buildBookHtml(db, book.id, [])
    // La feuille de style embarquée porte toujours le sélecteur .sous-titre ;
    // seul le corps ne doit porter aucun élément portant cette classe.
    const corps = html.slice(html.indexOf('<body>'))
    expect(corps).not.toContain('sous-titre')
  })

  it('échappe le sous-titre', async () => {
    const { db, api, book } = await livre()
    const ch = await api.chapters.create(book.id, 'Un')
    await api.chapters.saveContent(
      ch.id,
      doc(
        {
          type: 'chapterOpening',
          attrs: { enseigne: 'CH. 1', titre: 'Titre', sousTitre: 'Fer & <acier>', recto: true }
        },
        para('Texte.')
      ),
      'Texte.'
    )

    const html = buildBookHtml(db, book.id, [])
    expect(html).toContain('<p class="sous-titre">Fer &amp; &lt;acier&gt;</p>')
    expect(html).not.toContain('<acier>')
  })

  it('échappe les attributs XML issus de valeurs contrôlées par l’auteur', async () => {
    const { db, api, book } = await livre()
    const ch = await api.chapters.create(book.id, 'Un')
    await api.chapters.saveContent(
      ch.id,
      doc(
        {
          type: 'chapterOpening',
          attrs: { enseigne: 'CH. 1 & 2', titre: 'Fer <acier>', recto: true }
        },
        para('Texte.')
      ),
      'Texte.'
    )

    const html = buildBookHtml(db, book.id, [])
    expect(html).toContain('CH. 1 &amp; 2')
    expect(html).toContain('Fer &lt;acier&gt;')
    // ni le & ni le < ne doivent survivre bruts dans le HTML produit
    expect(html).not.toMatch(/&(?!amp;|lt;|gt;|quot;|#)/)
    expect(html).not.toContain('<acier>')
  })

  it('un chapitre en repli de titre porte sa propre coupure de page et son premier paragraphe', async () => {
    const { db, api, book } = await livre()
    const ch = await api.chapters.create(book.id, 'Sans ouverture')
    await api.chapters.saveContent(
      ch.id,
      doc(para('Premier.'), para('Second.')),
      'Premier. Second.'
    )

    const html = buildBookHtml(db, book.id, [])
    expect(html).toContain('<section class="chapitre" data-debut="true">')
    expect(html).toContain('<p class="premier">Premier.</p>')
    expect(html).toContain('<p>Second.</p>')
  })

  it('un chapitre avec ouverture ne porte pas data-debut : la coupure de page est déjà sur l’ouverture', async () => {
    const { db, api, book } = await livre()
    const ch = await api.chapters.create(book.id, 'Un')
    await api.chapters.saveContent(
      ch.id,
      doc(
        { type: 'chapterOpening', attrs: { enseigne: 'CH. 1', titre: 'Titre', recto: true } },
        para('Le cri.')
      ),
      'Le cri.'
    )

    const html = buildBookHtml(db, book.id, [])
    // La feuille embarquée référence data-debut dans son sélecteur CSS (guillemets
    // simples) : on ne cherche donc que l'attribut HTML posé sur une section
    // (guillemets doubles), pas la sous-chaîne nue.
    expect(html).not.toContain('data-debut="true"')
  })

  it('pose la classe du paragraphe qui suit un séparateur de scène, pas de celui qui le précède', async () => {
    const { db, api, book } = await livre()
    const ch = await api.chapters.create(book.id, 'Un')
    await api.chapters.saveContent(
      ch.id,
      doc(para('Avant.'), { type: 'sceneBreak' }, para('Après.')),
      'Avant. Après.'
    )

    const html = buildBookHtml(db, book.id, [])
    expect(html).toContain('<p class="apres-scene">Après.</p>')
    expect(html).not.toContain('<p class="apres-scene">Avant.</p>')
  })

  it('ne pose pas la classe premier sur un paragraphe vide en tête de segment', async () => {
    const { db, api, book } = await livre()
    const ch = await api.chapters.create(book.id, 'Un')
    await api.chapters.saveContent(
      ch.id,
      doc({ type: 'paragraph' }, para('Vrai premier.')),
      'Vrai premier.'
    )

    const html = buildBookHtml(db, book.id, [])
    expect(html).toContain('<p class="premier">Vrai premier.</p>')
    expect(html).not.toContain('<p class="premier"></p>')
  })

  it('un chapitre qui commence par un séparateur de scène pose apres-scene, pas premier', async () => {
    const { db, api, book } = await livre()
    const ch = await api.chapters.create(book.id, 'Un')
    await api.chapters.saveContent(ch.id, doc({ type: 'sceneBreak' }, para('Après.')), 'Après.')

    const html = buildBookHtml(db, book.id, [])
    expect(html).toContain('<p class="apres-scene">Après.</p>')
    expect(html).not.toContain('<p class="premier">Après.</p>')
  })

  it('développement du sommaire dans plusieurs nœuds', async () => {
    const { db, api, book } = await livre()
    const lim = await api.chapters.create(book.id, 'Liminaires')
    await api.chapters.saveContent(
      lim.id,
      doc(
        { type: 'tableOfContents', attrs: { titre: 'SOMMAIRE' } },
        { type: 'tableOfContents', attrs: { titre: 'TABLE DES MATIÈRES' } }
      ),
      ''
    )
    const c1 = await api.chapters.create(book.id, 'Un')
    await api.chapters.saveContent(
      c1.id,
      doc(
        { type: 'partOpening', attrs: { label: 'Première partie', recto: true } },
        {
          type: 'chapterOpening',
          attrs: { enseigne: 'CHAPITRE 1', titre: 'TROIS HEURES', recto: true }
        },
        para('Le cri.')
      ),
      'Le cri.'
    )
    const c2 = await api.chapters.create(book.id, 'Deux')
    await api.chapters.saveContent(
      c2.id,
      doc(
        {
          type: 'chapterOpening',
          attrs: { enseigne: 'CHAPITRE 2', titre: 'CEUX QUI', recto: true }
        },
        para('Suite.')
      ),
      'Suite.'
    )

    const html = buildBookHtml(db, book.id, [])
    const sommaires = html.match(/<section class="sommaire">[\s\S]*?<\/section>/g) ?? []
    expect(sommaires).toHaveLength(2)
    for (const sommaire of sommaires) {
      expect(sommaire).toContain('<li class="toc-partie">Première partie</li>')
      expect(sommaire).toContain('href="#ouv-1"')
      expect(sommaire).toContain('href="#ouv-2"')
    }
    expect(sommaires[0]).toContain('<h2>SOMMAIRE</h2>')
    expect(sommaires[1]).toContain('<h2>TABLE DES MATIÈRES</h2>')
  })

  it('garde une illustration en vignette dans le corps du chapitre, sans coupure de page', async () => {
    const { db, api, book } = await livre()
    const mediaDir = mkdtempSync(join(tmpdir(), 'encre-media-'))
    writeFileSync(join(mediaDir, 'qr.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    const ch = await api.chapters.create(book.id, 'Restons en contact')
    await api.chapters.saveContent(
      ch.id,
      doc(
        para('Merci.'),
        {
          type: 'illustration',
          attrs: { fileName: 'qr.png', displayName: 'QR', taille: 'vignette' }
        },
        para('jmauteur.com')
      ),
      'Merci. jmauteur.com'
    )
    const html = buildBookHtml(db, book.id, [], mediaDir)
    expect(html).toContain('<figure class="illustration illustration-vignette">')
    expect(html).not.toContain('<section class="illustration">')
    // La vignette vit DANS l'unique segment de corps, entre les deux paragraphes.
    expect(html.match(/<section class="chapitre"/g)).toHaveLength(1)
    expect(html.indexOf('Merci.')).toBeLessThan(html.indexOf('<figure'))
    expect(html.indexOf('<figure')).toBeLessThan(html.indexOf('jmauteur.com'))
    // Le paragraphe qui suit la vignette est une légende : centré, sans alinéa.
    expect(html).toContain('<p class="legende">jmauteur.com</p>')
    expect(html).toContain('<p class="premier">Merci.</p>')
  })

  it('garde la planche pleine page en section à part', async () => {
    const { db, api, book } = await livre()
    const mediaDir = mkdtempSync(join(tmpdir(), 'encre-media-'))
    writeFileSync(join(mediaDir, 'planche.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    const ch = await api.chapters.create(book.id, 'Un')
    await api.chapters.saveContent(
      ch.id,
      doc(
        para('Avant.'),
        { type: 'illustration', attrs: { fileName: 'planche.png', displayName: 'Planche' } },
        para('Après.')
      ),
      'Avant. Après.'
    )
    const html = buildBookHtml(db, book.id, [], mediaDir)
    expect(html).toContain('<section class="illustration">')
    // La classe vignette existe forcément dans la feuille de style <style> (CSS
    // statique, indépendante du contenu) : on vérifie son absence dans le corps
    // du document, pas dans le HTML entier.
    expect(html.slice(html.indexOf('<body>'))).not.toContain('illustration-vignette')
    expect(html.match(/<section class="chapitre"/g)).toHaveLength(2)
  })
})
