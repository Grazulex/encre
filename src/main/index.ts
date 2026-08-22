import { app, shell, BrowserWindow, ipcMain, protocol, net } from 'electron'
import { join, normalize, sep } from 'path'
import { pathToFileURL } from 'url'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { openDb } from './db/connection'
import { createApi } from './api'
import { registerIpc } from './ipc'
import { backupDatabase, pruneBackups, shouldBackup } from './backup'

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

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
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
      mainWindow.close()
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
app.whenReady().then(() => {
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

  // Daily backup with 24h check
  const performBackup = (): void => {
    if (shouldBackup(backupsDir, new Date())) {
      backupDatabase(db, backupsDir, new Date())
        .then((path) => {
          console.log(`Backup créé: ${path}`)
          pruneBackups(backupsDir, new Date())
        })
        .catch(console.error)
    }
  }

  performBackup()

  // Check every 6 hours
  setInterval(performBackup, 6 * 60 * 60 * 1000)

  registerIpc(createApi(db))

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
