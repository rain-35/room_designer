// A layout can hold several rooms on one canvas. Each room has a position (x, y) in the
// house, and everything inside it (furniture, doors, corners) is measured from the room's own
// top-left corner. This module adds, copies, removes, positions and snaps whole rooms.
(function (RP) {
  'use strict';

  const S = RP.state;
  const G = RP.roomgeo;
  const NEW_ROOM_W = 120; // 10'
  const NEW_ROOM_L = 144; // 12'

  // The smallest box around every room, in house inches.
  function houseBox(project) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    project.rooms.forEach(function (r) {
      minX = Math.min(minX, r.x);
      minY = Math.min(minY, r.y);
      maxX = Math.max(maxX, r.x + r.width);
      maxY = Math.max(maxY, r.y + r.length);
    });
    return { minX: minX, minY: minY, maxX: maxX, maxY: maxY };
  }

  function nextName(project) {
    const names = project.rooms.map(function (r) { return r.name.toLowerCase(); });
    let n = project.rooms.length + 1;
    while (names.indexOf('room ' + n) !== -1) n++;
    return 'Room ' + n;
  }

  // A new empty 10' x 12' room, placed against the right side of the house.
  function addRoom() {
    let id = null;
    S.update(function (p) {
      const active = S.activeOf(p);
      const box = houseBox(p);
      id = S.newId('r');
      p.rooms.push({
        id: id, name: nextName(p), x: box.maxX, y: active.y, width: NEW_ROOM_W, length: NEW_ROOM_L,
        shape: 'rect', points: [], openings: [], furniture: [],
      });
    });
    S.setActiveRoom(id);
    return id;
  }

  // A copy of a room (with its furniture, doors and windows), placed against the right side of the house.
  function duplicateRoom(roomId) {
    let id = null;
    S.update(function (p) {
      const src = p.rooms.filter(function (r) { return r.id === roomId; })[0];
      if (!src) return;
      const box = houseBox(p);
      const copy = JSON.parse(JSON.stringify(src));
      id = S.newId('r');
      copy.id = id;
      copy.name = src.name + ' copy';
      copy.x = box.maxX;
      copy.furniture.forEach(function (f) { f.id = S.newId('f'); });
      copy.openings.forEach(function (o) { o.id = S.newId('o'); });
      (copy.dividers || []).forEach(function (d) { d.id = S.newId('d'); });
      p.rooms.push(copy);
    });
    if (id) S.setActiveRoom(id);
    return id;
  }

  // Remove a room. A layout always keeps at least one.
  function deleteRoom(roomId) {
    if (S.get().project.rooms.length <= 1) return false;
    let nextId = null;
    S.update(function (p) {
      const i = p.rooms.findIndex(function (r) { return r.id === roomId; });
      if (i === -1) return;
      p.rooms.splice(i, 1);
      nextId = p.rooms[Math.max(0, i - 1)].id;
    });
    if (nextId) S.setActiveRoom(nextId);
    return true;
  }

  function setPosition(roomId, x, y, opts) {
    S.update(function (p) {
      const r = p.rooms.filter(function (q) { return q.id === roomId; })[0];
      if (r) { r.x = x; r.y = y; }
    }, opts);
  }

  // After a room is dropped: if any room sits at a negative position, shift the whole house so
  // everything is at 0 or more (positions are typed as lengths). The view follows, so nothing jumps.
  function finishMove(opts) {
    let shift = { dx: 0, dy: 0 };
    S.update(function (p) {
      const box = houseBox(p);
      shift = { dx: box.minX < 0 ? -box.minX : 0, dy: box.minY < 0 ? -box.minY : 0 };
      if (shift.dx || shift.dy) p.rooms.forEach(function (r) { r.x += shift.dx; r.y += shift.dy; });
    }, opts);
    if (shift.dx || shift.dy) {
      const v = S.get().view;
      S.setView({ cx: v.cx + shift.dx, cy: v.cy + shift.dy, ppi: v.ppi });
    }
  }

  // Line a moving room up with the other rooms' edges (so walls sit flush), or with the grid.
  function snapPosition(room, x, y, others, gridSize, threshold) {
    function axis(pos, size, key, sizeKey) {
      let best = null;
      others.forEach(function (o) {
        const targets = [o[key], o[key] + o[sizeKey]];
        [pos, pos + size].forEach(function (feature) {
          targets.forEach(function (t) {
            const d = t - feature;
            if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best))) best = d;
          });
        });
      });
      if (best !== null) return pos + best;
      const g = Math.round(pos / gridSize) * gridSize;
      return Math.abs(g - pos) <= threshold ? g : pos;
    }
    return { x: axis(x, room.width, 'x', 'width'), y: axis(y, room.length, 'y', 'length') };
  }

  // Which room (if any) contains a point in house inches; later rooms are on top.
  function roomAt(project, pt) {
    for (let i = project.rooms.length - 1; i >= 0; i--) {
      const r = project.rooms[i];
      const local = { x: pt.x - r.x, y: pt.y - r.y };
      if (G.pointInPolygon(local, G.outline(r))) return r;
    }
    return null;
  }

  // Doors and doorways in OTHER rooms that sit on this wall (two rooms sharing a wall):
  // the wall is left open there too, so you can walk through. Returns [[from, to], ...] along the wall.
  function sharedGaps(project, room, wallKey) {
    const f = RP.openings.wallFrame(room, wallKey);
    const A = { x: room.x + f.start.x, y: room.y + f.start.y };
    const out = [];
    project.rooms.forEach(function (other) {
      if (other === room) return;
      other.openings.forEach(function (op) {
        if (op.type !== 'door' && op.type !== 'opening') return;
        const e = RP.openings.ends(other, op);
        const p0 = { x: other.x + e.p0.x, y: other.y + e.p0.y };
        const p1 = { x: other.x + e.p1.x, y: other.y + e.p1.y };
        const off = function (p) { return Math.abs((p.x - A.x) * f.n.x + (p.y - A.y) * f.n.y); };
        if (off(p0) > 1.5 || off(p1) > 1.5) return; // not on the same line as this wall
        const t0 = (p0.x - A.x) * f.a.x + (p0.y - A.y) * f.a.y;
        const t1 = (p1.x - A.x) * f.a.x + (p1.y - A.y) * f.a.y;
        const from = Math.max(0, Math.min(t0, t1));
        const to = Math.min(f.length, Math.max(t0, t1));
        if (to - from > 1) out.push([from, to]);
      });
    });
    return out;
  }

  RP.rooms = {
    houseBox: houseBox, addRoom: addRoom, duplicateRoom: duplicateRoom, deleteRoom: deleteRoom,
    setPosition: setPosition, finishMove: finishMove, snapPosition: snapPosition, roomAt: roomAt, sharedGaps: sharedGaps,
  };
})(window.RP = window.RP || {});
