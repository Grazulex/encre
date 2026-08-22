import { describe, it, expect } from 'vitest'
import { extractMentionIds } from './mentions'

const doc = (content: unknown[]) => JSON.stringify({ type: 'doc', content })

describe('extractMentionIds', () => {
  it('extrait les ids de mention, uniques, en profondeur', () => {
    const json = doc([
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Voici ' },
          { type: 'mention', attrs: { id: 3, label: 'Mara' } },
          { type: 'text', text: ' et ' },
          { type: 'mention', attrs: { id: 7, label: 'Brest' } }
        ]
      },
      { type: 'paragraph', content: [{ type: 'mention', attrs: { id: 3, label: 'Mara' } }] }
    ])
    expect(extractMentionIds(json)).toEqual([3, 7])
  })

  it('rend [] pour un doc vide ou sans mention', () => {
    expect(extractMentionIds(doc([]))).toEqual([])
    expect(extractMentionIds(doc([{ type: 'paragraph', content: [{ type: 'text', text: 'rien' }] }]))).toEqual([])
  })
})
