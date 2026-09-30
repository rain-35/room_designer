// Browser-storage wrapper. Every call is guarded: storage can be missing or full
// (private windows, blocked site data), and the app must still run.
(function (RP) {
  'use strict';

  const PREFIX = 'rp:';
  const LAYOUT_PREFIX = PREFIX + 'layout:';
  const memory = {}; // fallback when localStorage is unavailable

  function read(key) {
    try {
      const v = localStorage.getItem(key);
      if (v !== null) return v;
    } catch (e) { /* fall through to memory */ }
    return Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : null;
  }

  function write(key, value) {
    try {
      localStorage.setItem(key, value);
      delete memory[key];
      return true;
    } catch (e) {
      memory[key] = value;
      return false;
    }
  }

  function remove(key) {
    try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
    delete memory[key];
  }

  function keys() {
    const out = Object.keys(memory);
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (out.indexOf(k) === -1) out.push(k);
      }
    } catch (e) { /* ignore */ }
    return out;
  }

  function readJson(key, fallback) {
    const raw = read(key);
    if (raw === null) return fallback;
    try { return JSON.parse(raw); } catch (e) { return fallback; }
  }

  // ---- Layouts ----
  function listLayouts() {
    const out = [];
    keys().forEach(function (k) {
      if (k.indexOf(LAYOUT_PREFIX) !== 0) return;
      const p = readJson(k, null);
      if (p && p.id) out.push({ id: p.id, name: p.name || 'Untitled layout', updatedAt: p.updatedAt || '' });
    });
    out.sort(function (a, b) { return a.updatedAt < b.updatedAt ? 1 : -1; });
    return out;
  }

  function loadLayout(id) {
    return readJson(LAYOUT_PREFIX + id, null);
  }

  // Returns false when the browser refused to store it (kept in memory for this visit only).
  function saveLayout(project) {
    return write(LAYOUT_PREFIX + project.id, JSON.stringify(project));
  }

  function deleteLayout(id) {
    remove(LAYOUT_PREFIX + id);
  }

  function getCurrentId() {
    return read(PREFIX + 'current');
  }

  function setCurrentId(id) {
    write(PREFIX + 'current', id);
  }

  // ---- User library (custom categories and pieces) ----
  function loadUserLibrary() {
    const lib = readJson(PREFIX + 'library', null);
    return lib && typeof lib === 'object' ? { categories: lib.categories || [], items: lib.items || [] } : { categories: [], items: [] };
  }

  function saveUserLibrary(lib) {
    return write(PREFIX + 'library', JSON.stringify(lib));
  }

  // ---- Preferences (grid, snap, warnings) ----
  function loadPrefs() {
    return readJson(PREFIX + 'prefs', {});
  }

  function savePrefs(prefs) {
    write(PREFIX + 'prefs', JSON.stringify(prefs));
  }

  RP.storage = {
    listLayouts: listLayouts,
    loadLayout: loadLayout,
    saveLayout: saveLayout,
    deleteLayout: deleteLayout,
    getCurrentId: getCurrentId,
    setCurrentId: setCurrentId,
    loadUserLibrary: loadUserLibrary,
    saveUserLibrary: saveUserLibrary,
    loadPrefs: loadPrefs,
    savePrefs: savePrefs,
  };
})(window.RP = window.RP || {});
