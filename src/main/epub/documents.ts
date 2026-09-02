import { existsSync } from 'fs'
import { join, extname, basename } from 'path'
import type { Db } from '../db/connection'
import { getBook } from '../db/books'
import { listChapters, getChapter } from '../db/chapters'
import { tiptapToXhtml, escapeXml } from '../../shared/export'
import type { ExportOptions } from '../../shared/export'
import { IMAGE_MEDIA_TYPES } from '../media'
import { poserApresScene, poserPremier } from '../paragraphes'
import { textesEpub } from './textes'

// Découpage du manuscrit en documents XHTML (spec maquette EPUB, §2). Même
// stratégie que src/main/pdf/html.ts : un callback `layout` passé au sérialiseur
// partagé, et un jeton de coupure inséré autour de chaque nœud de mise en page
// pour découper ensuite la chaîne rendue.
//
// UNE différence assumée avec le PDF : le jeton porte un INDEX, pas du HTML. Le
// renderer pousse chaque nœud de mise en page dans un tableau typé local et
// n'émet que `%%ENCRE-BLOC%%<index>%%ENCRE-BLOC%%` ; le découpeur résout
// l'index en un objet `{ kind, … }`. Le PDF, lui, renifle le préfixe `<section`
// du tronçon pour deviner s'il est déjà sectionné — ce qui revient à réanalyser
// le HTML qu'on vient de produire, et casse au moindre changement de balise
// d'enveloppe. Ici, la nature du tronçon est connue par construction : c'est
// nécessaire, l'EPUB ayant besoin de bien plus qu'un booléen (nom de fichier,
// epub:type, libellé de navigation) pour chaque nœud.
const JETON = '%%ENCRE-BLOC%%'
const jeton = (index: number): string => `${JETON}${index}${JETON}`
// Retire un jeton COMPLET (avec son index) : se contenter de retirer le
// délimiteur laisserait le numéro nu dans le texte.
const RE_JETON = /%%ENCRE-BLOC%%\d+%%ENCRE-BLOC%%/g

export type EpubDocKind = 'chapitre' | 'partie' | 'liminaire'

export interface EpubDocument {
  nom: string // nom de fichier dans OEBPS/, ex. 'chapitre-00.xhtml'
  kind: EpubDocKind
  titre: string // texte brut destiné au <title> du XHTML (NON échappé : l'assembleur échappe)
  corps: string // contenu complet de <body>, <section epub:type="…"> incluse, XHTML bien formé
  nav: string | null // libellé dans la table des matières ; null = absent de la nav
}

export interface EpubContenu {
  documents: EpubDocument[]
  images: string[] // noms de fichiers d'illustration, ordre de première rencontre, dédupliqués
}

// Nœud de mise en page résolu, poussé par le renderer et relu par le découpeur.
type Bloc =
  | { kind: 'liminaire'; genre: string; contenu: string }
  | { kind: 'partie'; label: string }
  | { kind: 'ouverture'; enseigne: string; titre: string; sousTitre: string }

// Genres de page liminaire : nom de fichier, epub:type sémantique et présence
// en navigation. Un genre inconnu (document importé, schéma futur) retombe sur
// un `frontmatter` muet plutôt que d'être perdu.
interface Liminaire {
  base: string
  epubType: string
  nav: (langue: string) => string | null
}
const LIMINAIRES: Record<string, Liminaire> = {
  titre: { base: 'titre', epubType: 'titlepage', nav: (l) => textesEpub(l).pageTitre },
  colophon: { base: 'colophon', epubType: 'copyright-page', nav: () => null },
  dedicace: { base: 'dedicace', epubType: 'dedication', nav: () => null }
}
const LIMINAIRE_INCONNU: Liminaire = { base: 'liminaire', epubType: 'frontmatter', nav: () => null }

function contientOuverture(contentJson: string): boolean {
  let trouve = false
  const walk = (node: any): void => {
    if (node?.type === 'chapterOpening') trouve = true
    if (Array.isArray(node?.content)) node.content.forEach(walk)
  }
  try {
    walk(JSON.parse(contentJson))
  } catch {
    return false
  }
  return trouve
}

// Document en cours de construction : ses morceaux sont accumulés puis
// enveloppés d'une seule <section> à la fin. Un document chapitre reste ouvert
// tant que des segments de corps le suivent.
interface DocEnCours {
  nom: string
  kind: EpubDocKind
  titre: string
  nav: string | null
  epubType: string
  classe: string
  morceaux: string[]
}

function figer(doc: DocEnCours): EpubDocument {
  const classe = doc.classe ? ` class="${doc.classe}"` : ''
  return {
    nom: doc.nom,
    kind: doc.kind,
    titre: doc.titre,
    nav: doc.nav,
    corps: `<section epub:type="${doc.epubType}"${classe}>\n${doc.morceaux.join('\n')}\n</section>`
  }
}

const numero = (n: number): string => String(n).padStart(2, '0')

// Le renderer de mise en page : il ne produit aucun HTML de section, seulement
// un jeton indexé. Comme pour le PDF, il ne doit en exister QU'UN pour tout le
// livre — les compteurs de chapitres et de parties sont globaux au manuscrit,
// pas remis à zéro à chaque chapitre de base, sans quoi deux chapitres de base
// produiraient tous deux un `chapitre-00.xhtml`.
function makeLayoutRenderer(blocs: Bloc[]): NonNullable<ExportOptions['layout']> {
  return (node, children) => {
    const attrs = node.attrs ?? {}
    if (node.type === 'tableOfContents') {
      // L'EPUB a sa navigation native (nav.xhtml / toc.ncx) : le sommaire
      // paginé n'a pas de sens ici. Retourner null omet le nœud entièrement —
      // aucun document, aucune trace dans le corps, pas même un jeton.
      return null
    }
    if (node.type === 'chapterOpening') {
      blocs.push({
        kind: 'ouverture',
        enseigne: String(attrs.enseigne ?? ''),
        titre: String(attrs.titre ?? ''),
        sousTitre: String(attrs.sousTitre ?? '')
      })
      return { md: '', xhtml: jeton(blocs.length - 1) }
    }
    if (node.type === 'partOpening') {
      blocs.push({ kind: 'partie', label: String(attrs.label ?? '') })
      return { md: '', xhtml: jeton(blocs.length - 1) }
    }
    // Ceinture-et-bretelles reprise de pdf/html.ts : le schéma interdit
    // désormais d'imbriquer un nœud de mise en page dans une liminaire, mais un
    // document existant ou importé pourrait encore en contenir un. Son jeton
    // traînerait alors dans `children.xhtml` et ferait couper la liminaire en
    // deux au découpage. On le retire ici, pour garantir un XHTML bien formé
    // même dans ce cas résiduel.
    const contenu = children.xhtml.replace(RE_JETON, '')
    blocs.push({ kind: 'liminaire', genre: String(attrs.genre ?? 'titre'), contenu })
    return { md: '', xhtml: jeton(blocs.length - 1) }
  }
}

// Les gardes sont celles de l'ancien src/main/epub.ts, conservées telles
// quelles : rejet d'un fileName qui n'est pas un simple nom de base
// (anti-traversée), rejet d'un fichier absent de mediaDir, extension inconnue
// omise. Une illustration n'est PAS une page à part en EPUB (support
// reflowable) : elle reste dans le flux du document courant, sans jeton.
function makeIllustrationRenderer(
  mediaDir: string | undefined,
  images: string[]
): NonNullable<ExportOptions['illustration']> {
  return ({ fileName, displayName, taille }) => {
    if (fileName !== basename(fileName)) return null
    if (!mediaDir) return null
    const src = join(mediaDir, fileName)
    if (!existsSync(src)) return null
    if (!(extname(fileName).toLowerCase() in IMAGE_MEDIA_TYPES)) return null
    // Le nom poussé dans images[] reste LITTÉRAL : c'est un chemin d'entrée de
    // zip, pas une URI. Le `src`, lui, en est une : un nom accentué ou espacé
    // non encodé viole RSC-020 d'EPUBCheck.
    if (!images.includes(fileName)) images.push(fileName)
    const classes = taille === 'vignette' ? 'illustration illustration-vignette' : 'illustration'
    return {
      md: '',
      xhtml:
        `<div class="${classes}">` +
        `<img src="images/${encodeURIComponent(fileName)}" alt="${escapeXml(displayName)}"/>` +
        `</div>`
    }
  }
}

// Compteurs et documents partagés par tous les chapitres de base du livre.
interface Etat {
  documents: DocEnCours[]
  langue: string
  chapitres: number
  parties: number
  genres: Record<string, number>
}

function nomLiminaire(etat: Etat, base: string): string {
  const rang = (etat.genres[base] ?? 0) + 1
  etat.genres[base] = rang
  // Premier du genre : `titre.xhtml`. Les suivants : `titre-2.xhtml`, …
  return rang === 1 ? `${base}.xhtml` : `${base}-${rang}.xhtml`
}

function ouvrirChapitre(etat: Etat, titre: string, nav: string | null): DocEnCours {
  const doc: DocEnCours = {
    nom: `chapitre-${numero(etat.chapitres)}.xhtml`,
    kind: 'chapitre',
    titre,
    nav,
    epubType: 'chapter',
    classe: '',
    morceaux: []
  }
  etat.chapitres += 1
  etat.documents.push(doc)
  return doc
}

// Découpe le rendu d'un chapitre de base sur le jeton et distribue les tronçons.
// Un chapitre entièrement composé de nœuds de mise en page n'a aucun segment de
// corps — il ne produit alors aucun document chapitre vide, et c'est correct.
function repartir(
  xhtml: string,
  blocs: Bloc[],
  etat: Etat,
  titreDefaut: string,
  avecOuverture: boolean,
  titreRepli: string | null
): void {
  // Le document chapitre courant repart à zéro à chaque chapitre de base : le
  // corps d'un chapitre ne doit jamais rejoindre le document du précédent.
  let courant: DocEnCours | null = null
  let repliPose = false
  // Premier segment de corps du chapitre (indépendamment d'une ouverture ou
  // d'un repli de titre) : seul celui-là reçoit p.premier.
  let premierSegmentCorps = true
  // Segments de corps rencontrés AVANT la première ouverture d'un chapitre qui
  // en contient une (cas réel : la planche pleine page qui ouvre le chapitre est
  // posée avant le chapterOpening). Ils sont mis en attente et préfixés dans le
  // document que l'ouverture crée, au lieu de fabriquer un document orphelin
  // portant une étiquette de repli — lequel doublait l'entrée de navigation du
  // chapitre et détachait la planche du chapitre qu'elle ouvre. Le PDF n'invente
  // jamais de titre là où l'auteur a posé une ouverture (segmenter() passe
  // titreRepli à null dès qu'il y en a une) : on ne doit pas en inventer non plus.
  const attente: string[] = []
  let ouvertureVue = false

  const morceaux = xhtml.split(JETON)
  for (let i = 0; i < morceaux.length; i += 1) {
    // Chaque jeton apporte exactement deux délimiteurs : les rangs impairs
    // portent l'index du bloc, les rangs pairs le texte qui les sépare.
    if (i % 2 === 1) {
      const bloc = blocs[Number(morceaux[i])]
      if (!bloc) continue
      if (bloc.kind === 'liminaire') {
        const modele = LIMINAIRES[bloc.genre] ?? LIMINAIRE_INCONNU
        etat.documents.push({
          nom: nomLiminaire(etat, modele.base),
          kind: 'liminaire',
          titre: modele.nav(etat.langue) ?? bloc.genre,
          nav: modele.nav(etat.langue),
          epubType: modele.epubType,
          classe: '',
          // Même vocabulaire de classes que le PDF : la <div> liminaire reste,
          // enveloppée de la <section epub:type> propre à l'EPUB.
          morceaux: [
            `<div class="liminaire liminaire-${escapeXml(bloc.genre)}">${bloc.contenu}</div>`
          ]
        })
        courant = null
        continue
      }
      if (bloc.kind === 'partie') {
        etat.documents.push({
          nom: `partie-${numero(etat.parties)}.xhtml`,
          kind: 'partie',
          titre: bloc.label,
          nav: bloc.label,
          epubType: 'part',
          classe: 'page-partie',
          morceaux: [
            `<p class="partie-label">${escapeXml(bloc.label)}</p>`,
            `<div class="filet"></div>`
          ]
        })
        etat.parties += 1
        courant = null
        continue
      }
      // Ouverture de chapitre : elle ouvre un document, elle ne rejoint jamais
      // le précédent. L'étiquette (titre du document ET libellé de navigation)
      // est « enseigne — titre », ou le titre seul quand l'enseigne est vide.
      const etiquette = bloc.enseigne ? `${bloc.enseigne} — ${bloc.titre}` : bloc.titre
      courant = ouvrirChapitre(etat, etiquette, etiquette)
      // Vidage du tampon dans le document de la PREMIÈRE ouverture du chapitre
      // de base, avant l'en-tête : la planche d'ouverture reste solidaire du
      // chapitre qu'elle ouvre, et le chapitre ne compte qu'une entrée de nav.
      if (!ouvertureVue) {
        courant.morceaux.push(...attente)
        attente.length = 0
        ouvertureVue = true
      }
      const ligne = bloc.enseigne ? `<p class="enseigne">${escapeXml(bloc.enseigne)}</p>` : ''
      // Sous-titre optionnel (la devise du chapitre) : rien n'est émis quand il
      // est absent — pas d'élément vide entre le titre et le filet.
      const sousTitre = bloc.sousTitre
        ? `<p class="sous-titre">${escapeXml(bloc.sousTitre)}</p>`
        : ''
      courant.morceaux.push(
        `<div class="ouverture">${ligne}` +
          `<h2 class="titre-chapitre">${escapeXml(bloc.titre)}</h2>${sousTitre}` +
          `<div class="filet"></div></div>`
      )
      continue
    }

    const contenu = morceaux[i].trim()
    if (contenu === '') continue

    // Ordre important, repris de pdf/html.ts : poserApresScene doit tourner
    // AVANT poserPremier. Un chapitre qui commence par un séparateur de scène a
    // son premier <p> déjà classé « apres-scene » une fois ce premier appel
    // passé ; poserPremier, cherchant un `<p>` nu, ne le retague alors plus.
    let corps = poserApresScene(contenu)
    if (premierSegmentCorps) {
      const avant = corps
      corps = poserPremier(corps)
      // Le drapeau n'est consommé que si la classe a RÉELLEMENT été posée : le
      // premier segment de corps « qui compte » est le premier qui contient du
      // texte. Un segment sans `<p>` nu — une planche pleine page en tête de
      // chapitre — laisse le drapeau au segment suivant, sinon le vrai premier
      // paragraphe perdait son retrait supprimé et ses petites capitales.
      if (corps !== avant) premierSegmentCorps = false
    }

    // Titre de repli : réservé aux chapitres SANS chapterOpening. C'est le
    // <h1> systématique de l'ancien epub.ts qui causait le double titre.
    if (titreRepli !== null && !repliPose) {
      corps = `<h1 class="titre-chapitre">${escapeXml(titreRepli)}</h1>\n${corps}`
      repliPose = true
    }

    // Destination : le document chapitre courant. S'il n'y en a pas d'ouvert,
    // deux cas. Avant la première ouverture d'un chapitre qui en contient une,
    // le segment attend (voir `attente` plus haut). Sinon — chapitre sans
    // ouverture, ou corps suivant une partie ou une liminaire — on ouvre un
    // document sous le titre du chapitre de base.
    if (!courant) {
      if (avecOuverture && !ouvertureVue) {
        attente.push(corps)
        continue
      }
      courant = ouvrirChapitre(etat, titreDefaut, titreDefaut)
    }
    courant.morceaux.push(corps)
  }

  // Défensif : `contientOuverture` a promis une ouverture, le tampon a donc
  // toujours été vidé ci-dessus. Si cette promesse était trahie, on ne perd
  // rien pour autant — le contenu sort dans un document sans entrée de
  // navigation (nav = null), donc sans doubler celle du chapitre. Le titre du
  // chapitre de base sert de <title> : un document XHTML doit en porter un.
  if (attente.length > 0) {
    ouvrirChapitre(etat, titreDefaut, null).morceaux.push(...attente)
  }
}

export function buildEpubDocuments(
  db: Db,
  bookId: number,
  chapterIds: number[],
  mediaDir?: string
): EpubContenu {
  const book = getBook(db, bookId)
  const tous = listChapters(db, bookId)
  const retenus = chapterIds.length === 0 ? tous : tous.filter((c) => chapterIds.includes(c.id))

  const blocs: Bloc[] = []
  const images: string[] = []
  const opts: ExportOptions = {
    layout: makeLayoutRenderer(blocs),
    illustration: makeIllustrationRenderer(mediaDir, images)
  }

  const etat: Etat = {
    documents: [],
    langue: book.language || 'fr',
    chapitres: 0,
    parties: 0,
    genres: {}
  }

  for (const meta of retenus) {
    const full = getChapter(db, meta.id)
    const avecOuverture = contientOuverture(full.contentJson)
    repartir(
      tiptapToXhtml(full.contentJson, opts),
      blocs,
      etat,
      meta.title,
      avecOuverture,
      avecOuverture ? null : meta.title
    )
  }

  return { documents: etat.documents.map(figer), images }
}
