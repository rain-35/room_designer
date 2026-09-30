// JSON export and import: validating a file, migrating old versions, merging categories.
(function (RP) {
  'use strict';

  const S = RP.state;

  function isNum(n) { return typeof n === 'number' && isFinite(n); }

  // Bring an older file up to the current data version, one step at a time.
  function migrate(obj) {
    if (!isNum(obj.version)) obj.version = 1;
    if (obj.version > S.DATA_VERSION) {
      throw new Error('This file was made by a newer version of Room Planner.');
    }
    // Future versions: add steps here, e.g. if (obj.version === 1) { ...; obj.version = 2; }
    return obj;
  }

  function cleanPiece(f, seen) {
    if (!f || typeof f !== 'object' || !isNum(f.x) || !isNum(f.y) || !isNum(f.width) || f.width <= 0) {
      throw new Error('A furniture piece in this file has no valid position or size.');
    }
    const shape = f.shape === 'circle' ? 'circle' : 'rect';
    if (shape === 'rect' && (!isNum(f.depth) || f.depth <= 0)) {
      throw new Error('A furniture piece in this file has no valid size.');
    }
    const piece = Object.assign({
      id: '', type: 'custom-piece', name: 'Piece', categoryId: 'custom', rotation: 0,
      color: null, locked: false, layer: 'standard', ignoreClearance: false,
    }, f, { shape: shape });
    if (shape === 'circle') piece.depth = piece.width;
    piece.rotation = (((Math.round((isNum(piece.rotation) ? piece.rotation : 0) / 45) * 45) % 360) + 360) % 360;
    piece.layer = piece.layer === 'floor' ? 'floor' : 'standard';
    if (!piece.id || seen[piece.id]) piece.id = S.newId('f');
    seen[piece.id] = true;
    return piece;
  }

  function cleanOpening(o, room, seen) {
    if (!o || typeof o !== 'object' || !isNum(o.width) || o.width <= 0) {
      throw new Error('A door or window in this file has no valid size.');
    }
    const op = Object.assign({ id: '', type: 'door', wall: 'top', offset: 0, swing: 'in-left' }, o);
    if (RP.openings.TYPES.indexOf(op.type) === -1) op.type = 'door';
    if (RP.openings.WALLS.indexOf(op.wall) === -1) op.wall = 'top';
    if (RP.openings.SWINGS.indexOf(op.swing) === -1) op.swing = 'in-left';
    if (!isNum(op.offset)) op.offset = 0;
    if (!op.id || seen[op.id]) op.id = S.newId('o');
    seen[op.id] = true;
    RP.openings.clampOpening(room, op);
    return op;
  }

  // Text of a JSON file -> a complete project object, or throws an Error with a plain message.
  function parseProject(text) {
    let obj;
    try { obj = JSON.parse(text); } catch (e) { throw new Error('That file is not valid JSON.'); }
    if (!obj || typeof obj !== 'object' || !Array.isArray(obj.rooms) || !obj.rooms.length) {
      throw new Error('That file is not a Room Planner layout.');
    }
    migrate(obj);

    const base = S.createProject();
    const project = Object.assign({}, base, obj);
    if (typeof project.name !== 'string' || !project.name.trim()) project.name = 'Imported layout';
    project.units = project.units === 'metric' ? 'metric' : 'imperial';
    if (!isNum(project.minClearance)) project.minClearance = 36;
    project.categories = Array.isArray(project.categories) ? project.categories : [];

    const seen = {};
    project.rooms = project.rooms.map(function (room) {
      if (!room || !isNum(room.width) || !isNum(room.length) || room.width <= 0 || room.length <= 0) {
        throw new Error('A room in this file has no valid size.');
      }
      const r = Object.assign({ id: S.newId('r'), name: 'Room', x: 0, y: 0, shape: 'rect', points: [], openings: [] }, room);
      r.furniture = (Array.isArray(room.furniture) ? room.furniture : []).map(function (f) { return cleanPiece(f, seen); });
      const seenOpenings = {};
      r.openings = (Array.isArray(room.openings) ? room.openings : []).map(function (o) { return cleanOpening(o, r, seenOpenings); });
      return r;
    });
    return project;
  }

  // Unique "Name 2", "Name 3", ... among the given names (case-insensitive).
  function uniqueName(name, taken) {
    const lower = taken.map(function (n) { return n.toLowerCase(); });
    let i = 2;
    while (lower.indexOf((name + ' ' + i).toLowerCase()) !== -1) i++;
    return name + ' ' + i;
  }

  // Apply the import rules for categories:
  //  - same id as one we already have: use ours
  //  - only the name matches: keep the imported one under "Name 2"
  //  - new: add it to the user's library
  function mergeCategories(project) {
    const known = RP.library.allCategories({ categories: [] });
    const fixed = [];

    project.categories.forEach(function (c) {
      if (!c || typeof c.id !== 'string' || typeof c.name !== 'string') return;
      if (known.some(function (k) { return k.id === c.id; })) return;
      const copy = Object.assign({}, c, { builtIn: false });
      if (known.some(function (k) { return k.name.toLowerCase() === copy.name.toLowerCase(); })) {
        copy.name = uniqueName(copy.name, known.map(function (k) { return k.name; }));
      }
      known.push(copy);
      fixed.push(copy);
      RP.library.addUserCategory(copy);
    });

    // Pieces pointing at a category nobody defines fall back to Custom.
    project.rooms.forEach(function (room) {
      room.furniture.forEach(function (f) {
        if (!known.some(function (k) { return k.id === f.categoryId; })) f.categoryId = 'custom';
      });
    });

    project.categories = fixed;
    return project;
  }

  function fileNameFor(project) {
    const base = project.name.trim().replace(/[^\w\- ]+/g, '').replace(/\s+/g, '-') || 'layout';
    return base + '.json';
  }

  // Download the project as a JSON file.
  function exportProject(project) {
    RP.library.syncProjectCategories(project);
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileNameFor(project);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  RP.projectio = { parseProject: parseProject, mergeCategories: mergeCategories, exportProject: exportProject, uniqueName: uniqueName };
})(window.RP = window.RP || {});
