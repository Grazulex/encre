import type { Db } from './db/connection'
import { getBook } from './db/books'
import { listChapters, getChapter } from './db/chapters'
import { tiptapToXhtml, escapeXml } from '../shared/export'

const STYLE_CSS = `@page { margin: 20mm 18mm; }
body {
  font-family: "Iowan Old Style", Charter, Georgia, serif;
  font-size: 11pt;
  line-height: 1.6;
}
.title-page {
  height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  page-break-after: always;
}
.title-page h1 {
  font-size: 2em;
  margin-bottom: 0.5em;
}
.title-page p {
  font-size: 1.2em;
}
.chapter {
  page-break-before: always;
}
.chapter h1 {
  font-size: 1.5em;
  margin-bottom: 1em;
}
p {
  margin: 0 0 1em 0;
  text-indent: 1.5em;
}
`

function buildHtml(title: string, author: string, chapters: { title: string; body: string }[]): string {
  const chaptersHtml = chapters
    .map(
      (c) => `<section class="chapter"><h1>${escapeXml(c.title)}</h1>\n${c.body}</section>`
    )
    .join('\n')
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8"/>
<title>${escapeXml(title)}</title>
<style>${STYLE_CSS}</style>
</head>
<body>
<section class="title-page">
<h1>${escapeXml(title)}</h1>
<p>${escapeXml(author)}</p>
</section>
${chaptersHtml}
</body>
</html>`
}

export async function buildPdf(db: Db, bookId: number, chapterIds: number[]): Promise<Buffer> {
  const { BrowserWindow } = await import('electron')

  const book = getBook(db, bookId)
  const allChapters = listChapters(db, bookId)
  const selected = chapterIds.length === 0
    ? allChapters
    : allChapters.filter((c) => chapterIds.includes(c.id))

  const chapters = selected.map((meta) => {
    const full = getChapter(db, meta.id)
    return { title: meta.title, body: tiptapToXhtml(full.contentJson) }
  })

  const html = buildHtml(book.title, book.author, chapters)

  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    return await win.webContents.printToPDF({ pageSize: 'A5', printBackground: true })
  } finally {
    win.close()
  }
}
