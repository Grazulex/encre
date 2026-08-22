import { describe, it, expect, vi } from 'vitest'
import { openDb } from './db/connection'
import { createApi } from './api'
import type { AiRunner } from './ai/service'

function makeFakeRunner(text: string): AiRunner {
  return {
    run: async (_params, onChunk) => {
      onChunk(text)
      return text
    }
  }
}

function makeEmitRecorder(): { emit: (channel: string, payload: unknown) => void; events: { channel: string; payload: unknown }[] } {
  const events: { channel: string; payload: unknown }[] = []
  return { emit: (channel, payload) => events.push({ channel, payload }), events }
}

describe('createApi', () => {
  it('expose le cycle complet livre → chapitre → contenu', async () => {
    const api = createApi(openDb(':memory:'))
    const book = await api.books.create({ title: 'Via API' })
    const chapter = await api.chapters.create(book.id, 'Chapitre 1')
    await api.chapters.saveContent(chapter.id, '{"type":"doc","content":[]}', 'un deux trois')
    const metas = await api.chapters.listByBook(book.id)
    expect(metas[0].wordCount).toBe(3)
    const refreshed = await api.books.get(book.id)
    expect(refreshed.wordCount).toBe(3)
    expect(refreshed.chapterCount).toBe(1)
  })

  it('expose entités, plan, chronologie et résumé', async () => {
    const api = createApi(openDb(':memory:'))
    const book = await api.books.create({ title: 'Via API v2' })
    const mara = await api.entities.create({ bookId: book.id, kind: 'character', name: 'Mara' })
    const ch = await api.chapters.create(book.id, 'Ch. 1')
    await api.chapters.saveSummary(ch.id, 'Résumé.')
    expect((await api.chapters.get(ch.id)).summary).toBe('Résumé.')
    const note = await api.outline.create(book.id, ch.id)
    await api.outline.update(note.id, 'Plan du chapitre')
    const ev = await api.timeline.create(book.id, 'Incendie')
    await api.timeline.setLinks(ev.id, [ch.id], [mara.id])
    expect((await api.timeline.listByBook(book.id))[0].entityIds).toEqual([mara.id])
    expect(await api.entities.listByBook(book.id, 'character')).toHaveLength(1)
  })

  it('importe un dossier markdown en livre complet (transactionnel)', async () => {
    const { mkdtempSync, writeFileSync } = await import('fs')
    const { tmpdir } = await import('os')
    const { join } = await import('path')
    const dir = mkdtempSync(join(tmpdir(), 'encre-import-api-'))
    writeFileSync(join(dir, '01-un.md'), '# Un\n\nPremier chapitre.')
    writeFileSync(join(dir, '02-deux.md'), 'Deuxième **chapitre**.')
    const api = createApi(openDb(':memory:'))
    const book = await api.importer.importBook(dir, ['01-un.md', '02-deux.md'], 'Importé')
    expect(book.chapterCount).toBe(2)
    const metas = await api.chapters.listByBook(book.id)
    expect(metas.map((m) => m.title)).toEqual(['Un', 'deux'])
    expect(metas[0].wordCount).toBeGreaterThan(0)
  })

  it('importe un fichier markdown isolé comme nouveau chapitre d\'un livre existant', async () => {
    const { mkdtempSync, writeFileSync } = await import('fs')
    const { tmpdir } = await import('os')
    const { join } = await import('path')
    const dir = mkdtempSync(join(tmpdir(), 'encre-import-chapter-'))
    const filePath = join(dir, 'chapitre.md')
    writeFileSync(filePath, '# Ch. importé\n\nDu **texte**.')
    const db = openDb(':memory:')
    const api = createApi(db)
    const book = await api.books.create({ title: 'Livre existant' })
    const { importChapterFromFile } = await import('./api')
    const meta = importChapterFromFile(db, book.id, filePath)
    expect(meta.title).toBe('Ch. importé')
    expect(meta.wordCount).toBeGreaterThan(0)
    const chapter = await api.chapters.get(meta.id)
    expect(chapter.contentJson).toContain('bold')
  })

  it('exporte le livre en markdown, un fichier par chapitre', async () => {
    // exposer une fonction interne testable : exportMarkdownToFolder(db, bookId, folder)
    const { mkdtempSync, readdirSync, readFileSync } = await import('fs')
    const { tmpdir } = await import('os')
    const { join } = await import('path')
    const db = openDb(':memory:')
    const api = createApi(db)
    const book = await api.books.create({ title: 'Export' })
    const ch = await api.chapters.create(book.id, 'Chapitre un')
    await api.chapters.saveContent(ch.id, JSON.stringify({
      type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Bonjour.' }] }]
    }), 'Bonjour.')
    const dir = mkdtempSync(join(tmpdir(), 'encre-export-'))
    const { exportMarkdownToFolder } = await import('./exporter')
    exportMarkdownToFolder(db, book.id, dir)
    const files = readdirSync(dir)
    expect(files).toEqual(['01-chapitre-un.md'])
    expect(readFileSync(join(dir, files[0]), 'utf8')).toBe('# Chapitre un\n\nBonjour.\n')
  })

  it('ai.prepareWrite signale hasSummary=false quand le chapitre n\'a pas de résumé', async () => {
    const db = openDb(':memory:')
    const api = createApi(db)
    const book = await api.books.create({ title: 'Sans résumé' })
    const chapter = await api.chapters.create(book.id, 'Ch. 1')
    const result = await api.ai.prepareWrite(chapter.id)
    expect(result.hasSummary).toBe(false)
    expect(result.defaultEntityIds).toEqual([])
  })

  it('ai.startWrite rejette clairement quand le chapitre n\'a pas de résumé', async () => {
    const db = openDb(':memory:')
    const { emit } = makeEmitRecorder()
    const api = createApi(db, { runner: makeFakeRunner('texte'), emitAiEvent: emit })
    const book = await api.books.create({ title: 'Sans résumé' })
    const chapter = await api.chapters.create(book.id, 'Ch. 1')
    await expect(
      api.ai.startWrite(chapter.id, { model: 'claude-x', continueFromText: false })
    ).rejects.toThrow()
  })

  it('ai.startWrite avec résumé génère un requestId, émet chunk/done et enregistre la session', async () => {
    const db = openDb(':memory:')
    let resolveDone: (() => void) | undefined
    const donePromise = new Promise<void>((resolve) => { resolveDone = resolve })
    const events: { channel: string; payload: unknown }[] = []
    const emit = (channel: string, payload: unknown): void => {
      events.push({ channel, payload })
      if (channel === 'ai:done' || channel === 'ai:error') resolveDone?.()
    }
    const api = createApi(db, { runner: makeFakeRunner('Il était une fois.'), emitAiEvent: emit })
    const book = await api.books.create({ title: 'Avec résumé' })
    const chapter = await api.chapters.create(book.id, 'Ch. 1')
    await api.chapters.saveSummary(chapter.id, 'Un résumé.')

    const requestId = await api.ai.startWrite(chapter.id, { model: 'claude-x', continueFromText: false })
    expect(requestId).toBeTypeOf('string')

    await donePromise

    const chunkEvent = events.find((e) => e.channel === 'ai:chunk')
    const doneEvent = events.find((e) => e.channel === 'ai:done')
    expect(chunkEvent?.payload).toEqual({ requestId, text: 'Il était une fois.' })
    expect(doneEvent?.payload).toEqual({ requestId, text: 'Il était une fois.' })

    const session = db.prepare('SELECT * FROM ai_sessions WHERE chapter_id = ?').get(chapter.id) as any
    expect(session).toBeTruthy()
    expect(session.book_id).toBe(book.id)
    expect(session.task).toBe('write')
    expect(session.model).toBe('claude-x')

    const messages = db.prepare('SELECT role, content FROM ai_messages WHERE session_id = ? ORDER BY id').all(session.id) as any[]
    expect(messages).toHaveLength(2)
    expect(messages[0].role).toBe('user')
    expect(messages[1].role).toBe('assistant')
    expect(messages[1].content).toBe('Il était une fois.')
  })

  it('ai:done est émis même si l\'archivage du message assistant échoue', async () => {
    // Régression : onDone doit livrer le brouillon au renderer AVANT de tenter
    // l'archivage — une panne d'écriture DB ne doit jamais avaler ai:done (voir
    // finding « onDone: a failed addAiMessage swallows ai:done »). On contrôle
    // manuellement la résolution du runner pour intercaler la casse de la table
    // ai_messages exactement entre l'obtention du requestId et l'appel d'onDone.
    const db = openDb(':memory:')
    let resolveRun: ((text: string) => void) | undefined
    const runner: AiRunner = {
      run: async (_params, onChunk) =>
        new Promise<string>((resolve) => {
          resolveRun = (text) => {
            onChunk(text)
            resolve(text)
          }
        })
    }
    let resolveDone: (() => void) | undefined
    const donePromise = new Promise<void>((resolve) => { resolveDone = resolve })
    const events: { channel: string; payload: unknown }[] = []
    const emit = (channel: string, payload: unknown): void => {
      events.push({ channel, payload })
      if (channel === 'ai:done' || channel === 'ai:error') resolveDone?.()
    }
    const api = createApi(db, { runner, emitAiEvent: emit })
    const book = await api.books.create({ title: 'Archivage cassé' })
    const chapter = await api.chapters.create(book.id, 'Ch. 1')
    await api.chapters.saveSummary(chapter.id, 'Un résumé.')

    const requestId = await api.ai.startWrite(chapter.id, { model: 'claude-x', continueFromText: false })

    // Casse l'archivage assistant (mais pas la livraison) : la table n'existe
    // plus quand onDone tentera addAiMessage.
    db.exec('DROP TABLE ai_messages')
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    resolveRun?.('Texte malgré tout livré.')
    await donePromise

    const doneEvent = events.find((e) => e.channel === 'ai:done')
    expect(doneEvent?.payload).toEqual({ requestId, text: 'Texte malgré tout livré.' })
    expect(errorSpy).toHaveBeenCalled()

    errorSpy.mockRestore()
  })

  it('ai.startFormat rejette clairement un chapitre vide', async () => {
    const db = openDb(':memory:')
    const { emit } = makeEmitRecorder()
    const api = createApi(db, { runner: makeFakeRunner('« Bonjour », dit-elle.'), emitAiEvent: emit })
    const book = await api.books.create({ title: 'Chapitre vide' })
    const chapter = await api.chapters.create(book.id, 'Ch. 1')
    await expect(
      api.ai.startFormat(chapter.id, { dialogue: 'guillemets', listes: 'tirets', proposerSeparations: false })
    ).rejects.toThrow()
  })

  it('ai.startFormat sur un chapitre non vide génère un requestId, émet chunk/done et enregistre une session task=\'format\'', async () => {
    const db = openDb(':memory:')
    let resolveDone: (() => void) | undefined
    const donePromise = new Promise<void>((resolve) => { resolveDone = resolve })
    const events: { channel: string; payload: unknown }[] = []
    const emit = (channel: string, payload: unknown): void => {
      events.push({ channel, payload })
      if (channel === 'ai:done' || channel === 'ai:error') resolveDone?.()
    }
    const api = createApi(db, { runner: makeFakeRunner('« Bonjour », dit-elle.'), emitAiEvent: emit })
    const book = await api.books.create({ title: 'Avec contenu' })
    const chapter = await api.chapters.create(book.id, 'Ch. 1')
    await api.chapters.saveContent(
      chapter.id,
      JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '* Bonjour *, dit-elle.' }] }] }),
      '* Bonjour *, dit-elle.'
    )

    const requestId = await api.ai.startFormat(chapter.id, { dialogue: 'guillemets', listes: 'tirets', proposerSeparations: false })
    expect(requestId).toBeTypeOf('string')

    await donePromise

    const chunkEvent = events.find((e) => e.channel === 'ai:chunk')
    const doneEvent = events.find((e) => e.channel === 'ai:done')
    expect(chunkEvent?.payload).toEqual({ requestId, text: '« Bonjour », dit-elle.' })
    expect(doneEvent?.payload).toEqual({ requestId, text: '« Bonjour », dit-elle.' })

    const session = db.prepare('SELECT * FROM ai_sessions WHERE chapter_id = ?').get(chapter.id) as any
    expect(session).toBeTruthy()
    expect(session.book_id).toBe(book.id)
    expect(session.task).toBe('format')

    const messages = db.prepare('SELECT role, content FROM ai_messages WHERE session_id = ? ORDER BY id').all(session.id) as any[]
    expect(messages).toHaveLength(2)
    expect(messages[0].role).toBe('user')
    expect(messages[1].role).toBe('assistant')
    expect(messages[1].content).toBe('« Bonjour », dit-elle.')
  })

  it('ai.formatToJson convertit du Markdown en JSON TipTap (aucune écriture en base)', async () => {
    const api = createApi(openDb(':memory:'))
    const { contentJson, contentText } = await api.ai.formatToJson('« Bonjour », dit-elle.')
    expect(contentText).toBe('« Bonjour », dit-elle.')
    expect(JSON.parse(contentJson).type).toBe('doc')
  })

  // Correctif review (Task 6, régression critique) : ai.formatToJson ne doit
  // PAS retirer un `# …` de tête — contrairement à l'import de fichier, ce
  // Markdown est le corps d'un chapitre déjà existant (round-trip
  // tiptapToMarkdown → Claude), où un H1 de tête est un vrai titre écrit par
  // l'auteur dans le texte. Voir importer.ts (MdToTiptapJsonOptions) et
  // importer.test.ts pour la couverture de la fonction sous-jacente ; ce test
  // vérifie le câblage réel de l'appel IPC (stripLeadingH1: false).
  it("ai.formatToJson conserve un titre H1 de tête (round-trip harmonisation, pas de sémantique d'import)", async () => {
    const api = createApi(openDb(':memory:'))
    const { contentJson, contentText } = await api.ai.formatToJson('# Un titre\n\nParagraphe…')
    expect(JSON.stringify(JSON.parse(contentJson))).toContain('"heading"')
    expect(contentText).toContain('Un titre')
    expect(contentText).toContain('Paragraphe…')
  })

  it('snapshots.create/listByChapter/content passent par l\'API', async () => {
    const db = openDb(':memory:')
    const api = createApi(db)
    const book = await api.books.create({ title: 'Snapshots' })
    const chapter = await api.chapters.create(book.id, 'Ch. 1')
    const snap = await api.snapshots.create(chapter.id, '{"type":"doc"}', 'manuel')
    expect(snap.chapterId).toBe(chapter.id)
    expect(snap.reason).toBe('manuel')

    const list = await api.snapshots.listByChapter(chapter.id)
    expect(list.map((s) => s.id)).toContain(snap.id)

    const content = await api.snapshots.content(snap.id)
    expect(content).toBe('{"type":"doc"}')
  })

  it('snapshots.remove supprime un snapshot via l\'API', async () => {
    const db = openDb(':memory:')
    const api = createApi(db)
    const book = await api.books.create({ title: 'Snapshots Remove' })
    const chapter = await api.chapters.create(book.id, 'Ch. 1')
    const snap1 = await api.snapshots.create(chapter.id, '{"type":"doc"}', 'ia')
    const snap2 = await api.snapshots.create(chapter.id, '{"type":"doc"}', 'manuel')

    let list = await api.snapshots.listByChapter(chapter.id)
    expect(list).toHaveLength(2)

    await api.snapshots.remove(snap1.id)

    list = await api.snapshots.listByChapter(chapter.id)
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe(snap2.id)
  })

  it('series.getOrCreate est idempotent et series.list la retourne', async () => {
    const api = createApi(openDb(':memory:'))
    const s1 = await api.series.getOrCreate('Les Chroniques de Verre')
    const s2 = await api.series.getOrCreate('Les Chroniques de Verre')
    expect(s2.id).toBe(s1.id)

    const all = await api.series.list()
    expect(all.map((s) => s.id)).toContain(s1.id)
  })
})
