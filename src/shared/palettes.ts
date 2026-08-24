// Palette du thème Encre : les 4 saveurs Catppuccin (Latte / Frappé /
// Macchiato / Mocha) + accents configurables + couleurs de statut.
//
// Ce module est la SEULE source de vérité des couleurs appliquées au runtime
// (store theme.ts) ; theme.css ne garde que les valeurs Latte/Frappé comme
// fallback et pour l'accessibilité mesurée « à froid ». Les mêmes contraintes
// AA que theme.css s'appliquent ici : `text`/`accent`/`status` sont des
// couleurs de TEXTE, donc chaque valeur passe 4,5:1 sur `bg` ET `bgPanel` de
// sa saveur — vérifié par palettes.test.ts (et vérifié à la main pour les
// valeurs Latte, les seules qui s'écartent du brut Catppuccin : ses accents
// sont calibrés remplissage, pas texte).
export type ThemeSaveur = 'latte' | 'frappe' | 'macchiato' | 'mocha'
export type ThemeScope = ThemeSaveur | 'system'
export type AccentScope = 'lavender' | 'blue' | 'teal' | 'mauve' | 'peach' | 'green'
export type StatusScope = 'reserve' | 'en_cours' | 'termine' | 'archive'

export interface CouleursBase {
  bg: string
  bgPanel: string
  fg: string
  fgMuted: string
  border: string
  danger: string
}

// `brut` : couleur Catppuccin canonique — sert d'aperçu (swatch) dans le
// sélecteur d'accent. `texte` : valeur AA utilisable comme couleur de texte,
// = brut sur les saveurs sombres, assombrie sur Latte.
export interface AccentCouleurs {
  brut: string
  texte: string
}

const ACCENTS_BRUTS: Record<AccentScope, Record<ThemeSaveur, string>> = {
  lavender: { latte: '#7287fd', frappe: '#babbf1', macchiato: '#b7bdf8', mocha: '#b4befe' },
  blue: { latte: '#1e66f5', frappe: '#8caaee', macchiato: '#8aadf4', mocha: '#89b4fa' },
  teal: { latte: '#179299', frappe: '#81c8be', macchiato: '#8bd5ca', mocha: '#94e2d5' },
  mauve: { latte: '#8839ef', frappe: '#ca9ee6', macchiato: '#c6a0f6', mocha: '#cba6f7' },
  peach: { latte: '#fe640b', frappe: '#ef9f76', macchiato: '#f5a97f', mocha: '#fab387' },
  green: { latte: '#40a02b', frappe: '#a6d189', macchiato: '#a6da95', mocha: '#a6e3a1' }
}

// Latte : bruts assombris à teinte constante jusqu'au seuil AA (mesuré, cf.
// palettes.test.ts — calcul identique à celui qui a corrigé --accent dans
// theme.css). Les saveurs sombres passent AA avec leurs bruts : pas de table.
const ACCENTS_LATTE_TEXTE: Record<AccentScope, string> = {
  lavender: '#4c5ec9', // valeur historique de --accent conservée (4,95:1 sur --bg)
  blue: '#1c5fe4',
  teal: '#127479',
  mauve: '#8738ed',
  peach: '#b34608',
  green: '#307820'
}

export const SAVEURS: Record<ThemeSaveur, CouleursBase> = {
  latte: {
    bg: '#eff1f5',
    bgPanel: '#e6e9ef',
    fg: '#4c4f69',
    fgMuted: '#64667b', // subtext0 assombri (le brut ne rend que 4,06:1 sur --bg-panel)
    border: '#ccd0da',
    danger: '#ce0f38' // red assombri (le brut rend 4,46:1)
  },
  frappe: {
    bg: '#303446',
    bgPanel: '#292c3c',
    fg: '#c6d0f5',
    fgMuted: '#a5adce',
    border: '#414559',
    danger: '#e78284'
  },
  macchiato: {
    bg: '#24273a',
    bgPanel: '#1e2030',
    fg: '#cad3f5',
    fgMuted: '#a5adcb',
    border: '#363a4f',
    danger: '#ed8796'
  },
  mocha: {
    bg: '#1e1e2e',
    bgPanel: '#181825',
    fg: '#cdd6f4',
    fgMuted: '#a6adc8',
    border: '#313244',
    danger: '#f38ba8'
  }
}

export function accentPour(saveur: ThemeSaveur, accent: AccentScope): AccentCouleurs {
  return {
    brut: ACCENTS_BRUTS[accent][saveur],
    texte: saveur === 'latte' ? ACCENTS_LATTE_TEXTE[accent] : ACCENTS_BRUTS[accent][saveur]
  }
}

// Pastilles de statut en bibliothèque : la même couleur de texte que
// l'accent homonyme (Archive reprend fgMuted) — cohérentes avec le reste,
// AA vérifié pour un usage texte comme les autres.
export function statutPour(saveur: ThemeSaveur, statut: StatusScope): string {
  if (statut === 'archive') return SAVEURS[saveur].fgMuted
  const map: Record<Exclude<StatusScope, 'archive'>, AccentScope> = {
    reserve: 'mauve',
    en_cours: 'blue',
    termine: 'green'
  }
  return accentPour(saveur, map[statut as Exclude<StatusScope, 'archive'>]).texte
}

export const THEME_LABELS: Record<ThemeScope, string> = {
  system: 'Système',
  latte: 'Latte',
  frappe: 'Frappé',
  macchiato: 'Macchiato',
  mocha: 'Mocha'
}

export const ACCENT_LABELS: Record<AccentScope, string> = {
  lavender: 'Lavande',
  blue: 'Bleu',
  teal: 'Sarcelle',
  mauve: 'Mauve',
  peach: 'Pêche',
  green: 'Vert'
}
