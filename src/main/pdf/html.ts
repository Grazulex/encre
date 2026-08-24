import { existsSync } from 'fs'
import { join, extname, basename } from 'path'
import { pathToFileURL } from 'url'
import type { Db } from '../db/connection'
import { getBook } from '../db/books'
import { listChapters, getChapter } from '../db/chapters'
import { tiptapToXhtml, escapeXml } from '../../shared/export'
import type { ExportOptions } from '../../shared/export'
import { IMAGE_MEDIA_TYPES } from '../media'
import { poserApresScene, poserPremier } from '../paragraphes'
import { buildPrintCss } from './style'

// Marqueur de coupure : le sérialiseur rend les nœuds de mise en page à leur place
// dans le flux du chapitre, mais la maquette exige qu'ils soient des sections de
// premier niveau (c'est ce qui rend les pages muettes et les sauts recto
// prévisibles). On les encadre donc d'un jeton, puis on découpe la chaîne rendue
// dessus. Même stratégie et même collision acceptée que le jeton de saut de page
// de importer.ts : un auteur qui écrirait littéralement ce jeton verrait son
// paragraphe coupé en deux.
const COUPURE = '%%ENCRE-SECTION%%'

interface Ancre {
  kind: 'part' | 'chapter'
  id: string
  enseigne: string
  texte: string
}

const entourer = (section: string): string => `${COUPURE}${section}${COUPURE}`

function walk(node: any, visit: (n: any) => void): void {
  visit(node)
  if (Array.isArray(node?.content)) node.content.forEach((c: any) => walk(c, visit))
}

// Passe 1 : relève les ancres de tous les chapitres retenus, dans l'ordre du livre.
// Le sommaire d'un chapitre doit pouvoir citer les ouvertures des autres, d'où ce
// premier parcours complet avant tout rendu.
function collectAnchors(docs: string[]): Ancre[] {
  const ancres: Ancre[] = []
  let parts = 0
  let chapitres = 0
  for (const json of docs) {
    let doc: any
    try {
      doc = JSON.parse(json)
    } catch {
      continue
    }
    walk(doc, (n) => {
      if (n?.type === 'partOpening') {
        parts += 1
        ancres.push({
          kind: 'part',
          id: `part-${parts}`,
          enseigne: '',
          texte: String(n.attrs?.label ?? '')
        })
      } else if (n?.type === 'chapterOpening') {
        chapitres += 1
        ancres.push({
          kind: 'chapter',
          id: `ouv-${chapitres}`,
          enseigne: String(n.attrs?.enseigne ?? ''),
          texte: String(n.attrs?.titre ?? '')
        })
      }
    })
  }
  return ancres
}

function contientOuverture(contentJson: string): boolean {
  let trouve = false
  try {
    walk(JSON.parse(contentJson), (n) => {
      if (n?.type === 'chapterOpening') trouve = true
    })
  } catch {
    return false
  }
  return trouve
}

// Le numéro de page et les points de conduite sont posés par la CSS
// (target-counter + remplissage flex) : ici on ne produit que la structure.
function renderToc(ancres: Ancre[], titre: string): string {
  const items = ancres.map((a) => {
    if (a.kind === 'part') return `<li class="toc-partie">${escapeXml(a.texte)}</li>`
    const enseigne = a.enseigne
      ? `<span class="toc-enseigne">${escapeXml(a.enseigne)} — </span>`
      : ''
    return `<li><a href="#${a.id}"><span class="toc-titre">${enseigne}${escapeXml(a.texte)}</span><span class="toc-fill"></span></a></li>`
  })
  return `<section class="sommaire"><h2>${escapeXml(titre)}</h2><ol>\n${items.join('\n')}\n</ol></section>`
}

// Les compteurs de ce rendu suivent le même ordre de parcours que collectAnchors,
// donc les identifiants coïncident. Il ne doit exister QU'UN renderer pour tout le
// livre : en créer un par chapitre remettrait les compteurs à zéro et ferait
// pointer tous les sommaires sur les ancres du premier chapitre.
function makeLayoutRenderer(ancres: Ancre[]): NonNullable<ExportOptions['layout']> {
  let parts = 0
  let chapitres = 0
  return (node, children) => {
    const attrs = node.attrs ?? {}
    const recto = attrs.recto === false ? 'false' : 'true'
    if (node.type === 'chapterOpening') {
      chapitres += 1
      const enseigne = String(attrs.enseigne ?? '')
      const ligne = enseigne ? `<p class="enseigne">${escapeXml(enseigne)}</p>` : ''
      // Sous-titre optionnel (la devise du chapitre) : rien n'est émis quand
      // il est absent — pas d'élément vide entre le titre et le filet.
      const sousTitre = String(attrs.sousTitre ?? '')
      const sousTitreHtml = sousTitre ? `<p class="sous-titre">${escapeXml(sousTitre)}</p>` : ''
      return {
        md: '',
        xhtml: entourer(
          `<section class="ouverture" id="ouv-${chapitres}" data-recto="${recto}">${ligne}` +
            `<h2 class="titre-chapitre">${escapeXml(String(attrs.titre ?? ''))}</h2>${sousTitreHtml}` +
            `<div class="filet"></div></section>`
        )
      }
    }
    if (node.type === 'partOpening') {
      parts += 1
      return {
        md: '',
        xhtml: entourer(
          `<section class="page-partie" id="part-${parts}" data-recto="${recto}">` +
            `<p class="partie-label">${escapeXml(String(attrs.label ?? ''))}</p>` +
            `<div class="filet"></div></section>`
        )
      }
    }
    if (node.type === 'tableOfContents') {
      return { md: '', xhtml: entourer(renderToc(ancres, String(attrs.titre ?? 'SOMMAIRE'))) }
    }
    const genre = String(attrs.genre ?? 'titre')
    // Ceinture-et-bretelles (Fix 1, revue finale) : le schéma (layoutNodes.ts,
    // groupe `miseEnPage`) interdit désormais d'imbriquer un nœud de mise en
    // page dans une liminaire, mais un document existant ou importé pourrait
    // encore en contenir un. Si c'était le cas, `children.xhtml` porterait les
    // marqueurs COUPURE du nœud imbriqué — on les retire ici avant d'encadrer
    // la section, pour garantir un HTML bien formé même dans ce cas résiduel
    // plutôt que de laisser une <section> mal refermée.
    const enfants = children.xhtml.split(COUPURE).join('')
    return {
      md: '',
      xhtml: entourer(
        `<section class="liminaire liminaire-${escapeXml(genre)}">${enfants}</section>`
      )
    }
  }
}

// Reprise du callback de src/main/pdf.ts avant scission, encadrée du marqueur : une
// planche est une page à part entière, elle ne peut pas rester dans un segment de
// corps sans en emporter le titre courant et le folio.
function makeIllustrationRenderer(mediaDir?: string): NonNullable<ExportOptions['illustration']> {
  return ({ fileName, displayName }) => {
    if (fileName !== basename(fileName)) return null
    if (!mediaDir) return null
    const src = join(mediaDir, fileName)
    if (!existsSync(src) || !(extname(fileName).toLowerCase() in IMAGE_MEDIA_TYPES)) return null
    return {
      md: '',
      xhtml: entourer(
        `<section class="illustration"><img src="${escapeXml(pathToFileURL(src).toString())}" alt="${escapeXml(displayName)}"/></section>`
      )
    }
  }
}

// Découpe le rendu d'un chapitre sur le marqueur : les tronçons déjà sectionnés
// sortent tels quels, les autres deviennent des segments de corps. Un chapitre
// entièrement composé de nœuds de mise en page n'a aucun segment de corps — le
// titre de repli n'a alors nulle part où aller, et c'est correct.
function segmenter(xhtml: string, titreRepli: string | null): string {
  const sorties: string[] = []
  let repliPose = false
  // Premier segment de corps du chapitre (indépendamment d'une ouverture ou
  // d'un repli de titre) : seul celui-là reçoit p.premier.
  let premierSegmentCorps = true
  for (const morceau of xhtml.split(COUPURE)) {
    const contenu = morceau.trim()
    if (contenu === '') continue
    if (contenu.startsWith('<section')) {
      sorties.push(contenu)
      continue
    }
    const tete =
      titreRepli !== null && !repliPose
        ? `<h1 class="titre-chapitre">${escapeXml(titreRepli)}</h1>\n`
        : ''
    // data-debut : seul le repli de titre a besoin de sa propre coupure de page
    // (.chapitre[data-debut='true'] en CSS) — quand une ouverture est posée,
    // elle porte déjà le break-before recto et son break-after: page, une
    // seconde coupure sur le corps romprait la page juste composée.
    const debut = titreRepli !== null && !repliPose ? ' data-debut="true"' : ''
    repliPose = true

    // Ordre important (defect 2b, revue finale) : poserApresScene doit tourner
    // AVANT poserPremier. Un chapitre qui commence par un séparateur de scène
    // a son premier <p> déjà classé "apres-scene" une fois ce premier appel
    // passé ; poserPremier, cherchant un `<p>` nu, ne le retague alors plus —
    // sans quoi ce paragraphe recevait "premier" au lieu de "apres-scene".
    let corpsSegment = poserApresScene(contenu)
    if (premierSegmentCorps) {
      corpsSegment = poserPremier(corpsSegment)
      premierSegmentCorps = false
    }

    sorties.push(`<section class="chapitre"${debut}>\n${tete}${corpsSegment}\n</section>`)
  }
  return sorties.join('\n')
}

export function buildBookHtml(
  db: Db,
  bookId: number,
  chapterIds: number[],
  mediaDir?: string
): string {
  const book = getBook(db, bookId)
  const tous = listChapters(db, bookId)
  const retenus = chapterIds.length === 0 ? tous : tous.filter((c) => chapterIds.includes(c.id))
  const complets = retenus.map((meta) => ({ meta, full: getChapter(db, meta.id) }))

  const ancres = collectAnchors(complets.map((c) => c.full.contentJson))
  const opts: ExportOptions = {
    layout: makeLayoutRenderer(ancres),
    illustration: makeIllustrationRenderer(mediaDir)
  }

  const corps = complets
    .map(({ meta, full }) =>
      segmenter(
        tiptapToXhtml(full.contentJson, opts),
        contientOuverture(full.contentJson) ? null : meta.title
      )
    )
    .join('\n')

  return `<!DOCTYPE html>
<html lang="${escapeXml(book.language || 'fr')}">
<head>
<meta charset="utf-8"/>
<title>${escapeXml(book.title)}</title>
<style>${buildPrintCss(book.pageFormat, book.title)}</style>
</head>
<body>
${corps}
</body>
</html>`
}
