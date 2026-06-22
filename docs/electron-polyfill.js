(function () {
  if (window.lumenElectron || window.nocturneElectron) return;

  const LIBRARY_KEY = "lumen-library-v1";

  function defaultLibrary() {
    return { version: 1, updatedAt: new Date().toISOString(), artists: [] };
  }

  function readStoredLibrary() {
    try {
      const raw = localStorage.getItem(LIBRARY_KEY);
      if (!raw) return defaultLibrary();
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return defaultLibrary();
      if (!Array.isArray(parsed.artists)) parsed.artists = [];
      return parsed;
    } catch {
      return defaultLibrary();
    }
  }

  function writeStoredLibrary(library) {
    const next = { ...library, updatedAt: new Date().toISOString() };
    localStorage.setItem(LIBRARY_KEY, JSON.stringify(next));
    return next;
  }

  const api = {
    isElectron: false,

    readLibrary() {
      return Promise.resolve({ ok: true, library: readStoredLibrary() });
    },

    saveLibrary(opts) {
      try {
        const library = writeStoredLibrary(opts && opts.library ? opts.library : defaultLibrary());
        return Promise.resolve({ ok: true, library });
      } catch (err) {
        return Promise.resolve({
          ok: false,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },

    downloadTrack() {
      return Promise.resolve({
        ok: false,
        code: "NO_BRIDGE",
        message: "Téléchargement indisponible dans le navigateur.",
      });
    },

    importDownloadedFile() {
      return Promise.resolve({
        ok: false,
        code: "NO_BRIDGE",
        message: "Import indisponible dans le navigateur.",
      });
    },

    showItemInFolder() {
      return Promise.resolve();
    },

    searchLyrics() {
      return Promise.resolve({
        ok: false,
        code: "NO_BRIDGE",
        message: "Recherche Genius indisponible dans le navigateur.",
      });
    },
  };

  window.lumenElectron = api;
  window.nocturneElectron = api;
})();
