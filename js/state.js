// One state object. Project edits go through update(), which records undo history.
(function (RP) {
  'use strict';

  const HISTORY_LIMIT = 100;
  const DATA_VERSION = 1;

  function newId(prefix) {
    return prefix + Math.random().toString(36).slice(2, 9);
  }

  function createProject(name) {
    const now = new Date().toISOString();
    return {
      id: newId('p'),
      name: name || 'Untitled layout',
      version: DATA_VERSION,
      units: 'imperial',
      minClearance: 36,   // walkway warning threshold, inches
      rooms: [{
        id: newId('r'),
        name: 'Room',
        x: 0,
        y: 0,
        width: 144,   // 12'
        length: 168,  // 14'
        shape: 'rect',
        points: [],
        openings: [],
        furniture: [],
      }],
      categories: [],
      ownerId: '',
      createdAt: now,
      updatedAt: now,
    };
  }

  const state = {
    project: createProject(),
    view: { cx: 72, cy: 84, ppi: 4 },
    rev: 0, // counts project changes; lets autosave and the layout checks know when to rerun
    ui: {
      gridSize: 12,
      selectedId: null,
      selectedOpeningId: null,
      selectedVertex: null,   // a room corner (polygon rooms)
      hoverEdge: null,        // a wall highlighted from the walls list
      snap: true,
      warnings: true,
      tool: 'select',   // 'select' or 'measure'
      guides: [],       // snap guide lines shown while dragging
      measure: null,    // { a, b, hover } in room inches
    },
  };
  const history = { undo: [], redo: [] };
  let lastEdit = { key: null, time: 0 };
  const subscribers = [];

  function notify() {
    subscribers.forEach(function (fn) { fn(state); });
  }

  function snapshot() {
    return JSON.stringify(state.project);
  }

  function restore(json) {
    state.project = JSON.parse(json);
    state.project.updatedAt = new Date().toISOString();
    state.rev++;
    lastEdit = { key: null, time: 0 };
    const id = state.ui.selectedId;
    if (id && !state.project.rooms[0].furniture.some(function (f) { return f.id === id; })) state.ui.selectedId = null;
    const oid = state.ui.selectedOpeningId;
    if (oid && !state.project.rooms[0].openings.some(function (o) { return o.id === oid; })) state.ui.selectedOpeningId = null;
    state.ui.guides = [];
    state.ui.selectedVertex = null;
    state.ui.hoverEdge = null;
    notify();
  }

  RP.state = {
    get: function () { return state; },
    subscribe: function (fn) { subscribers.push(fn); },

    // Change the project: update(function (project) { ... }, opts)
    // opts.coalesce: a key; consecutive updates with the same key make one undo step
    //   (one drag, one run of arrow-key nudges). opts.windowMs limits how long apart they may be.
    update: function (mutate, opts) {
      opts = opts || {};
      const now = Date.now();
      const merge = !!opts.coalesce && lastEdit.key === opts.coalesce &&
        (!opts.windowMs || now - lastEdit.time < opts.windowMs);
      if (!merge) {
        history.undo.push(snapshot());
        if (history.undo.length > HISTORY_LIMIT) history.undo.shift();
        history.redo.length = 0;
      }
      lastEdit = { key: opts.coalesce || null, time: now };
      mutate(state.project);
      RP.library.syncProjectCategories(state.project);
      state.project.updatedAt = new Date().toISOString();
      state.rev++;
      notify();
    },

    canUndo: function () { return history.undo.length > 0; },
    canRedo: function () { return history.redo.length > 0; },
    undo: function () {
      if (!history.undo.length) return;
      history.redo.push(snapshot());
      restore(history.undo.pop());
    },
    redo: function () {
      if (!history.redo.length) return;
      history.undo.push(snapshot());
      restore(history.redo.pop());
    },

    // Swap in a different layout (open, new, import). Clears undo history.
    loadProject: function (project) {
      state.project = project;
      history.undo.length = 0;
      history.redo.length = 0;
      lastEdit = { key: null, time: 0 };
      Object.assign(state.ui, { selectedId: null, selectedOpeningId: null, selectedVertex: null, hoverEdge: null, tool: 'select', guides: [], measure: null });
      state.rev++;
      notify();
    },

    setView: function (view) {
      state.view = view;
      notify();
    },
    setUi: function (patch) {
      Object.assign(state.ui, patch);
      notify();
    },
    createProject: createProject,
    DATA_VERSION: DATA_VERSION,
    newId: newId,
  };
})(window.RP = window.RP || {});
