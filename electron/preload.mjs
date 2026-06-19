import { contextBridge, ipcRenderer } from 'electron'

const api = {
  isElectron: true,
  /**
   * @param {{ url: string; format?: string }} opts
   */
  downloadTrack: (opts) => ipcRenderer.invoke('lumen:download-track', opts),
  /**
   * @param {{ path: string }} opts
   */
  importDownloadedFile: (opts) => ipcRenderer.invoke('lumen:import-downloaded-file', opts),
  showItemInFolder: (filePath) => ipcRenderer.invoke('lumen:show-item-in-folder', filePath),
  /**
   * @param {{ query: string }} opts
   */
  searchLyrics: (opts) => ipcRenderer.invoke('lumen:search-lyrics', opts),
  readLibrary: () => ipcRenderer.invoke('lumen:library-read'),
  /**
   * @param {{ library: object }} opts
   */
  saveLibrary: (opts) => ipcRenderer.invoke('lumen:library-save', opts),
}

contextBridge.exposeInMainWorld('lumenElectron', api)
contextBridge.exposeInMainWorld('nocturneElectron', api)
