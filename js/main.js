// Wires the toolbar to the state, manages layouts and autosave, and starts the app.
(function (RP) {
  'use strict';

  const U = RP.units;
  const S = RP.state;
  const MIN_ROOM_IN = 12;
  const MAX_ROOM_IN = 6000;
  const AUTOSAVE_MS = 400;

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

  // Saved preferences (grid, snap, warnings) before anything draws
  const prefs = RP.storage.loadPrefs();
  if ([1, 6, 12].indexOf(prefs.gridSize) !== -1) S.get().ui.gridSize = prefs.gridSize;
  if (typeof prefs.snap === 'boolean') S.get().ui.snap = prefs.snap;
  if (typeof prefs.warnings === 'boolean') S.get().ui.warnings = prefs.warnings;
  RP.library.setUser(RP.storage.loadUserLibrary());

  RP.render.init(svg);
  const view = RP.input.init(svg);
  RP.interact.init(svg, view);
  RP.panel.init();
  RP.dialogs.init();

  function room() { return S.get().project.rooms[0]; }
  function units() { return S.get().project.units; }

  // ---- Room size (toolbar and properties panel) ----
  function setRoomDimension(key, inches) {
    S.update(function (p) { p.rooms[0][key] = inches; });
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

  // ---- Autosave to browser storage ----
  let savedRev = S.get().rev; // the placeholder project in memory at startup is never saved
  let saveTimer = 0;

  function setStatus(text, isError) {
    saveStatus.textContent = text;
    saveStatus.classList.toggle('error', !!isError);
  }

  function saveNow() {
    clearTimeout(saveTimer);
    saveTimer = 0;
    const ok = RP.storage.saveLayout(S.get().project);
    savedRev = S.get().rev;
    setStatus(ok ? 'Saved locally' : 'Not saved: browser storage unavailable', !ok);
  }

  function scheduleSave() {
    if (S.get().rev === savedRev) return;
    setStatus('Saving…');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, AUTOSAVE_MS);
  }

  function flushSave() {
    if (S.get().rev !== savedRev) saveNow();
  }
  window.addEventListener('pagehide', flushSave);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flushSave();
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
    setStatus('Saved locally');
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

  function deleteLayout(id) {
    const wasCurrent = id === S.get().project.id;
    RP.storage.deleteLayout(id);
    if (!wasCurrent) return;
    const next = RP.storage.listLayouts()[0];
    const p = next ? loadStored(next.id) : null;
    clearTimeout(saveTimer);
    savedRev = S.get().rev; // nothing to flush: the open layout is gone
    if (p) showProject(p); else newLayout();
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

  // ---- Start: reopen the last layout, else the newest, else a fresh one ----
  const firstId = RP.storage.getCurrentId();
  let first = firstId ? loadStored(firstId) : null;
  if (!first) {
    const newest = RP.storage.listLayouts()[0];
    first = newest ? loadStored(newest.id) : null;
  }
  if (first) {
    showProject(first);
  } else {
    const p = S.createProject('Untitled layout');
    RP.storage.saveLayout(p);
    showProject(p);
  }
})(window.RP = window.RP || {});
