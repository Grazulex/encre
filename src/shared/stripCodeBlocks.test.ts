import { describe, it, expect } from 'vitest'
import { stripCodeBlocks } from './stripCodeBlocks'

describe('stripCodeBlocks', () => {
  it('convertit les codeBlocks en paragraphes et retire la marque code', () => {
    const doc = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'codeBlock',
          attrs: { language: null },
          content: [{ type: 'text', text: 'Il faisait quatre degrés' }]
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'mono', marks: [{ type: 'code' }, { type: 'bold' }] }]
        }
      ]
    })
    const { json, changed } = stripCodeBlocks(doc)
    expect(changed).toBe(true)
    const parsed = JSON.parse(json)
    expect(parsed.content[0]).toEqual({
      type: 'paragraph',
      content: [{ type: 'text', text: 'Il faisait quatre degrés' }]
    })
    expect(parsed.content[1].content[0].marks).toEqual([{ type: 'bold' }])
  })

  it("ne change rien quand il n'y a rien à changer", () => {
    const doc = JSON.stringify({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'ok' }] }]
    })
    const res = stripCodeBlocks(doc)
    expect(res.changed).toBe(false)
    expect(res.json).toBe(doc)
  })

  it('convertit les horizontalRule hérités en sceneBreak (Task 3)', () => {
    const doc = JSON.stringify({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Avant' }] },
        { type: 'horizontalRule' },
        { type: 'paragraph', content: [{ type: 'text', text: 'Après' }] }
      ]
    })
    const { json, changed } = stripCodeBlocks(doc)
    expect(changed).toBe(true)
    const parsed = JSON.parse(json)
    expect(parsed.content[1]).toEqual({ type: 'sceneBreak' })
  })

  it('convertit un horizontalRule imbriqué (dans une liste) en sceneBreak', () => {
    const doc = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'horizontalRule' }]
            }
          ]
        }
      ]
    })
    const { json, changed } = stripCodeBlocks(doc)
    expect(changed).toBe(true)
    const parsed = JSON.parse(json)
    expect(parsed.content[0].content[0].content[0]).toEqual({ type: 'sceneBreak' })
  })
})
