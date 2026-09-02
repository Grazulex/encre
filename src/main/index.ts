import { app, shell, BrowserWindow, ipcMain, protocol, net } from 'electron'
import { join, normalize, sep } from 'path'
import { pathToFileURL } from 'url'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { openDb } from './db/connection'
import { createApi } from './api'
import { registerIpc } from './ipc'
import { backupDatabase, pruneBackups, shouldBackup } from './backup/local'
import { createBackupService } from './backup/sync'
import { lancerExport, parseExportArgs } from './cli'

// Protocole privilégié `encre-media` : seule voie d'affichage des images
// (couvertures de livres, photos de fiches personnages/lieux) dans le
// renderer — la CSP (index.html) n'autorise ni file:// ni http(s):// dans
// img-src, uniquement 'self', data: et encre-media:. Sert EXCLUSIVEMENT les
// fichiers du dossier media de userData : on normalise le chemin demandé et
// on vérifie qu'il reste préfixé par ce dossier avant de le lire, pour
// qu'une requête du type encre-media://../../etc/passwd ne puisse jamais en
// sortir. Pas d'enregistrement via protocol.registerSchemesAsPrivileged
// (scheme non "standard") : le nom de fichier demandé (l'« hôte » de l'URL)
// garde ainsi sa casse d'origine, au lieu d'être passé en minuscules par le
// parseur d'URL WHATWG comme le ferait un schéma "standard".
function registerMediaProtocol(mediaDir: string): void {
  const PREFIX = 'encre-media://'
  protocol.handle('encre-media', (request) => {
    const raw = request.url.startsWith(PREFIX) ? request.url.slice(PREFIX.length) : ''
    const name = decodeURIComponent(raw.split(/[?#]/)[0])
    const filePath = normalize(join(mediaDir, name))
    if (filePath !== mediaDir && !filePath.startsWith(mediaDir + sep)) {
      return new Response('Chemin refusé', { status: 403 })
    }
    return net.fetch(pathToFileURL(filePath).toString())
  })
}

// Vrai pendant toute la séquence de quit (Cmd+Q, menu Quitter, arrêt système).
// Le handler `close` ci-dessous appelle `event.preventDefault()` pour laisser le
// renderer flusher : or ça n'annule pas seulement la fermeture de la fenêtre, ça
// annule le quit *entier*. Sans ce drapeau, le flush se terminait par un simple
// `mainWindow.close()` et l'app restait vivante (macOS ne quitte pas sur
// `window-all-closed`) — il fallait refaire Cmd+Q une seconde fois.
let quitting = false
app.on('before-quit', () => {
  quitting = true
})

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    // Audit UI/UX, proposition #4 : 900×670 était le défaut du template
    // electron-vite, jamais ajusté — avec le panneau Claude ouvert
    // (260px 1fr 360px), il ne restait plus qu'environ 230px de texte
    // utilisable pour l'éditeur. minWidth/minHeight empêchent de redescendre
    // sous ce seuil en redimensionnant manuellement.
    width: 1280,
    height: 800,
    minWidth: 980,
    minHeight: 620,
    show: false,
    autoHideMenuBar: true,
    // Proposition #5 : barre de titre fondue dans l'aside --bg-panel plutôt
    // que la barre standard grise ("app web dans un cadre"). Pas de
    // vibrancy (coût/risque > gain sur des fonds opaques papier/encre) —
    // seul le style des feux tricolores change, ignoré sans effet sur les
    // plateformes non macOS.
    titleBarStyle: 'hiddenInset',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // Poignée de main de fermeture : on laisse le renderer flusher (sauvegardes en
  // attente) avant de fermer réellement la fenêtre, avec un filet de 1,5 s pour
  // ne jamais bloquer la fermeture si le renderer ne répond pas (ou pas encore,
  // cf. Task 7).
  let quitFlushDone = false
  mainWindow.on('close', (event) => {
    if (quitFlushDone) return
    event.preventDefault()
    const finish = (): void => {
      if (quitFlushDone) return
      quitFlushDone = true
      clearTimeout(timer)
      ipcMain.removeListener('app:flush-done', finish)
      // Reprend la séquence annulée par le preventDefault, sinon on ne ferait
      // que refermer la fenêtre en laissant le process debout.
      if (quitting) app.quit()
      else mainWindow.close()
    }
    ipcMain.once('app:flush-done', finish)
    mainWindow.webContents.send('app:request-flush')
    const timer = setTimeout(finish, 1500)
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  // Mode export sans fenêtre (voir cli.ts) : `Encre --export …`. On lit la
  // même base que l'interface, on exporte, on quitte — sans protocole media
  // (le PDF référence ses images en file://), sans sauvegarde, sans IPC. Un
  // argument mal formé ou un livre en échec donne un code de sortie non nul.
  let exportArgs: ReturnType<typeof parseExportArgs> = null
  try {
    exportArgs = parseExportArgs(process.argv)
  } catch (err) {
    console.error(`encre --export : ${err instanceof Error ? err.message : String(err)}`)
    app.exit(2)
    return
  }
  if (exportArgs) {
    const db = openDb(join(app.getPath('userData'), 'library.db'))
    const resultat = await lancerExport(db, join(app.getPath('userData'), 'media'), exportArgs, console.log)
    console.log(`${resultat.ecrits.length} fichier(s) écrit(s), ${resultat.erreurs.length} échec(s)`)
    app.exit(resultat.erreurs.length === 0 ? 0 : 1)
    return
  }

  // Set app user model id for windows
  electronApp.setAppUserModelId('be.grazulex.encre')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerMediaProtocol(join(app.getPath('userData'), 'media'))

  const db = openDb(join(app.getPath('userData'), 'library.db'))
  const backupsDir = join(app.getPath('userData'), 'backups')

  const backupService = createBackupService(db, {
    repoDir: join(app.getPath('userData'), 'backup-repo'),
    mediaDir: join(app.getPath('userData'), 'media'),
    backupsDir,
    keyPath: join(app.getPath('userData'), 'backup-key'),
    statePath: join(app.getPath('userData'), 'backup-state.json'),
    remoteUrl: 'git@github.com:Grazulex/encre_backup.git'
  })

  // Daily backup with 24h check
  const performBackup = (): void => {
    // try/catch : shouldBackup/statSync peut lever en cas de course sur les
    // fichiers de backup (suppression concurrente) — jamais faire planter le
    // process main pour ça.
    try {
      if (shouldBackup(backupsDir, new Date())) {
        backupDatabase(db, backupsDir, new Date())
          .then((path) => {
            console.log(`Backup créé: ${path}`)
            pruneBackups(backupsDir, new Date())
            // Sauvegarde distante : même tranche de 24 h que le backup local.
            // Le service enregistre lui-même ses erreurs dans son état ; on ne
            // laisse jamais un échec réseau remonter jusqu'ici.
            return backupService.runNow().catch((err) => console.error(err))
          })
          .catch(console.error)
      }
    } catch (err) {
      console.error(err)
    }
  }

  performBackup()

  // Check every 6 hours
  setInterval(performBackup, 6 * 60 * 60 * 1000)

  registerIpc(createApi(db, { backup: backupService }))

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
