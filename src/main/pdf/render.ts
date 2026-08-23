// Rendu PDF : paged.js compose le flux en pages réelles dans une fenêtre cachée,
// puis printToPDF imprime ces pages telles quelles. Chromium n'implémente aucune
// des fonctions CSS Paged Media dont dépend une maquette de livre (boîtes de marge,
// string-set, target-counter, break-before: right) ; paged.js les fournit côté page.
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// Le polyfill est copié à côté du HTML temporaire plutôt que chargé depuis
// node_modules : le chemin reste un simple fichier voisin, valable aussi bien en
// développement que dans une application empaquetée (readFileSync sait lire dans
// app.asar, un <script src> pointant dans l'archive serait plus fragile).
const POLYFILL = 'node_modules/pagedjs/dist/paged.polyfill.js'

// Au-delà, on considère la pagination perdue plutôt que de laisser une fenêtre
// cachée ouverte indéfiniment.
const DELAI_MAX_MS = 120_000

export async function renderHtmlToPdf(html: string): Promise<Buffer> {
  const { app, BrowserWindow } = await import('electron')

  const source = join(app.getAppPath(), POLYFILL)
  if (!existsSync(source)) {
    throw new Error(`paged.js introuvable (${source}) — impossible de composer le PDF`)
  }
  const polyfill = readFileSync(source)

  const tmpDir = mkdtempSync(join(tmpdir(), 'encre-pdf-'))
  try {
    const htmlPath = join(tmpDir, 'livre.html')
    writeFileSync(htmlPath, html)
    writeFileSync(join(tmpDir, 'paged.polyfill.js'), polyfill)

    let win: InstanceType<typeof BrowserWindow> | null = null
    try {
      win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
      await win.loadFile(htmlPath)
      await win.webContents.executeJavaScript(
        `new Promise((resolve, reject) => {
          const echec = setTimeout(() => reject(new Error('pagination interrompue')), ${DELAI_MAX_MS});
          window.PagedConfig = { auto: false };
          const s = document.createElement('script');
          s.src = 'paged.polyfill.js';
          s.onload = async () => {
            try {
              const flow = await new window.Paged.Previewer().preview();
              await document.fonts.ready;
              requestAnimationFrame(() => requestAnimationFrame(() => {
                clearTimeout(echec);
                resolve(flow.total);
              }));
            } catch (e) { clearTimeout(echec); reject(e); }
          };
          s.onerror = () => { clearTimeout(echec); reject(new Error('chargement de paged.js impossible')); };
          document.head.appendChild(s);
        })`,
        true
      )
      // margins à zéro et preferCSSPageSize : paged.js porte lui-même la taille de
      // page et les marges alternées ; laisser Chromium en ajouter les doublerait.
      return await win.webContents.printToPDF({
        preferCSSPageSize: true,
        printBackground: true,
        margins: { top: 0, bottom: 0, left: 0, right: 0 }
      })
    } finally {
      win?.close()
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
}
