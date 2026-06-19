import { app, BrowserWindow, ipcMain, session, shell, Menu, nativeImage } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { readFile } from 'node:fs/promises'

if (process.platform === 'linux' && process.env.LUMEN_USE_SANDBOX !== '1' && process.env.NOCTURNE_USE_SANDBOX !== '1') {
  app.commandLine.appendSwitch('no-sandbox')
  app.commandLine.appendSwitch('disable-setuid-sandbox')
}

app.setName('Lumen')

/** Helps iframe / <audio> playback after the user hits Play (Chromium defaults are strict in Electron). */
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** Genius API — remplacez par votre access token : https://genius.com/api-clients */
const GENIUS_API_KEY = 'AvQt0JWQU6Oh1hCM3pGRHmpEKARkLgL2_rVhRItrk38Orvxr0OKwuDiQOdvbmaaO'

const libraryDir = path.join(__dirname, '..', 'library')
const libraryFile = path.join(libraryDir, 'library.json')

function windowIconPath() {
  const candidates = [
    path.join(__dirname, '..', 'build', 'icon.png'),
    path.join(__dirname, '..', 'build', '512x512.png'),
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  return null
}

function distIndex() {
  return path.join(__dirname, '..', 'dist', 'index.html')
}

/** Final path line(s) printed by yt-dlp after the file is in place (stdout; progress stays on stderr). */
const YT_DLP_PRINT_FILEPATH = '--print'
const YT_DLP_PRINT_TEMPLATE = 'after_move:%(filepath)s'

/** @param {string} outDir @param {string} url @param {string} [format] */
function ytdlpArgs(outDir, url, format) {
  const outTmpl = path.join(outDir, '%(title)s [%(id)s].%(ext)s')
  const isPlaylist = url.includes('list=') || url.includes('/sets/') || url.includes('playlist')
  const common = ['--no-mtime', isPlaylist ? '--yes-playlist' : '--no-playlist', '-o', outTmpl, YT_DLP_PRINT_FILEPATH, YT_DLP_PRINT_TEMPLATE]
  const f = (format || 'best').toLowerCase()
  if (f === 'mp3') {
    return [...common, '-x', '--audio-format', 'mp3', '--audio-quality', '0', url]
  }
  if (f === 'm4a') {
    return [...common, '-x', '--audio-format', 'm4a', url]
  }
  return [...common, '-f', 'bestaudio/best', url]
}

/**
 * @param {string} childPath
 * @param {string} parentPath
 */
function isPathInside(childPath, parentPath) {
  const rel = path.relative(parentPath, childPath)
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel))
}

/**
 * yt-dlp sort souvent les fichiers sous la forme « Titre [id11].ext » pour YouTube.
 */
function displayTitleFromImportBasename(baseWithoutExt) {
  const stripped = baseWithoutExt.replace(/ \[[A-Za-z0-9_-]{11}\]$/, '').trim()
  return stripped || baseWithoutExt
}

/**
 * @param {string} ext
 */
function mimeFromExt(ext) {
  const e = ext.toLowerCase()
  const map = {
    '.mp3': 'audio/mpeg',
    '.m4a': 'audio/mp4',
    '.mp4': 'video/mp4',
    '.webm': 'audio/webm',
    '.opus': 'audio/opus',
    '.ogg': 'audio/ogg',
    '.flac': 'audio/flac',
    '.wav': 'audio/wav',
  }
  return map[e] || 'application/octet-stream'
}

/**
 * @param {{ url: string; format?: string }} payload
 * @returns {Promise<
 *   | { ok: true; downloadsDir: string; outputPath: string }
 *   | { ok: false; code: string; message: string }
 * >}
 */
function downloadWithYtDlp(payload) {
  const { url, format } = payload
  if (!url || typeof url !== 'string') {
    return Promise.resolve({ ok: false, code: 'INVALID', message: 'URL manquante.' })
  }
  const trimmed = url.trim()
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    return Promise.resolve({ ok: false, code: 'INVALID', message: 'URL invalide.' })
  }
  const downloadsDir = app.getPath('downloads')
  const args = ytdlpArgs(downloadsDir, trimmed, format)

  return new Promise((resolve) => {
    const child = spawn('yt-dlp', args, {
      windowsHide: true,
      shell: false,
      env: { ...process.env },
    })
    let stderr = ''
    let stdout = ''
    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', (err) => {
      const code = err && 'code' in err && err.code === 'ENOENT' ? 'YTDLP_MISSING' : 'SPAWN'
      const message =
        code === 'YTDLP_MISSING'
          ? "L'outil yt-dlp est introuvable dans le PATH. Installez-le (ex. Debian/Ubuntu : sudo apt install yt-dlp) ou https://github.com/yt-dlp/yt-dlp/releases"
          : (err && err.message) || String(err)
      resolve({ ok: false, code, message })
    })
    child.on('close', (exitCode) => {
      if (exitCode === 0) {
        const lines = stdout
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean)
        
        const outputPaths = []
        const resolvedDownloads = path.resolve(downloadsDir)
        
        for (const line of lines) {
          if (line) {
            const resolvedLine = path.resolve(line)
            if (
              fs.existsSync(resolvedLine) &&
              fs.statSync(resolvedLine).isFile() &&
              isPathInside(resolvedLine, resolvedDownloads)
            ) {
              if (!outputPaths.includes(resolvedLine)) {
                outputPaths.push(resolvedLine)
              }
            }
          }
        }
        
        if (outputPaths.length > 0) {
          resolve({
            ok: true,
            downloadsDir: resolvedDownloads,
            outputPath: outputPaths[outputPaths.length - 1],
            outputPaths,
          })
          return
        }
        resolve({
          ok: false,
          code: 'YTDLP_NO_PATH',
          message:
            'yt-dlp a réussi mais le chemin du fichier n’a pas été reconnu. Mettez à jour yt-dlp, ou vérifiez le dossier Téléchargements.',
        })
        return
      }
      const tail = stderr.trim().slice(-4000) || `yt-dlp a quitté avec le code ${exitCode}.`
      resolve({ ok: false, code: 'YTDLP_FAILED', message: tail })
    })
  })
}

/**
 * @param {string} html
 */
function stripHtml(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .trim()
}

/**
 * @param {string} url
 */
async function scrapeGeniusLyrics(url) {
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Lumen/1.0 (music app)' },
    })
    if (!resp.ok) return null
    const html = await resp.text()
    const containers = []
    const regex = /data-lyrics-container="true"[^>]*>([\s\S]*?)<\/div>/gi
    let match
    while ((match = regex.exec(html)) !== null) {
      containers.push(stripHtml(match[1]))
    }
    if (containers.length) {
      return containers.filter(Boolean).join('\n\n').trim()
    }
    const classRegex = /class="[^"]*Lyrics__Container[^"]*"[^>]*>([\s\S]*?)<\/div>/gi
    while ((match = classRegex.exec(html)) !== null) {
      containers.push(stripHtml(match[1]))
    }
    return containers.length ? containers.filter(Boolean).join('\n\n').trim() : null
  } catch {
    return null
  }
}

/**
 * @param {string} query
 */
async function searchGeniusLyrics(query) {
  const trimmed = query.trim()
  if (!trimmed) {
    return { ok: false, code: 'INVALID', message: 'Requête vide.' }
  }
  if (!GENIUS_API_KEY || GENIUS_API_KEY === 'YOUR_GENIUS_API_KEY_HERE') {
    return { ok: false, code: 'NO_KEY', message: 'Clé Genius non configurée dans electron/main.mjs.' }
  }

  const searchUrl = `https://api.genius.com/search?q=${encodeURIComponent(trimmed)}`
  const searchResp = await fetch(searchUrl, {
    headers: { Authorization: `Bearer ${GENIUS_API_KEY}` },
  })
  if (!searchResp.ok) {
    return { ok: false, code: 'API_ERROR', message: `Genius API: ${searchResp.status}` }
  }

  const searchData = await searchResp.json()
  const hits = searchData?.response?.hits
  if (!hits?.length) {
    return { ok: false, code: 'NOT_FOUND', message: 'Aucun résultat Genius.' }
  }

  const song = hits[0].result
  const lyrics = song.url ? await scrapeGeniusLyrics(song.url) : null

  return {
    ok: true,
    title: song.title,
    artist: song.primary_artist?.name || 'Unknown',
    url: song.url,
    image: song.song_art_image_url,
    lyrics,
    source: 'genius-api',
  }
}

function ensureLibraryDir() {
  if (!fs.existsSync(libraryDir)) {
    fs.mkdirSync(libraryDir, { recursive: true })
  }
}

function defaultLibrary() {
  return { version: 1, updatedAt: new Date().toISOString(), artists: [] }
}

function readLibrary() {
  ensureLibraryDir()
  if (!fs.existsSync(libraryFile)) {
    const lib = defaultLibrary()
    fs.writeFileSync(libraryFile, JSON.stringify(lib, null, 2), 'utf8')
    return lib
  }
  const raw = fs.readFileSync(libraryFile, 'utf8')
  const parsed = JSON.parse(raw)
  if (!parsed || typeof parsed !== 'object') return defaultLibrary()
  if (!Array.isArray(parsed.artists)) parsed.artists = []
  return parsed
}

/**
 * @param {object} data
 */
function writeLibrary(data) {
  ensureLibraryDir()
  const next = { ...data, updatedAt: new Date().toISOString() }
  fs.writeFileSync(libraryFile, JSON.stringify(next, null, 2), 'utf8')
  return next
}

ipcMain.handle('lumen:search-lyrics', async (_event, payload) => {
  try {
    const query = payload && typeof payload === 'object' && 'query' in payload ? payload.query : ''
    return await searchGeniusLyrics(typeof query === 'string' ? query : '')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, code: 'FAILED', message }
  }
})

ipcMain.handle('lumen:library-read', () => {
  try {
    return { ok: true, library: readLibrary(), libraryPath: libraryFile }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, message }
  }
})

ipcMain.handle('lumen:library-save', (_event, payload) => {
  try {
    if (!payload || typeof payload !== 'object' || !payload.library || typeof payload.library !== 'object') {
      return { ok: false, message: 'Données de bibliothèque invalides.' }
    }
    const library = writeLibrary(payload.library)
    return { ok: true, library, libraryPath: libraryFile }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, message }
  }
})

ipcMain.handle('lumen:download-track', (_event, payload) => downloadWithYtDlp(payload))

ipcMain.handle('lumen:import-downloaded-file', async (_event, payload) => {
  try {
    const raw = payload && typeof payload === 'object' && 'path' in payload ? payload.path : null
    if (!raw || typeof raw !== 'string') {
      return { ok: false, code: 'INVALID', message: 'Chemin invalide.' }
    }
    const requested = path.resolve(raw)
    const downloads = path.resolve(app.getPath('downloads'))
    if (!isPathInside(requested, downloads)) {
      return {
        ok: false,
        code: 'PATH_FORBIDDEN',
        message: 'Seuls les fichiers du dossier Téléchargements peuvent être importés.',
      }
    }
    if (!fs.existsSync(requested) || !fs.statSync(requested).isFile()) {
      return { ok: false, code: 'NOT_FOUND', message: 'Fichier introuvable.' }
    }
    const ext = path.extname(requested)
    const mimeType = mimeFromExt(ext)
    const title = displayTitleFromImportBasename(path.basename(requested, ext))
    const buffer = await readFile(requested)
    return {
      ok: true,
      buffer,
      mimeType,
      title,
      fileName: path.basename(requested),
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, code: 'READ_FAILED', message }
  }
})

ipcMain.handle('lumen:show-item-in-folder', (_event, filePath) => {
  if (typeof filePath !== 'string' || !filePath.trim()) return
  const resolved = path.resolve(filePath.trim())
  const downloads = path.resolve(app.getPath('downloads'))
  if (!isPathInside(resolved, downloads)) return
  shell.showItemInFolder(resolved)
})

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 720,
    minHeight: 520,
    title: 'Lumen',
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  })

  const iconPath = windowIconPath()
  if (iconPath) {
    try {
      const img = nativeImage.createFromPath(iconPath)
      if (!img.isEmpty()) win.setIcon(img)
    } catch {
      /* ignore */
    }
  }

  const devUrl = process.env.ELECTRON_START_URL
  if (devUrl) {
    void win.loadURL(devUrl)
  } else {
    void win.loadFile(distIndex())
  }
}

app.whenReady().then(() => {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null)
  }
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    if (permission === 'media' || permission === 'autoplay') {
      callback(true)
      return
    }
    callback(false)
  })
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
