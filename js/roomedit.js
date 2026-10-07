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
      r.squareCorners = true;
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
      r.squareCorners = false;
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
      r.squareCorners = true;
      r.points = G.lShapePoints(w, l, nw, nl, corner).map(function (q) { return { x: q[0], y: q[1] }; });
      r.openings = [];
      G.syncBBox(r);
    });
    S.setUi({ selectedVertex: null, hoverEdge: null, selectedOpeningId: null });
  }

  // ---- Square corners ----

  function isHoriz(a, b) { return Math.abs(b.y - a.y) < Math.abs(b.x - a.x); }

  // Is every wall horizontal or vertical, alternating around the room (so every corner is 90 degrees)?
  // A corner that sits on a straight wall (a "pivot") is allowed: its two walls run the same way.
  function isSquare(pts) {
    const n = pts.length;
    if (n < 4) return false;
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      if (Math.min(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) > 0.01) return false;
      const c = pts[(i + 2) % n];
      if (isHoriz(a, b) === isHoriz(b, c) && (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) <= 0) return false; // doubles back
    }
    return true;
  }

  // Is corner k just a point on a straight wall (its two walls run the same way)?
  function isPivot(pts, k) {
    const n = pts.length;
    const a = pts[(k + n - 1) % n];
    const b = pts[k];
    const c = pts[(k + 1) % n];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    const dot = (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y);
    return Math.abs(cross) < 0.01 * Math.hypot(b.x - a.x, b.y - a.y) * Math.hypot(c.x - b.x, c.y - b.y) && dot > 0;
  }

  // The vertices of the whole straight run that wall i belongs to (pivots included), first to last.
  function runIndices(pts, i) {
    const n = pts.length;
    let s = i;
    for (let g = 0; g < n && isPivot(pts, s); g++) s = (s + n - 1) % n;
    let e = (i + 1) % n;
    for (let g = 0; g < n && isPivot(pts, e); g++) e = (e + 1) % n;
    const out = [];
    for (let k = s; ; k = (k + 1) % n) {
      out.push(k);
      if (k === e || out.length > n) break;
    }
    return out;
  }

  // Nudge an outline so every wall is horizontal or vertical. Returns new points, or null if that is not possible.
  function straighten(pts) {
    const n = pts.length;
    if (n < 4 || n % 2) return null;
    const horiz = pts.map(function (a, i) { return isHoriz(a, pts[(i + 1) % n]); });
    for (let i = 0; i < n; i++) if (horiz[i] === horiz[(i + 1) % n]) return null;
    // Each wall's position: its y if horizontal, its x if vertical
    const pos = pts.map(function (a, i) {
      const b = pts[(i + 1) % n];
      return horiz[i] ? (a.y + b.y) / 2 : (a.x + b.x) / 2;
    });
    const out = pts.map(function (p, k) {
      const before = (k + n - 1) % n;
      return horiz[before] ? { x: pos[k], y: pos[before] } : { x: pos[before], y: pos[k] };
    });
    return G.validPolygon(out) ? out : null;
  }

  // The outline after moving corner i to (x, y). With square corners on, the two corners next to it
  // slide along so its walls stay horizontal and vertical.
  function movedPoints(r, i, x, y) {
    const pts = clonePoints(r.points);
    const n = pts.length;
    if (r.squareCorners && n >= 4) {
      const orig = clonePoints(pts);
      const prev = (i + n - 1) % n;
      const next = (i + 1) % n;
      const prevH = isHoriz(orig[prev], orig[i]);
      const nextH = isHoriz(orig[i], orig[next]);
      // Slide the whole straight stretch on each side (pivots included) up to its far corner
      let k = prev;
      for (let g = 0; g < n; g++) {
        if (prevH) pts[k].y = y; else pts[k].x = x;
        if (!isPivot(orig, k)) break;
        k = (k + n - 1) % n;
      }
      k = next;
      for (let g = 0; g < n; g++) {
        if (nextH) pts[k].y = y; else pts[k].x = x;
        if (!isPivot(orig, k)) break;
        k = (k + 1) % n;
      }
    }
    pts[i] = { x: x, y: y };
    return pts;
  }

  // Would this outline be acceptable?
  function canMoveVertex(i, x, y) {
    return G.validPolygon(movedPoints(room(), i, x, y));
  }

  // Move a corner. Returns false (and changes nothing) if it would make walls cross or get too short.
  function moveVertex(i, x, y, opts) {
    if (!G.isPolygon(room())) return false;
    const pts = movedPoints(room(), i, x, y);
    if (!G.validPolygon(pts)) return false;
    S.update(function (p) {
      const r = S.activeOf(p);
      r.points = pts;
      afterShapeChange(r);
    }, opts);
    return true;
  }

  // ---- Moving a whole wall ----

  // Corners i and i+1 both shifted by (vx, vy). With `whole` the whole straight run the wall belongs to moves.
  function shiftWall(pts, i, vx, vy, whole) {
    const out = clonePoints(pts);
    const ids = whole ? runIndices(pts, i) : [i, (i + 1) % out.length];
    ids.forEach(function (k) { out[k].x += vx; out[k].y += vy; });
    return out;
  }

  // Unit vector pointing into the room from wall i of the given outline.
  function wallNormal(pts, i) {
    return G.edges({ shape: 'polygon', points: pts, width: 0, length: 0 })[i].n;
  }

  // Put wall i at distance d (inches, positive = into the room) from where it was in startPts.
  // Returns false (and changes nothing) if that would make walls cross or get too short.
  function moveWall(i, startPts, d, opts) {
    if (!G.isPolygon(room())) return false;
    const n = wallNormal(startPts, i);
    const pts = shiftWall(startPts, i, n.x * d, n.y * d, !!room().squareCorners);
    if (!G.validPolygon(pts)) return false;
    S.update(function (p) {
      const r = S.activeOf(p);
      r.points = pts;
      afterShapeChange(r);
    }, opts);
    return true;
  }

  // ---- Pivots: a corner on a straight wall, dragged in or out to make an L ----

  // Keep each door/window where it is in space: find the new wall it now lies on. Drops ones that no longer fit.
  function reattachOpenings(oldPts, ops, newPts) {
    const oldRoom = { shape: 'polygon', points: oldPts, width: 0, length: 0 };
    const edges = G.edges({ shape: 'polygon', points: newPts, width: 0, length: 0 });
    const kept = [];
    ops.forEach(function (op) {
      const mid = RP.openings.ends(oldRoom, op).mid;
      for (let i = 0; i < edges.length; i++) {
        const e = edges[i];
        if (G.distToSegment(mid, e.a, e.b) > 0.5) continue;
        const offset = (mid.x - e.a.x) * e.dir.x + (mid.y - e.a.y) * e.dir.y - op.width / 2;
        if (offset >= -0.01 && offset + op.width <= e.length + 0.01) {
          kept.push(Object.assign({}, op, { wall: i, offset: Math.max(0, offset) }));
        }
        return;
      }
    });
    return kept;
  }

  // The outline when pivot idx (a corner on a straight wall) is dragged to T. Its straight wall is cut at T and
  // the nearer end is pulled in (or pushed out) to meet it, which makes an L. Returns points, or null.
  function pivotShape(pts, idx, T) {
    const n = pts.length;
    const prev = function (k) { return (k + n - 1) % n; };
    const next = function (k) { return (k + 1) % n; };
    let s = idx;
    while (isPivot(pts, prev(s)) && prev(s) !== idx) s = prev(s);
    let e = idx;
    while (isPivot(pts, next(e)) && next(e) !== idx) e = next(e);
    const A = prev(s);
    const B = next(e);
    const a = pts[A];
    const b = pts[B];
    const P = pts[idx];
    const run = Math.hypot(b.x - a.x, b.y - a.y);
    if (run < 1) return null;
    const dir = { x: (b.x - a.x) / run, y: (b.y - a.y) / run };
    const nrm = wallNormal(pts, prev(idx)); // into the room
    const t = (T.x - a.x) * dir.x + (T.y - a.y) * dir.y;
    const y = (T.x - P.x) * nrm.x + (T.y - P.y) * nrm.y;
    if (t <= 0 || t >= run) return null;
    const toB = t >= run / 2;
    const Q = { x: a.x + dir.x * t, y: a.y + dir.y * t };
    const Qp = { x: Q.x + nrm.x * y, y: Q.y + nrm.y * y };
    const chain = {};
    for (let k = s; ; k = next(k)) { chain[k] = true; if (k === e) break; }
    const out = [];
    pts.forEach(function (p, k) {
      if (k === idx) { out.push.apply(out, toB ? [Q, Qp] : [Qp, Q]); return; }
      if (chain[k]) return; // other pivots on this wall are no longer needed
      if (k === B && toB) { out.push({ x: b.x + nrm.x * y, y: b.y + nrm.y * y }); return; }
      if (k === A && !toB) { out.push({ x: a.x + nrm.x * y, y: a.y + nrm.y * y }); return; }
      out.push({ x: p.x, y: p.y });
    });
    return out;
  }

  // Drag pivot idx to T, starting from startPts / startOps. Returns false (changing nothing) if that is not a valid shape.
  function movePivot(startPts, startOps, idx, T, opts) {
    if (!G.isPolygon(room())) return false;
    const pts = pivotShape(startPts, idx, T);
    if (!pts || !G.validPolygon(pts)) return false;
    const ops = reattachOpenings(startPts, startOps, pts);
    S.update(function (p) {
      const r = S.activeOf(p);
      r.points = pts;
      r.openings = ops;
      afterShapeChange(r);
    }, opts);
    return true;
  }

  // Turn square corners on (straightening the walls if needed) or off. Returns false if it cannot be turned on.
  function setSquare(on) {
    const r0 = room();
    if (!G.isPolygon(r0)) return false;
    if (!on) {
      S.update(function (p) { S.activeOf(p).squareCorners = false; });
      return true;
    }
    const pts = isSquare(r0.points) ? clonePoints(r0.points) : straighten(r0.points);
    if (!pts) return false;
    let shift = null;
    S.update(function (p) {
      const r = S.activeOf(p);
      r.squareCorners = true;
      r.points = pts;
      shift = G.normalize(r);
      afterShapeChange(r);
    });
    followShift(shift);
    return true;
  }

  // For square rooms, "+" on a wall adds a small step (a bump) in its middle. Returns the new outer wall's
  // number so it can be dragged straight away, or -1 if the wall is too short.
  function insertStep(i) {
    const r0 = room();
    const e = G.edges(r0)[i];
    const w = Math.min(24, Math.floor(e.length / 3));
    if (w < 6) return -1;
    const c1 = Math.round(e.length / 2 - w / 2);
    const c2 = c1 + w;
    const at = function (t, out) {
      return { x: e.a.x + e.dir.x * t - e.n.x * out, y: e.a.y + e.dir.y * t - e.n.y * out };
    };
    let pts = null;
    [12, -12].some(function (out) { // outward first, then inward
      const try1 = clonePoints(r0.points);
      try1.splice(i + 1, 0, at(c1, 0), at(c1, out), at(c2, out), at(c2, 0));
      if (G.validPolygon(try1)) { pts = try1; return true; }
      return false;
    });
    if (!pts) return -1;
    S.update(function (p) {
      const r = S.activeOf(p);
      r.points = pts;
      r.openings = r.openings.filter(function (op) {
        if (op.wall > i) { op.wall += 4; return true; }
        if (op.wall < i) return true;
        if (op.offset + op.width <= c1) return true;
        if (op.offset >= c2) { op.wall = i + 4; op.offset -= c2; return true; }
        if (c1 >= op.width) { op.offset = c1 - op.width; return true; }          // squeezed in before the step
        if (e.length - c2 >= op.width) { op.wall = i + 4; op.offset = 0; return true; } // or after it
        return false;
      });
      afterShapeChange(r);
    });
    return i + 2;
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
      const half = Math.round(e.length / 2); // a whole number of inches from the start
      const mid = { x: e.a.x + e.dir.x * half, y: e.a.y + e.dir.y * half };
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

  // Square room: removing a real corner puts it on the opposite corner of the rectangle its two walls
  // make (an inside corner of an L disappears and the room fills back to the walls beyond it).
  // The two corners beside it are dropped if they end up on a straight wall. Returns false if that is not possible.
  function deleteSquareCorner(i) {
    const r0 = room();
    const pts = clonePoints(r0.points);
    const n = pts.length;
    if (n <= 4) return false;
    const prev = (i + n - 1) % n;
    const next = (i + 1) % n;
    const flipped = clonePoints(pts);
    flipped[i] = { x: pts[prev].x + pts[next].x - pts[i].x, y: pts[prev].y + pts[next].y - pts[i].y };
    const gone = [prev, next].filter(function (k) { return !isPivot(pts, k) && isPivot(flipped, k); });
    const out = flipped.filter(function (p, k) { return gone.indexOf(k) === -1; });
    if (out.length < 4 || !G.validPolygon(out) || !isSquare(out)) return false;
    let shift = null;
    S.update(function (p) {
      const r = S.activeOf(p);
      r.points = out;
      r.openings = reattachOpenings(pts, r0.openings, out);
      shift = G.normalize(r);
      afterShapeChange(r);
    });
    followShift(shift);
    S.setUi({ selectedVertex: null, selectedOpeningId: null });
    return true;
  }

  // Remove corner i (a polygon keeps at least 3). Doors and windows on the wall that follows it are dropped.
  function deleteVertex(i) {
    const r0 = room();
    if (!G.isPolygon(r0) || r0.points.length <= 3) return false;
    if (r0.squareCorners && !isPivot(r0.points, i)) return deleteSquareCorner(i);
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
    const n = r0.points.length;
    let pts = clonePoints(r0.points);
    if (r0.squareCorners && !isPivot(pts, (i + 1) % n)) {
      // Slide the wall that follows, so every corner stays 90 degrees
      const delta = inches - e.length;
      pts = shiftWall(pts, (i + 1) % n, e.dir.x * delta, e.dir.y * delta, true);
    } else {
      pts[(i + 1) % n] = { x: e.a.x + e.dir.x * inches, y: e.a.y + e.dir.y * inches };
    }
    if (!G.validPolygon(pts)) return false;
    let shift = null;
    S.update(function (p) {
      const r = S.activeOf(p);
      r.points = pts;
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
    isSquare: isSquare,
    isPivot: isPivot,
    runIndices: runIndices,
    movePivot: movePivot,
    moveWall: moveWall,
    wallNormal: wallNormal,
    setSquare: setSquare,
    insertStep: insertStep,
  };
})(window.RP = window.RP || {});
