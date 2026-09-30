// Right-hand properties panel: room settings when nothing is selected,
// exact inputs for the selected piece, and the selection bar's quick buttons.
(function (RP) {
  'use strict';

  const S = RP.state;
  const A = RP.actions;
  const U = RP.units;
  const MIN_PIECE_IN = 1;
  const MAX_PIECE_IN = 600;

  let panelEl, roomBoxes, pieceBoxes, openingBoxes;
  const $ = function (id) { return document.getElementById(id); };

  function room() { return S.get().project.rooms[0]; }
  function units() { return S.get().project.units; }
  function selId() { return S.get().ui.selectedId; }

  function pieceBox(id, key) {
    return RP.fields.bindLength($(id), {
      get: function () { const f = A.selectedPiece(); return f ? f[key] : 0; },
      set: function (inches) { A.updatePiece(selId(), { [key]: inches }); },
      min: MIN_PIECE_IN,
      max: MAX_PIECE_IN,
      units: units,
    });
  }

  function init(opts) {
    panelEl = $('properties');

    // Room
    $('r-name').addEventListener('change', function () {
      const name = $('r-name').value.trim() || 'Room';
      S.update(function (p) { p.rooms[0].name = name; });
    });
    roomBoxes = ['width', 'length'].map(function (key) {
      return RP.fields.bindLength($('r-' + key), {
        get: function () { return room()[key]; },
        set: function (inches) { opts.setRoomDimension(key, inches); },
        min: opts.minRoom,
        max: opts.maxRoom,
        units: units,
      });
    });

    roomBoxes.push(RP.fields.bindLength($('r-clearance'), {
      get: function () { return S.get().project.minClearance; },
      set: function (inches) { S.update(function (p) { p.minClearance = inches; }); },
      min: RP.checks.IGNORE_GAP_IN,
      max: 240,
      units: units,
    }));

    // Piece
    pieceBoxes = [pieceBox('p-width', 'width'), pieceBox('p-depth', 'depth')];

    const cat = $('p-category');
    cat.addEventListener('change', function () { A.updatePiece(selId(), { categoryId: cat.value }); });

    $('p-name').addEventListener('change', function () {
      const f = A.selectedPiece();
      A.updatePiece(selId(), { name: $('p-name').value.trim() || (f ? f.name : 'Piece') });
    });
    $('p-rotation').addEventListener('change', function () {
      A.updatePiece(selId(), { rotation: Number($('p-rotation').value) });
    });
    $('p-color').addEventListener('input', function () {
      A.updatePiece(selId(), { color: $('p-color').value }, { coalesce: 'color:' + selId(), windowMs: 1500 });
    });
    $('p-color-reset').addEventListener('click', function () { A.updatePiece(selId(), { color: null }); });
    $('p-locked').addEventListener('change', function () { A.updatePiece(selId(), { locked: $('p-locked').checked }); });
    $('p-ignore').addEventListener('change', function () { A.updatePiece(selId(), { ignoreClearance: $('p-ignore').checked }); });

    // Door / window / doorway
    function openingBox(id, key, min) {
      return RP.fields.bindLength($(id), {
        get: function () { const o = A.selectedOpening(); return o ? o[key] : 0; },
        set: function (inches) { const o = A.selectedOpening(); if (o) A.updateOpening(o.id, { [key]: inches }); },
        min: min,
        max: opts.maxRoom,
        units: units,
      });
    }
    openingBoxes = [openingBox('o-offset', 'offset', 0), openingBox('o-width', 'width', 6)];

    function openingPatch(patch) {
      const o = A.selectedOpening();
      if (o) A.updateOpening(o.id, patch);
    }
    $('o-type').addEventListener('change', function () { openingPatch({ type: $('o-type').value }); });
    $('o-wall').addEventListener('change', function () { openingPatch({ wall: $('o-wall').value }); });
    function swingChanged() { openingPatch({ swing: $('o-opens').value + '-' + $('o-hinge').value }); }
    $('o-opens').addEventListener('change', swingChanged);
    $('o-hinge').addEventListener('change', swingChanged);
    $('o-del').addEventListener('click', A.deleteSelected);

    // Buttons (panel and selection bar)
    function rotate(dir) { return function () { if (selId()) A.rotatePiece(selId(), dir); }; }
    $('p-rot-ccw').addEventListener('click', rotate(-1));
    $('p-rot-cw').addEventListener('click', rotate(1));
    $('sb-rotate').addEventListener('click', rotate(1));
    $('p-dup').addEventListener('click', A.duplicateSelected);
    $('sb-dup').addEventListener('click', A.duplicateSelected);
    $('p-del').addEventListener('click', A.deleteSelected);

    // Phone drawer
    $('sb-edit').addEventListener('click', function () { panelEl.classList.toggle('open'); });
    $('props-close').addEventListener('click', function () { panelEl.classList.remove('open'); });
  }

  function setValue(el, value) {
    if (document.activeElement !== el && el.value !== value) el.value = value;
  }

  // Keep the Category dropdown in step with built-in, user and layout categories.
  let categorySignature = '';
  function syncCategoryOptions(state) {
    const cats = RP.library.allCategories(state.project);
    const signature = cats.map(function (c) { return c.id + ':' + c.name; }).join('|');
    if (signature === categorySignature) return;
    categorySignature = signature;
    const cat = $('p-category');
    cat.textContent = '';
    cats.forEach(function (c) {
      const o = document.createElement('option');
      o.value = c.id;
      o.textContent = c.name;
      cat.appendChild(o);
    });
  }

  function syncOpening(op) {
    $('props-title').textContent = RP.openings.label(op);
    setValue($('o-type'), op.type);
    setValue($('o-wall'), op.wall);
    $('o-offset-label').textContent = RP.openings.offsetLabel(op.wall);
    openingBoxes.forEach(function (b) { b.sync(); });
    $('o-swing-rows').hidden = op.type !== 'door';
    setValue($('o-opens'), op.swing.indexOf('in') === 0 ? 'in' : 'out');
    setValue($('o-hinge'), op.swing.slice(-4) === 'left' ? 'left' : 'right');
  }

  function sync(state) {
    syncCategoryOptions(state);
    const f = A.selectedPiece();
    const op = A.selectedOpening();
    $('props-room').hidden = !!f || !!op;
    $('props-piece').hidden = !f;
    $('props-opening').hidden = !op;
    $('props-title').textContent = f ? 'Piece' : 'Room';
    if (!f && !op) panelEl.classList.remove('open');

    if (op) {
      syncOpening(op);
      return;
    }
    if (!f) {
      setValue($('r-name'), room().name);
      roomBoxes.forEach(function (b) { b.sync(); });
      $('r-area').textContent = U.formatArea(room().width, room().length, state.project.units);
      return;
    }

    const circle = f.shape === 'circle';
    const locked = f.locked;
    setValue($('p-name'), f.name);
    setValue($('p-category'), f.categoryId);
    $('p-width-label').textContent = circle ? 'Diameter' : 'Width';
    $('p-depth-row').hidden = circle;
    pieceBoxes.forEach(function (b) { b.sync(); });
    setValue($('p-rotation'), String(f.rotation));
    setValue($('p-color'), RP.library.colorOf(state.project, f).toLowerCase());
    $('p-locked').checked = locked;
    $('p-ignore').checked = f.ignoreClearance;

    // A locked piece cannot be moved, rotated, resized, or deleted.
    ['p-width', 'p-depth', 'p-rotation', 'p-rot-ccw', 'p-rot-cw', 'p-del', 'sb-rotate'].forEach(function (id) {
      $(id).disabled = locked;
    });
    $('sb-dup').disabled = false;
  }

  RP.props = { init: init, sync: sync };
})(window.RP = window.RP || {});
