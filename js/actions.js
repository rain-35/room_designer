// Things the user can do to furniture. UI code calls these instead of editing state directly.
(function (RP) {
  'use strict';

  const S = RP.state;
  const GEOMETRY_KEYS = ['x', 'y', 'width', 'depth', 'rotation']; // frozen while a piece is locked

  function currentRoom() {
    return S.room();
  }

  function findPiece(id) {
    const list = currentRoom().furniture;
    for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function selectedPiece() {
    const id = S.get().ui.selectedId;
    return id ? findPiece(id) : null;
  }

  function clampToRoom(room, x, y) {
    return { x: Math.min(room.width, Math.max(0, x)), y: Math.min(room.length, Math.max(0, y)) };
  }

  // Add a library item at (x, y) inches from the room's top-left; default is the room center.
  function addPiece(libItem, x, y) {
    const room = currentRoom();
    const spot = RP.roomgeo.interiorPoint(room); // the room's center, or the roomiest spot of an odd shape
    const at = clampToRoom(room, x === undefined ? spot.x : x, y === undefined ? spot.y : y);
    const piece = {
      id: S.newId('f'),
      type: libItem.type,
      name: libItem.name,
      shape: libItem.shape,
      x: at.x,
      y: at.y,
      width: libItem.defaultWidth,
      depth: libItem.shape === 'circle' ? libItem.defaultWidth : libItem.defaultDepth,
      categoryId: libItem.categoryId,
      rotation: 0,
      color: null,
      locked: false,
      layer: libItem.categoryId === 'rugs' ? 'floor' : 'standard',
      ignoreClearance: false,
    };
    S.update(function (p) { S.activeOf(p).furniture.push(piece); });
    S.setUi({ selectedId: piece.id, selectedOpeningId: null, selectedLabelId: null, selectedDividerId: null });
    return piece;
  }

  // ---- Doors, windows and doorways ----
  function findOpening(id) {
    const list = currentRoom().openings;
    for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function selectedOpening() {
    const id = S.get().ui.selectedOpeningId;
    return id ? findOpening(id) : null;
  }

  // Add from a template in RP.openings.TEMPLATES; starts centered on the top wall.
  function addOpening(tpl) {
    const room = currentRoom();
    const wall = RP.openings.wallKeys(room)[0];
    const op = {
      id: S.newId('o'),
      type: tpl.type,
      wall: wall,
      offset: Math.max(0, (RP.openings.wallLength(room, wall) - tpl.width) / 2),
      width: tpl.width,
      swing: 'in-left',
    };
    RP.openings.clampOpening(room, op);
    S.update(function (p) { S.activeOf(p).openings.push(op); });
    S.setUi({ selectedOpeningId: op.id, selectedId: null, selectedLabelId: null, selectedDividerId: null, tool: 'select', measure: null });
    return op;
  }

  function updateOpening(id, patch, opts) {
    S.update(function (p) {
      const room = S.activeOf(p);
      const op = room.openings.find(function (o) { return o.id === id; });
      if (!op) return;
      Object.assign(op, patch);
      RP.openings.clampOpening(room, op);
    }, opts);
  }

  function selectOpening(id) {
    const ui = S.get().ui;
    if (ui.selectedOpeningId !== id || ui.selectedId !== null || ui.selectedVertex !== null || ui.selectedLabelId !== null || ui.selectedDividerId !== null) {
      S.setUi({ selectedOpeningId: id, selectedId: null, selectedVertex: null, selectedLabelId: null, selectedDividerId: null });
    }
  }

  // Change any fields of a piece. A locked piece keeps its position, size and rotation.
  function updatePiece(id, patch, opts) {
    S.update(function (p) {
      const f = S.activeOf(p).furniture.find(function (q) { return q.id === id; });
      if (!f) return;
      const q = Object.assign({}, patch);
      if (f.locked && q.locked !== false) GEOMETRY_KEYS.forEach(function (k) { delete q[k]; });
      Object.assign(f, q);
      if (f.shape === 'circle' && 'width' in q) f.depth = f.width;
      if ('categoryId' in q) f.layer = f.categoryId === 'rugs' ? 'floor' : 'standard';
      if ('rotation' in q) f.rotation = (((Math.round(f.rotation / 45) * 45) % 360) + 360) % 360;
    }, opts);
  }

  function movePiece(id, x, y, opts) {
    const at = clampToRoom(currentRoom(), x, y);
    updatePiece(id, { x: at.x, y: at.y }, opts);
  }

  // dir = 1 clockwise, -1 counter-clockwise, in 45-degree steps
  function rotatePiece(id, dir) {
    const f = findPiece(id);
    if (f) updatePiece(id, { rotation: f.rotation + 45 * dir });
  }

  function duplicateSelected() {
    const f = selectedPiece();
    if (!f) return;
    const room = currentRoom();
    const at = clampToRoom(room, f.x + 12, f.y + 12);
    const copy = Object.assign({}, f, { id: S.newId('f'), x: at.x, y: at.y, locked: false });
    S.update(function (p) { S.activeOf(p).furniture.push(copy); });
    S.setUi({ selectedId: copy.id });
  }

  // ---- Floating labels (text notes anywhere in the house) ----
  const LABEL_SIZES = ['small', 'medium', 'large'];

  function findLabel(id) {
    const list = S.get().project.labels || [];
    for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function selectedLabel() {
    const id = S.get().ui.selectedLabelId;
    return id ? findLabel(id) : null;
  }

  // Add a label at (x, y) in house inches.
  function addLabel(text, size, x, y) {
    const label = { id: S.newId('t'), text: text, x: x, y: y, size: LABEL_SIZES.indexOf(size) === -1 ? 'medium' : size };
    S.update(function (p) { (p.labels = p.labels || []).push(label); });
    S.setUi({ selectedLabelId: label.id, selectedId: null, selectedOpeningId: null, selectedVertex: null, selectedDividerId: null, tool: 'select', measure: null });
    return label;
  }

  function updateLabel(id, patch, opts) {
    S.update(function (p) {
      const l = (p.labels || []).find(function (q) { return q.id === id; });
      if (l) Object.assign(l, patch);
    }, opts);
  }

  function selectLabel(id) {
    const ui = S.get().ui;
    if (ui.selectedLabelId !== id || ui.selectedId !== null || ui.selectedOpeningId !== null || ui.selectedVertex !== null || ui.selectedDividerId !== null) {
      S.setUi({ selectedLabelId: id, selectedId: null, selectedOpeningId: null, selectedVertex: null, selectedDividerId: null });
    }
  }

  // ---- Dividers: lines inside a room that split it into areas (no effect on the walls or the checks) ----
  function findDivider(id) {
    const list = currentRoom().dividers || [];
    for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function selectedDivider() {
    const id = S.get().ui.selectedDividerId;
    return id ? findDivider(id) : null;
  }

  // a and b are points in the room's own inches.
  function addDivider(a, b) {
    const d = { id: S.newId('d'), a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y }, style: 'solid' };
    S.update(function (p) { const r = S.activeOf(p); (r.dividers = r.dividers || []).push(d); });
    S.setUi({ selectedDividerId: d.id, selectedId: null, selectedOpeningId: null, selectedLabelId: null, selectedVertex: null, tool: 'select', dividerDraft: null });
    return d;
  }

  function updateDivider(id, patch, opts) {
    S.update(function (p) {
      const d = (S.activeOf(p).dividers || []).find(function (q) { return q.id === id; });
      if (d) Object.assign(d, patch);
    }, opts);
  }

  function selectDivider(id) {
    const ui = S.get().ui;
    if (ui.selectedDividerId !== id || ui.selectedId !== null || ui.selectedOpeningId !== null || ui.selectedLabelId !== null || ui.selectedVertex !== null) {
      S.setUi({ selectedDividerId: id, selectedId: null, selectedOpeningId: null, selectedLabelId: null, selectedVertex: null });
    }
  }

  function deleteSelected() {
    const divider = selectedDivider();
    if (divider) {
      S.update(function (p) {
        const list = S.activeOf(p).dividers;
        list.splice(list.findIndex(function (d) { return d.id === divider.id; }), 1);
        if (!list.length) delete S.activeOf(p).dividers;
      });
      S.setUi({ selectedDividerId: null });
      return;
    }
    const label = selectedLabel();
    if (label) {
      S.update(function (p) { p.labels.splice(p.labels.findIndex(function (l) { return l.id === label.id; }), 1); });
      S.setUi({ selectedLabelId: null });
      return;
    }
    const op = selectedOpening();
    if (op) {
      S.update(function (p) {
        const list = S.activeOf(p).openings;
        list.splice(list.findIndex(function (o) { return o.id === op.id; }), 1);
      });
      S.setUi({ selectedOpeningId: null });
      return;
    }
    const f = selectedPiece();
    if (!f || f.locked) return;
    S.update(function (p) {
      const list = S.activeOf(p).furniture;
      list.splice(list.findIndex(function (q) { return q.id === f.id; }), 1);
    });
    S.setUi({ selectedId: null });
  }

  function select(id) {
    const ui = S.get().ui;
    if (ui.selectedId !== id || ui.selectedOpeningId !== null || ui.selectedVertex !== null || ui.selectedLabelId !== null || ui.selectedDividerId !== null) {
      S.setUi({ selectedId: id, selectedOpeningId: null, selectedVertex: null, selectedLabelId: null, selectedDividerId: null });
    }
  }

  RP.actions = {
    findPiece: findPiece,
    selectedPiece: selectedPiece,
    addPiece: addPiece,
    updatePiece: updatePiece,
    movePiece: movePiece,
    rotatePiece: rotatePiece,
    duplicateSelected: duplicateSelected,
    deleteSelected: deleteSelected,
    select: select,
    findOpening: findOpening,
    selectedOpening: selectedOpening,
    addOpening: addOpening,
    updateOpening: updateOpening,
    selectOpening: selectOpening,
    findLabel: findLabel,
    selectedLabel: selectedLabel,
    addLabel: addLabel,
    updateLabel: updateLabel,
    selectLabel: selectLabel,
    findDivider: findDivider,
    selectedDivider: selectedDivider,
    addDivider: addDivider,
    updateDivider: updateDivider,
    selectDivider: selectDivider,
  };
})(window.RP = window.RP || {});
