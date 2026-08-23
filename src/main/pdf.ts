import type { Db } from './db/connection'
import { buildBookHtml } from './pdf/html'
import { renderHtmlToPdf } from './pdf/render'

export async function buildPdf(
  db: Db,
  bookId: number,
  chapterIds: number[],
  mediaDir?: string
): Promise<Buffer> {
  return renderHtmlToPdf(buildBookHtml(db, bookId, chapterIds, mediaDir))
}
