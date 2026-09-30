// Wires the toolbar to the state, manages layouts, autosave and cloud sync, and starts the
// app once someone has signed in.
(function (RP) {
  'use strict';

  const U = RP.units;
  const S = RP.state;
  const MIN_ROOM_IN = 12;
  const MAX_ROOM_IN = 6000;
  const AUTOSAVE_MS = 400;
  const FIRST_SYNC_WAIT_MS = 8000;

  const $ = function (id) { return document.getElementById(id); };
  const svg = $('canvas');
  const areaEl = $('area');
  const gridSelect = $('grid-size');
  const unitsBtn = $('units-toggle');
  const themeBtn = $('theme-toggle');
  const nameInput = $('project-name');
  const undoBtn = $('undo-btn');
  const redoBtn = $('redo-btn');
  const saveStatus = $('save-status');

  // Saved preferences (grid, snap, warnings) are per device and hold no layout data.
  const prefs = RP.storage.loadPrefs();
  if ([1, 6, 12].indexOf(prefs.gridSize) !== -1) S.get().ui.gridSize = prefs.gridSize;
  if (typeof prefs.snap === 'boolean') S.get().ui.snap = prefs.snap;
  if (typeof prefs.warnings === 'boolean') S.get().ui.warnings = prefs.warnings;

  RP.render.init(svg);
  const view = RP.input.init(svg);
  RP.interact.init(svg, view);
  RP.panel.init();
  RP.dialogs.init();
  RP.authscreen.init();

  let active = false; // true only while someone is signed in and their data is loaded

  function room() { return S.get().project.rooms[0]; }
  function units() { return S.get().project.units; }

  // ---- Room size (toolbar and properties panel) ----
  function setRoomDimension(key, inches) {
    S.update(function (p) {
      p.rooms[0][key] = inches;
      RP.openings.clampAll(p.rooms[0]); // doors and windows stay on the (now different) walls
    });
    view.fit();
  }
  RP.props.init({ setRoomDimension: setRoomDimension, minRoom: MIN_ROOM_IN, maxRoom: MAX_ROOM_IN });

  function roomBox(id, key) {
    return RP.fields.bindLength($(id), {
      get: function () { return room()[key]; },
      set: function (inches) { setRoomDimension(key, inches); },
      min: MIN_ROOM_IN,
      max: MAX_ROOM_IN,
      units: units,
    });
  }
  const widthBox = roomBox('room-width', 'width');
  const lengthBox = roomBox('room-length', 'length');

  // ---- Undo / redo ----
  function withRefit(action) {
    const before = room();
    const w = before.width;
    const l = before.length;
    action();
    if (room().width !== w || room().length !== l) view.fit();
  }
  RP.app = {
    undo: function () { withRefit(S.undo); },
    redo: function () { withRefit(S.redo); },
    fit: view.fit,
  };
  undoBtn.addEventListener('click', RP.app.undo);
  redoBtn.addEventListener('click', RP.app.redo);

  // ---- Status text: local save state + cloud sync state ----
  let localState = 'saved';                          // 'saved' | 'saving' | 'error'
  let cloudStatus = { state: 'idle', message: '' };

  function renderStatus() {
    let text = 'Saved locally';
    let cls = '';
    let title = '';
    if (localState === 'error') {
      text = 'Not saved: browser storage unavailable';
      cls = 'error';
    } else if (localState === 'saving') {
      text = 'Saving…';
    } else {
      switch (cloudStatus.state) {
        case 'syncing': text = 'Syncing…'; break;
        case 'synced': text = 'Synced'; break;
        case 'pending': text = 'Saved · will sync'; break;
        case 'offline': text = 'Offline · saved on this device'; cls = 'warn'; break;
        case 'conflict': text = 'A layout needs your decision'; cls = 'warn'; break;
        case 'error': text = 'Sync problem'; cls = 'error'; title = cloudStatus.message; break;
        default: break;
      }
    }
    saveStatus.textContent = text;
    saveStatus.title = title;
    saveStatus.className = 'save-status' + (cls ? ' ' + cls : '');
  }

  // ---- Autosave to browser storage (then the cloud picks it up) ----
  let savedRev = S.get().rev; // the placeholder project in memory at startup is never saved
  let saveTimer = 0;

  function saveNow() {
    clearTimeout(saveTimer);
    saveTimer = 0;
    if (!active) return;
    const ok = RP.storage.saveLayout(S.get().project);
    savedRev = S.get().rev;
    localState = ok ? 'saved' : 'error';
    renderStatus();
    RP.cloud.localChanged();
  }

  function scheduleSave() {
    if (!active || S.get().rev === savedRev) return;
    localState = 'saving';
    renderStatus();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, AUTOSAVE_MS);
  }

  function flushSave() {
    if (active && S.get().rev !== savedRev) saveNow();
  }
  window.addEventListener('pagehide', flushSave);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flushSave();
  });

  // The user library (custom categories and pieces) saves itself and then syncs.
  RP.library.onUserChange(function () {
    RP.storage.saveUserLibrary(RP.library.getUser());
    RP.cloud.libraryChanged();
  });

  // ---- Layouts ----
  function showProject(project) {
    flushSave();
    RP.library.syncProjectCategories(project);
    S.loadProject(project);
    RP.storage.setCurrentId(project.id);
    view.fit();
    clearTimeout(saveTimer);
    savedRev = S.get().rev;
    localState = 'saved';
    renderStatus();
    RP.cloud.localChanged();
  }

  // Read a stored layout through the same checks as an imported file.
  function loadStored(id) {
    const raw = RP.storage.loadLayout(id);
    if (!raw) return null;
    try { return RP.projectio.parseProject(JSON.stringify(raw)); } catch (e) { return null; }
  }

  function openLayout(id) {
    const p = loadStored(id);
    if (p) showProject(p);
    else RP.fields.message('That layout could not be opened.');
  }

  function uniqueLayoutName() {
    const names = RP.storage.listLayouts().map(function (l) { return l.name; });
    return names.indexOf('Untitled layout') === -1 ? 'Untitled layout' : RP.projectio.uniqueName('Untitled layout', names);
  }

  function newLayout() {
    const p = S.createProject(uniqueLayoutName());
    flushSave();
    RP.storage.saveLayout(p);
    showProject(p);
  }

  function openNewestOrNew(exceptId) {
    const next = RP.storage.listLayouts().filter(function (l) { return l.id !== exceptId; })[0];
    const p = next ? loadStored(next.id) : null;
    clearTimeout(saveTimer);
    savedRev = S.get().rev; // nothing to flush: the open layout is gone
    if (p) showProject(p); else newLayout();
  }

  function deleteLayout(id) {
    const wasCurrent = id === S.get().project.id;
    RP.storage.deleteLayout(id);
    RP.cloud.localChanged();
    if (wasCurrent) openNewestOrNew(id);
  }

  function renameLayout(id, name) {
    if (id === S.get().project.id) {
      S.update(function (p) { p.name = name; });
      return;
    }
    const raw = RP.storage.loadLayout(id);
    if (!raw) return;
    raw.name = name;
    raw.updatedAt = new Date().toISOString();
    RP.storage.saveLayout(raw);
    RP.cloud.localChanged();
  }

  $('layouts-btn').addEventListener('click', function () {
    flushSave();
    RP.dialogs.layoutsDialog({
      openLayout: openLayout,
      deleteLayout: deleteLayout,
      renameLayout: renameLayout,
      newLayout: newLayout,
      importFile: function () { $('import-file').click(); },
    });
  });

  nameInput.addEventListener('change', function () {
    const v = nameInput.value.trim() || 'Untitled layout';
    if (v !== S.get().project.name) S.update(function (p) { p.name = v; });
    nameInput.value = v;
  });
  nameInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === 'Escape') {
      if (e.key === 'Escape') nameInput.value = S.get().project.name;
      nameInput.blur();
    }
  });

  // ---- Export / import ----
  $('export-btn').addEventListener('click', function () {
    RP.projectio.exportProject(S.get().project);
  });
  $('import-btn').addEventListener('click', function () { $('import-file').click(); });
  $('import-file').addEventListener('change', function (e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    file.text().then(function (text) {
      const project = RP.projectio.mergeCategories(RP.projectio.parseProject(text));
      RP.dialogs.importDialog(project, {
        openAsNew: function (p) {
          p.id = S.newId('p');
          p.updatedAt = new Date().toISOString();
          flushSave();
          RP.storage.saveLayout(p);
          showProject(p);
        },
        replaceCurrent: function (p) {
          p.id = S.get().project.id;
          p.updatedAt = new Date().toISOString();
          RP.storage.saveLayout(p);
          showProject(p);
        },
      });
    }).catch(function (err) {
      RP.fields.message(err && err.message ? err.message : 'Could not read that file.');
    });
  });

  // ---- Toolbar controls ----
  const snapBtn = $('snap-toggle');
  const measureBtn = $('measure-toggle');
  const warningsBtn = $('warnings-toggle');
  const warnSummary = $('warn-summary');
  snapBtn.addEventListener('click', function () { S.setUi({ snap: !S.get().ui.snap }); });
  warningsBtn.addEventListener('click', function () { S.setUi({ warnings: !S.get().ui.warnings }); });
  measureBtn.addEventListener('click', function () {
    if (S.get().ui.tool === 'measure') S.setUi({ tool: 'select', measure: null });
    else S.setUi({ tool: 'measure', measure: null, selectedId: null, guides: [] });
  });
  gridSelect.addEventListener('change', function () { S.setUi({ gridSize: Number(gridSelect.value) }); });
  unitsBtn.addEventListener('click', function () {
    S.update(function (p) { p.units = p.units === 'metric' ? 'imperial' : 'metric'; });
  });

  // Theme: follows the system until the user picks one.
  function currentTheme() {
    const set = document.documentElement.getAttribute('data-theme');
    if (set) return set;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  try {
    const saved = localStorage.getItem('rp-theme');
    if (saved === 'light' || saved === 'dark') document.documentElement.setAttribute('data-theme', saved);
  } catch (e) { /* storage unavailable */ }
  themeBtn.addEventListener('click', function () {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('rp-theme', next); } catch (e) { /* ignore */ }
    syncToolbar();
  });

  $('zoom-in').addEventListener('click', function () { view.zoomBy(1.25); });
  $('zoom-out').addEventListener('click', function () { view.zoomBy(0.8); });
  $('zoom-fit').addEventListener('click', function () { view.fit(); });

  $('sync-btn').addEventListener('click', function () { RP.cloud.syncNow(true); });

  // Sign out: push what we can first, and warn before discarding anything unsynced.
  $('signout-btn').addEventListener('click', async function () {
    flushSave();
    if (navigator.onLine) {
      try { await RP.cloud.syncNow(false); } catch (e) { /* offline or failed: checked below */ }
    }
    if (RP.cloud.hasUnsynced() &&
        !window.confirm('Some changes have not reached the cloud yet. Signing out removes this device’s copy, so they would be lost. Sign out anyway?')) {
      return;
    }
    await RP.auth.signOut();
  });

  function syncToolbar() {
    const state = S.get();
    const r = room();
    const u = units();
    widthBox.sync();
    lengthBox.sync();
    areaEl.textContent = U.formatArea(r.width, r.length, u);
    if (document.activeElement !== nameInput) nameInput.value = state.project.name;
    undoBtn.disabled = !S.canUndo();
    redoBtn.disabled = !S.canRedo();
    gridSelect.value = String(state.ui.gridSize);
    snapBtn.setAttribute('aria-pressed', String(state.ui.snap));
    warningsBtn.setAttribute('aria-pressed', String(state.ui.warnings));
    const found = RP.checks.forState(state);
    const nOver = Object.keys(found.overlapIds).length;
    const nGaps = found.gaps.length;
    const parts = [];
    if (nOver) parts.push(nOver + (nOver === 1 ? ' piece overlaps' : ' pieces overlap'));
    if (nGaps) parts.push(nGaps + (nGaps === 1 ? ' tight gap' : ' tight gaps'));
    const nDoors = Object.keys(found.blockedDoors).length;
    if (nDoors) parts.push(nDoors + (nDoors === 1 ? ' door swing blocked' : ' door swings blocked'));
    warnSummary.textContent = parts.join(', ');
    const measuring = state.ui.tool === 'measure';
    measureBtn.setAttribute('aria-pressed', String(measuring));
    svg.classList.toggle('measuring', measuring);
    unitsBtn.textContent = u === 'metric' ? 'Metric' : 'ft / in';
    themeBtn.textContent = currentTheme() === 'dark' ? 'Dark' : 'Light';
  }

  // ---- Redraw and state subscription ----
  let drawQueued = false;
  function requestDraw() {
    if (drawQueued) return;
    drawQueued = true;
    requestAnimationFrame(function () {
      drawQueued = false;
      RP.render.draw(S.get());
    });
  }

  let lastPrefs = '';
  S.subscribe(function (state) {
    syncToolbar();
    RP.panel.sync(state);
    RP.props.sync(state);
    requestDraw();
    scheduleSave();
    const p = JSON.stringify({ gridSize: state.ui.gridSize, snap: state.ui.snap, warnings: state.ui.warnings });
    if (p !== lastPrefs) {
      lastPrefs = p;
      RP.storage.savePrefs(JSON.parse(p));
    }
  });

  // Keep the viewBox matched to the canvas size when the window changes.
  if (window.ResizeObserver) new ResizeObserver(requestDraw).observe(svg);
  else window.addEventListener('resize', requestDraw);

  // ---- Sign-in: open the app for a user ----
  const cloudHooks = {
    flush: flushSave,
    currentId: function () { return S.get().project.id; },
    currentUpdatedAt: function () { return S.get().project.updatedAt; },
    reloadCurrent: function (project) { showProject(project); },
    currentRemoved: function () {
      RP.fields.message('This layout was deleted on another computer.');
      openNewestOrNew(S.get().project.id);
    },
    libraryReplaced: function () { S.setUi({}); },
    onStatus: function (s) { cloudStatus = s; renderStatus(); },
  };

  function wait(msToWait) {
    return new Promise(function (resolve) { setTimeout(resolve, msToWait); });
  }

  async function startSession(user, info) {
    document.body.dataset.state = 'booting';
    RP.storage.setScope(user.id);
    RP.storage.adoptLegacy();           // data saved here before accounts existed joins this account
    RP.library.setUser(RP.storage.loadUserLibrary());
    active = true;
    savedRev = S.get().rev;
    $('account').textContent = user.email;
    $('account').title = 'Signed in as ' + user.email;

    const firstSync = RP.cloud.start(user, cloudHooks);
    // A device with nothing saved waits briefly for the cloud copy rather than starting a blank layout.
    if (!RP.storage.listLayouts().length && !info.offline) {
      await Promise.race([firstSync, wait(FIRST_SYNC_WAIT_MS)]);
    }

    const lastId = RP.storage.getCurrentId();
    let first = lastId ? loadStored(lastId) : null;
    if (!first) {
      const newest = RP.storage.listLayouts()[0];
      first = newest ? loadStored(newest.id) : null;
    }
    if (!first) {
      first = S.createProject('Untitled layout');
      RP.storage.saveLayout(first);
    }
    document.body.dataset.state = 'app';   // show the app before measuring the canvas
    showProject(first);
    renderStatus();
  }

  // ---- Sign-out: close the app and forget the open data ----
  function endSession(user, clearCache) {
    active = false;
    clearTimeout(saveTimer);
    RP.cloud.stop();
    RP.dialogs.closeAll();
    if (clearCache && user) RP.storage.clearUserData(user.id);
    RP.storage.setScope(null);
    RP.library.setUser({ categories: [], items: [], deleted: {} });
    S.loadProject(S.createProject('Untitled layout'));
    savedRev = S.get().rev;
    localState = 'saved';
    cloudStatus = { state: 'idle', message: '' };
    $('account').textContent = '';
  }

  RP.auth.init({
    onSignedIn: function (user, info) { startSession(user, info); },
    onSignedOut: endSession,
    onTokenRefreshed: function () { if (active) RP.cloud.syncNow(false); },
  });
})(window.RP = window.RP || {});
