import { describe, it, expect, beforeEach } from 'vitest'
import { openDb, type Db } from './connection'
import { createBook } from './books'
import { createChapter } from './chapters'
import { createEntity } from './entities'
import {
  listTimeline,
  createTimelineEvent,
  updateTimelineEvent,
  setTimelineLinks,
  reorderTimeline,
  deleteTimelineEvent
} from './timeline'

let db: Db
let bookId: number
beforeEach(() => {
  db = openDb(':memory:')
  bookId = createBook(db, { title: 'Livre' }).id
})

describe('repository timeline', () => {
  it('crée avec positions croissantes et met à jour', () => {
    const e1 = createTimelineEvent(db, bookId, 'Incendie')
    const e2 = createTimelineEvent(db, bookId, 'Fuite')
    expect([e1.position, e2.position]).toEqual([1, 2])
    const up = updateTimelineEvent(db, e1.id, {
      dateLabel: 'An 3, printemps',
      description: 'Tout brûle.'
    })
    expect(up.dateLabel).toBe('An 3, printemps')
  })

  it('gère les liens chapitres/entités en remplacement', () => {
    const ch = createChapter(db, bookId, 'Ch. 1')
    const mara = createEntity(db, { bookId, kind: 'character', name: 'Mara' })
    const ev = createTimelineEvent(db, bookId, 'Incendie')
    let linked = setTimelineLinks(db, ev.id, [ch.id], [mara.id])
    expect(linked.chapterIds).toEqual([ch.id])
    expect(linked.entityIds).toEqual([mara.id])
    linked = setTimelineLinks(db, ev.id, [], [])
    expect(linked.chapterIds).toEqual([])
    expect(linked.entityIds).toEqual([])
  })

  it('réordonne et supprime', () => {
    const a = createTimelineEvent(db, bookId, 'A')
    const b = createTimelineEvent(db, bookId, 'B')
    reorderTimeline(db, bookId, [b.id, a.id])
    expect(listTimeline(db, bookId).map((e) => e.title)).toEqual(['B', 'A'])
    deleteTimelineEvent(db, a.id)
    expect(listTimeline(db, bookId)).toHaveLength(1)
  })
})
