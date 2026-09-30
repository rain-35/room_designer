// Changing the shape of the room: L-shapes, dragging corners, adding and removing corners,
// typing a wall's length. All changes go through the state's update() so undo works.
(function (RP) {
  'use strict';

  const S = RP.state;
  const G = RP.roomgeo;

  function room() { return S.room(); }

  function clonePoints(pts) {
    return pts.map(function (p) { return { x: p.x, y: p.y }; });
  }

  // After the outline changes: refresh the overall size and keep doors and windows on their walls.
  function afterShapeChange(r) {
    G.syncBBox(r);
    RP.openings.clampAll(r);
  }

  // Keep the picture still when the room's box is shifted back to (0, 0).
  function followShift(shift) {
    if (!shift || (!shift.dx && !shift.dy)) return;
    const v = S.get().view;
    S.setView({ cx: v.cx + shift.dx, cy: v.cy + shift.dy, ppi: v.ppi });
  }

  // A rectangle's doors/windows, renumbered for the same room written as four corners.
  function rectOpeningsToPolygon(r) {
    r.openings.forEach(function (op) {
      switch (op.wall) {
        case 'top': op.wall = 0; break;
        case 'right': op.wall = 1; break;
        case 'bottom': op.wall = 2; op.offset = r.width - op.offset - op.width; break;
        default: op.wall = 3; op.offset = r.length - op.offset - op.width; break;
      }
    });
  }

  // Is this polygon exactly the rectangle that toPolygon() makes?
  function isPlainRectangle(r) {
    const p = r.points;
    return p.length === 4 && p[0].x === 0 && p[0].y === 0 && p[1].x === r.width && p[1].y === 0 &&
      p[2].x === r.width && p[2].y === r.length && p[3].x === 0 && p[3].y === r.length;
  }

  // Rectangle -> the same room as four movable corners.
  function toPolygon() {
    if (G.isPolygon(room())) return;
    S.update(function (p) {
      const r = S.activeOf(p);
      r.shape = 'polygon';
      r.points = [{ x: 0, y: 0 }, { x: r.width, y: 0 }, { x: r.width, y: r.length }, { x: 0, y: r.length }];
      rectOpeningsToPolygon(r);
    });
    S.setUi({ selectedVertex: null });
  }

  // Polygon -> a rectangle the size of its overall box. Returns how many doors/windows were dropped.
  function toRect() {
    let dropped = 0;
    S.update(function (p) {
      const r = S.activeOf(p);
      if (!G.isPolygon(r)) return;
      if (isPlainRectangle(r)) {
        r.openings.forEach(function (op) {
          switch (op.wall) {
            case 0: op.wall = 'top'; break;
            case 1: op.wall = 'right'; break;
            case 2: op.wall = 'bottom'; op.offset = r.width - op.offset - op.width; break;
            default: op.wall = 'left'; op.offset = r.length - op.offset - op.width; break;
          }
        });
      } else {
        dropped = r.openings.length;
        r.openings = [];
      }
      r.shape = 'rect';
      r.points = [];
      RP.openings.clampAll(r);
    });
    S.setUi({ selectedVertex: null, hoverEdge: null, selectedOpeningId: null });
    return dropped;
  }

  // Make the room an L: overall w x l with a notch of nw x nl taken from one corner.
  // Doors and windows are removed (their walls no longer exist); furniture stays where it is.
  function setLShape(w, l, nw, nl, corner) {
    S.update(function (p) {
      const r = S.activeOf(p);
      r.shape = 'polygon';
      r.points = G.lShapePoints(w, l, nw, nl, corner).map(function (q) { return { x: q[0], y: q[1] }; });
      r.openings = [];
      G.syncBBox(r);
    });
    S.setUi({ selectedVertex: null, hoverEdge: null, selectedOpeningId: null });
  }

  // Would this outline be acceptable?
  function canMoveVertex(i, x, y) {
    const pts = clonePoints(room().points);
    pts[i] = { x: x, y: y };
    return G.validPolygon(pts);
  }

  // Move a corner. Returns false (and changes nothing) if it would make walls cross or get too short.
  function moveVertex(i, x, y, opts) {
    if (!G.isPolygon(room()) || !canMoveVertex(i, x, y)) return false;
    S.update(function (p) {
      const r = S.activeOf(p);
      r.points[i].x = x;
      r.points[i].y = y;
      afterShapeChange(r);
    }, opts);
    return true;
  }

  // Corner dragging is done: shift the room's box back to (0, 0) (same undo step as the drag).
  function finishVertexMove(opts) {
    let shift = null;
    S.update(function (p) {
      shift = G.normalize(S.activeOf(p));
      afterShapeChange(S.activeOf(p));
    }, opts);
    followShift(shift);
  }

  // Put a new corner in the middle of wall i. Returns its index.
  function insertVertex(i) {
    S.update(function (p) {
      const r = S.activeOf(p);
      const e = G.edges(r)[i];
      const half = e.length / 2;
      const mid = { x: (e.a.x + e.b.x) / 2, y: (e.a.y + e.b.y) / 2 };
      r.points.splice(i + 1, 0, mid);
      r.openings.forEach(function (op) {
        if (op.wall > i) {
          op.wall += 1;                                  // walls after this one are renumbered
        } else if (op.wall === i && op.offset >= half) {
          op.wall = i + 1;                               // it was on the far half: now on the new wall
          op.offset -= half;
        }
      });
      afterShapeChange(r);
    });
    return i + 1;
  }

  // Remove corner i (a polygon keeps at least 3). Doors and windows on the wall that follows it are dropped.
  function deleteVertex(i) {
    const r0 = room();
    if (!G.isPolygon(r0) || r0.points.length <= 3) return false;
    const pts = clonePoints(r0.points);
    pts.splice(i, 1);
    if (!G.validPolygon(pts)) return false;
    let shift = null;
    S.update(function (p) {
      const r = S.activeOf(p);
      r.points.splice(i, 1);
      r.openings = r.openings.filter(function (op) { return op.wall !== i; });
      r.openings.forEach(function (op) { if (op.wall > i) op.wall -= 1; });
      shift = G.normalize(r);
      afterShapeChange(r);
    });
    followShift(shift);
    S.setUi({ selectedVertex: null });
    return true;
  }

  // Set wall i to a length by moving its far corner along the wall's direction.
  function setWallLength(i, inches) {
    const r0 = room();
    if (!G.isPolygon(r0)) return false;
    const e = G.edges(r0)[i];
    const pts = clonePoints(r0.points);
    const j = (i + 1) % pts.length;
    pts[j] = { x: e.a.x + e.dir.x * inches, y: e.a.y + e.dir.y * inches };
    if (!G.validPolygon(pts)) return false;
    let shift = null;
    S.update(function (p) {
      const r = S.activeOf(p);
      r.points[j].x = pts[j].x;
      r.points[j].y = pts[j].y;
      shift = G.normalize(r);
      afterShapeChange(r);
    });
    followShift(shift);
    return true;
  }

  RP.roomedit = {
    toPolygon: toPolygon,
    toRect: toRect,
    setLShape: setLShape,
    canMoveVertex: canMoveVertex,
    moveVertex: moveVertex,
    finishVertexMove: finishVertexMove,
    insertVertex: insertVertex,
    deleteVertex: deleteVertex,
    setWallLength: setWallLength,
  };
})(window.RP = window.RP || {});
