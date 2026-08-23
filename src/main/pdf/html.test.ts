import { describe, it, expect } from 'vitest'
import { openDb } from '../db/connection'
import { createApi } from '../api'
import { buildBookHtml } from './html'

function doc(...content: any[]): string {
  return JSON.stringify({ type: 'doc', content })
}
const para = (t: string) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })

async function livre() {
  const db = openDb(':memory:')
  const api = createApi(db)
  const book = await api.books.create({ title: 'LA MAISON', author: 'JMS' })
  return { db, api, book }
}

describe('buildBookHtml', () => {
  it('sort les nœuds de mise en page en sections de premier niveau, corps en segments', async () => {
    const { db, api, book } = await livre()
    const ch = await api.chapters.create(book.id, 'Un')
    await api.chapters.saveContent(ch.id, doc(
      { type: 'chapterOpening', attrs: { enseigne: 'CHAPITRE 1', titre: 'TROIS HEURES', recto: true } },
      para('Le cri.'),
      para('Elle était debout.')
    ), 'Le cri. Elle était debout.')

    const html = buildBookHtml(db, book.id, [])
    expect(html).toContain('<section class="ouverture" id="ouv-1" data-recto="true">')
    expect(html).toContain('<p class="enseigne">CHAPITRE 1</p>')
    expect(html).toContain('<h2 class="titre-chapitre">TROIS HEURES</h2>')
    expect(html).toContain('<section class="chapitre">')
    expect(html).toContain('<p>Le cri.</p>')
    // l'ouverture n'est pas imbriquée dans le segment de corps
    expect(html.indexOf('<section class="ouverture"')).toBeLessThan(html.indexOf('<section class="chapitre">'))
    expect(html).not.toMatch(/<section class="chapitre">[\s\S]*<section class="ouverture"/)
  })

  it('développe le sommaire avec parties et chapitres dans l’ordre du livre', async () => {
    const { db, api, book } = await livre()
    const lim = await api.chapters.create(book.id, 'Liminaires')
    await api.chapters.saveContent(lim.id, doc(
      { type: 'tableOfContents', attrs: { titre: 'SOMMAIRE' } }
    ), '')
    const c1 = await api.chapters.create(book.id, 'Un')
    await api.chapters.saveContent(c1.id, doc(
      { type: 'partOpening', attrs: { label: 'Première partie', recto: true } },
      { type: 'chapterOpening', attrs: { enseigne: 'CHAPITRE 1', titre: 'TROIS HEURES', recto: true } },
      para('Le cri.')
    ), 'Le cri.')
    const c2 = await api.chapters.create(book.id, 'Deux')
    await api.chapters.saveContent(c2.id, doc(
      { type: 'chapterOpening', attrs: { enseigne: 'CHAPITRE 2', titre: 'CEUX QUI', recto: true } },
      para('Suite.')
    ), 'Suite.')

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
    await api.chapters.saveContent(ch.id, doc(
      { type: 'chapterOpening', attrs: { enseigne: 'CH. 1', titre: 'Titre posé', recto: false } },
      para('Texte.')
    ), 'Texte.')

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
    await api.chapters.saveContent(ch.id, doc(
      { type: 'tableOfContents', attrs: { titre: 'SOMMAIRE' } }
    ), '')
    const html = buildBookHtml(db, book.id, [])
    expect(html).toContain('<section class="sommaire">')
    expect(html).not.toContain('<a href="#ouv-')
  })

  it('rend une page liminaire avec son contenu et son genre', async () => {
    const { db, api, book } = await livre()
    const ch = await api.chapters.create(book.id, 'Liminaires')
    await api.chapters.saveContent(ch.id, doc(
      { type: 'frontMatterPage', attrs: { genre: 'colophon' }, content: [para('© 2026')] }
    ), '© 2026')
    const html = buildBookHtml(db, book.id, [])
    expect(html).toContain('<section class="liminaire liminaire-colophon">')
    expect(html).toContain('<p>© 2026</p>')
  })
})
