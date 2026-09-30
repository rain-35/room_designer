// Browser-storage wrapper (the local cache). Every call is guarded: storage can be
// missing or full, and the app must still run.
// Layouts, the user library and sync bookkeeping are kept per signed-in user, so one
// account can never see another's cached data. With nobody signed in (scope null)
// nothing is readable or writable.
(function (RP) {
  'use strict';

  const PREFIX = 'rp:';
  const memory = {}; // fallback when localStorage is unavailable
  let scope = null;  // the signed-in user's id

  function ukey(name) { return PREFIX + 'u:' + scope + ':' + name; }

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

  function setScope(userId) { scope = userId || null; }
  function getScope() { return scope; }

  // ---- Sync bookkeeping ----
  // synced:  layout id -> updatedAt (ms) both sides agreed on at the last sync
  // deleted: layout id -> ISO time it was deleted here, still to be told to the cloud
  // libDirty: the user library changed here and has not been pushed yet
  function loadSync() {
    const m = scope ? readJson(ukey('sync'), null) : null;
    return { synced: (m && m.synced) || {}, deleted: (m && m.deleted) || {}, libDirty: !!(m && m.libDirty) };
  }

  function saveSync(meta) {
    if (scope) write(ukey('sync'), JSON.stringify(meta));
  }

  // ---- Layouts ----
  function listLayouts() {
    if (!scope) return [];
    const prefix = ukey('layout:');
    const out = [];
    keys().forEach(function (k) {
      if (k.indexOf(prefix) !== 0) return;
      const p = readJson(k, null);
      if (p && p.id) out.push({ id: p.id, name: p.name || 'Untitled layout', updatedAt: p.updatedAt || '' });
    });
    out.sort(function (a, b) { return a.updatedAt < b.updatedAt ? 1 : -1; });
    return out;
  }

  function loadLayout(id) {
    return scope ? readJson(ukey('layout:' + id), null) : null;
  }

  // Returns false when the browser refused to store it (kept in memory for this visit only).
  function saveLayout(project) {
    return scope ? write(ukey('layout:' + project.id), JSON.stringify(project)) : false;
  }

  // Deleting a layout that was synced before leaves a note so the cloud copy is deleted too.
  // The note keeps the version both sides last agreed on, to tell if the cloud copy changed since.
  function deleteLayout(id) {
    if (!scope) return;
    remove(ukey('layout:' + id));
    const meta = loadSync();
    if (meta.synced[id] !== undefined) {
      meta.deleted[id] = { at: new Date().toISOString(), synced: meta.synced[id] };
      delete meta.synced[id];
      saveSync(meta);
    }
  }

  // Remove a layout without leaving a deletion note (it was removed because the cloud said so).
  function dropLayoutQuietly(id) {
    if (!scope) return;
    remove(ukey('layout:' + id));
    const meta = loadSync();
    delete meta.synced[id];
    saveSync(meta);
  }

  function getCurrentId() { return scope ? read(ukey('current')) : null; }
  function setCurrentId(id) { if (scope) write(ukey('current'), id); }

  // ---- User library (custom categories and pieces) ----
  function loadUserLibrary() {
    const lib = scope ? readJson(ukey('library'), null) : null;
    return lib && typeof lib === 'object'
      ? { categories: lib.categories || [], items: lib.items || [], deleted: lib.deleted || {} }
      : { categories: [], items: [], deleted: {} };
  }

  function saveUserLibrary(lib) {
    return scope ? write(ukey('library'), JSON.stringify(lib)) : false;
  }

  // ---- Preferences (grid, snap, warnings): per device, not per user ----
  function loadPrefs() { return readJson(PREFIX + 'prefs', {}); }
  function savePrefs(prefs) { write(PREFIX + 'prefs', JSON.stringify(prefs)); }

  // ---- Who signed in last on this device (lets the app open offline) ----
  function getLastUser() { return readJson(PREFIX + 'lastUser', null); }
  function setLastUser(u) { write(PREFIX + 'lastUser', JSON.stringify({ id: u.id, email: u.email || '' })); }
  function clearLastUser() { remove(PREFIX + 'lastUser'); }

  // Remove everything this device cached for one user (used on sign-out).
  function clearUserData(userId) {
    const prefix = PREFIX + 'u:' + userId + ':';
    keys().forEach(function (k) { if (k.indexOf(prefix) === 0) remove(k); });
  }

  // Before accounts existed, data was stored unscoped. The first account to sign in adopts it.
  function adoptLegacy() {
    if (!scope) return 0;
    let moved = 0;
    keys().forEach(function (k) {
      if (k.indexOf(PREFIX + 'layout:') === 0) {
        write(ukey('layout:' + k.slice((PREFIX + 'layout:').length)), read(k));
        remove(k);
        moved++;
      }
    });
    const lib = read(PREFIX + 'library');
    if (lib !== null) {
      if (read(ukey('library')) === null) write(ukey('library'), lib);
      remove(PREFIX + 'library');
    }
    const cur = read(PREFIX + 'current');
    if (cur !== null) {
      if (read(ukey('current')) === null) write(ukey('current'), cur);
      remove(PREFIX + 'current');
    }
    return moved;
  }

  RP.storage = {
    setScope: setScope,
    getScope: getScope,
    loadSync: loadSync,
    saveSync: saveSync,
    listLayouts: listLayouts,
    loadLayout: loadLayout,
    saveLayout: saveLayout,
    deleteLayout: deleteLayout,
    dropLayoutQuietly: dropLayoutQuietly,
    getCurrentId: getCurrentId,
    setCurrentId: setCurrentId,
    loadUserLibrary: loadUserLibrary,
    saveUserLibrary: saveUserLibrary,
    loadPrefs: loadPrefs,
    savePrefs: savePrefs,
    getLastUser: getLastUser,
    setLastUser: setLastUser,
    clearLastUser: clearLastUser,
    clearUserData: clearUserData,
    adoptLegacy: adoptLegacy,
  };
})(window.RP = window.RP || {});
