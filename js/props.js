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

    // Room shape
    $('r-make-l').addEventListener('click', function () { RP.dialogs.lShapeDialog(); });
    $('r-make-poly').addEventListener('click', function () { RP.roomedit.toPolygon(); });
    $('r-make-rect').addEventListener('click', function () {
      const r = room();
      const plain = r.points.length === 4 && r.points[0].x === 0 && r.points[0].y === 0 && r.points[1].y === 0 &&
        r.points[2].x === r.width && r.points[2].y === r.length;
      if (!plain && !window.confirm('Make the room a plain rectangle the size of its overall box? Extra corners are removed, and so are its doors and windows.')) return;
      RP.roomedit.toRect();
      RP.app.fit();
    });
    $('r-del-vertex').addEventListener('click', function () {
      const i = S.get().ui.selectedVertex;
      if (i !== null && !RP.roomedit.deleteVertex(i)) RP.fields.message('A room needs at least 3 corners, and its walls cannot cross.');
    });

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
    $('o-wall').addEventListener('change', function () {
      const v = $('o-wall').value;
      openingPatch({ wall: RP.roomgeo.isPolygon(room()) ? Number(v) : v });
    });
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

  // The walls of the room, listed for the opening's Wall menu.
  let wallMenuSignature = '';
  function syncWallMenu() {
    const keys = RP.openings.wallKeys(room());
    const signature = keys.join('|');
    if (signature === wallMenuSignature) return;
    wallMenuSignature = signature;
    const sel = $('o-wall');
    sel.textContent = '';
    keys.forEach(function (k) {
      const o = document.createElement('option');
      o.value = String(k);
      o.textContent = RP.openings.wallName(k);
      sel.appendChild(o);
    });
  }

  // The room's Walls list (polygon rooms): one length box per wall.
  let wallRows = [];
  function buildWallRows(n) {
    const list = $('r-walls-list');
    list.textContent = '';
    wallRows = [];
    S.get().ui.hoverEdge = null;
    for (let i = 0; i < n; i++) {
      const row = document.createElement('label');
      row.className = 'row wall-row';
      const name = document.createElement('span');
      name.textContent = 'Wall ' + (i + 1);
      const angle = document.createElement('span');
      angle.className = 'wall-angle';
      const input = document.createElement('input');
      input.type = 'text';
      input.autocomplete = 'off';
      input.spellcheck = false;
      row.appendChild(name);
      row.appendChild(angle);
      row.appendChild(input);
      list.appendChild(row);
      const box = RP.fields.bindLength(input, {
        get: function () { const e = RP.roomgeo.edges(room())[i]; return e ? e.length : 0; },
        set: function (inches) {
          if (!RP.roomedit.setWallLength(i, inches)) RP.fields.message('That length would make walls cross or overlap.');
        },
        min: RP.roomgeo.MIN_EDGE_IN,
        max: 6000,
        units: units,
      });
      row.addEventListener('mouseenter', function () { S.setUi({ hoverEdge: i }); });
      row.addEventListener('mouseleave', function () { S.setUi({ hoverEdge: null }); });
      wallRows.push({ box: box, angle: angle });
    }
  }

  function syncRoomShape(state) {
    const r = room();
    const poly = RP.roomgeo.isPolygon(r);
    $('r-shape').textContent = poly ? 'Polygon, ' + r.points.length + ' corners' : 'Rectangle';
    $('r-poly-hint').hidden = !poly;
    $('r-make-poly').hidden = poly;
    $('r-make-rect').hidden = !poly;
    const vertex = state.ui.selectedVertex;
    $('r-del-vertex').hidden = !(poly && vertex !== null);
    $('r-del-vertex').disabled = poly && r.points.length <= 3;
    $('r-width').disabled = poly;
    $('r-length').disabled = poly;
    $('r-walls').hidden = !poly;
    if (!poly) { wallRows = []; return; }
    if (wallRows.length !== r.points.length) buildWallRows(r.points.length);
    const edges = RP.roomgeo.edges(r);
    wallRows.forEach(function (row, i) {
      row.box.sync();
      let deg = Math.atan2(edges[i].dir.y, edges[i].dir.x) * 180 / Math.PI;
      if (deg < 0) deg += 360;
      row.angle.textContent = (Math.round(deg * 10) / 10) + '°';
    });
  }

  function syncOpening(op) {
    syncWallMenu();
    $('props-title').textContent = RP.openings.label(op);
    setValue($('o-type'), op.type);
    setValue($('o-wall'), String(op.wall));
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
      $('r-area').textContent = U.formatAreaSq(RP.roomgeo.area(room()), state.project.units);
      syncRoomShape(state);
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
