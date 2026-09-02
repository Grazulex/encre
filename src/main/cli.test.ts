import { describe, it, expect } from 'vitest'
import { existsSync, mkdtempSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { openDb } from './db/connection'
import { createApi } from './api'
import { exporterLivre, lancerExport, livresExportables, parseExportArgs } from './cli'

const doc = (...content: unknown[]): string => JSON.stringify({ type: 'doc', content })
const para = (texte: string): unknown => ({
  type: 'paragraph',
  content: [{ type: 'text', text: texte }]
})

async function bibliotheque() {
  const db = openDb(':memory:')
  const api = createApi(db)
  const plein = await api.books.create({ title: 'DOMICILE INCONNU', author: 'JMS' })
  await api.chapters.create(plein.id, 'Liminaires')
  const c = await api.chapters.create(plein.id, 'VINGT-SIX')
  await api.chapters.saveContent(c.id, doc(para('Il pleut.')), 'Il pleut.')
  const vide = await api.books.create({ title: 'Tome 03 - (titre à définir)', author: 'JMS' })
  const liminairesSeules = await api.books.create({ title: 'ESQUISSE', author: 'JMS' })
  await api.chapters.create(liminairesSeules.id, 'Liminaires')
  return { db, plein, vide, liminairesSeules }
}

describe('parseExportArgs', () => {
  it('rend null sans --export : démarrage normal', () => {
    expect(parseExportArgs(['/usr/bin/encre'])).toBeNull()
    expect(parseExportArgs(['electron', '.'])).toBeNull()
  })

  it('lit un ou plusieurs livres, le dossier et les deux formats par défaut', () => {
    expect(parseExportArgs(['Encre', '--export', '--livre', '37', '--sortie', '/tmp/x'])).toEqual({
      livres: [37],
      formats: ['pdf', 'epub'],
      sortie: '/tmp/x'
    })
    expect(
      parseExportArgs([
        'Encre',
        '--export',
        '--livre',
        '37',
        '--livre',
        '38',
        '--epub',
        '--sortie',
        '/tmp/x'
      ])
    ).toEqual({ livres: [37, 38], formats: ['epub'], sortie: '/tmp/x' })
    expect(parseExportArgs(['Encre', '--export', '--tous', '--pdf', '--sortie', '/tmp/x'])).toEqual(
      {
        livres: 'tous',
        formats: ['pdf'],
        sortie: '/tmp/x'
      }
    )
  })

  it('refuse les commandes mal formées avec un message lisible', () => {
    expect(() => parseExportArgs(['Encre', '--export', '--sortie', '/tmp/x'])).toThrow(
      /--tous ou au moins un --livre/
    )
    expect(() => parseExportArgs(['Encre', '--export', '--livre', '37'])).toThrow(/--sortie/)
    expect(() =>
      parseExportArgs(['Encre', '--export', '--livre', 'abc', '--sortie', '/tmp/x'])
    ).toThrow(/entier/)
    expect(() =>
      parseExportArgs(['Encre', '--export', '--tous', '--livre', '1', '--sortie', '/tmp/x'])
    ).toThrow(/exclusifs/)
    expect(() => parseExportArgs(['Encre', '--export', '--tous', '--sortie', '--pdf'])).toThrow(
      /dossier/
    )
  })
})

describe('livresExportables', () => {
  it('ne retient que les livres qui ont un chapitre après les Liminaires', async () => {
    const { db, plein } = await bibliotheque()
    expect(livresExportables(db)).toEqual([plein.id])
  })
})

describe('exporterLivre', () => {
  it('écrit slug.pdf et slug.epub dans le dossier, créé au besoin', async () => {
    const { db, plein } = await bibliotheque()
    const sortie = join(mkdtempSync(join(tmpdir(), 'encre-cli-')), 'sous', 'dossier')
    const faux = {
      pdf: async () => Buffer.from('%PDF-faux'),
      epub: async () => Buffer.from('PK-faux')
    }
    const ecrits = await exporterLivre(db, plein.id, '/nulle/part', sortie, ['pdf', 'epub'], faux)
    expect(ecrits).toEqual([
      join(sortie, 'domicile-inconnu.pdf'),
      join(sortie, 'domicile-inconnu.epub')
    ])
    expect(readFileSync(ecrits[0], 'utf8')).toBe('%PDF-faux')
    expect(readFileSync(ecrits[1], 'utf8')).toBe('PK-faux')
  })

  it('produit un vrai EPUB avec le constructeur réel', async () => {
    const { db, plein } = await bibliotheque()
    const sortie = mkdtempSync(join(tmpdir(), 'encre-cli-'))
    const [epub] = await exporterLivre(db, plein.id, sortie, sortie, ['epub'])
    expect(existsSync(epub)).toBe(true)
    // Une archive zip commence par la signature PK et un EPUB par son mimetype.
    const tete = readFileSync(epub).subarray(0, 40).toString('latin1')
    expect(tete.startsWith('PK')).toBe(true)
    expect(tete).toContain('mimetype')
  })
})

describe('lancerExport', () => {
  it('enchaîne tous les livres exportables et rapporte les échecs sans s’arrêter', async () => {
    const { db, plein } = await bibliotheque()
    const sortie = mkdtempSync(join(tmpdir(), 'encre-cli-'))
    const lignes: string[] = []
    const faux = {
      pdf: async () => {
        throw new Error('Chromium indisponible')
      },
      epub: async () => Buffer.from('PK-faux')
    }
    const r = await lancerExport(
      db,
      sortie,
      { livres: 'tous', formats: ['pdf', 'epub'], sortie },
      (l) => lignes.push(l),
      faux
    )
    expect(r.erreurs).toEqual([{ bookId: plein.id, message: 'Chromium indisponible' }])
    expect(r.ecrits).toEqual([])
    expect(lignes[0]).toMatch(/ÉCHEC : Chromium indisponible/)

    const ok = await lancerExport(
      db,
      sortie,
      { livres: [plein.id], formats: ['epub'], sortie },
      (l) => lignes.push(l),
      faux
    )
    expect(ok.erreurs).toEqual([])
    expect(ok.ecrits).toEqual([join(sortie, 'domicile-inconnu.epub')])
    expect(lignes.at(-1)).toContain('DOMICILE INCONNU → domicile-inconnu.epub')
  })
})
