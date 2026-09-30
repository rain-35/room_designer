// Layout checks: overlapping pieces, and tight walkways (gaps at least TIGHT_FROM_IN wide
// but under the room's minimum clearance). Uses each piece's real rotated corners.
(function (RP) {
  'use strict';

  const OVERLAP_TOL_IN = 0.05;   // pieces touching or sharing an edge are not "overlapping"
  const IGNORE_GAP_IN = 6;       // gaps under this are intentional (nightstand by a bed)
  const DEFAULT_MIN_CLEARANCE_IN = 36;
  const EPS = 1e-6;

  // ---- Shapes: { type: 'poly', pts } or { type: 'circle', c, r } ----
  function shapeOf(p) {
    if (p.shape === 'circle') return { type: 'circle', c: { x: p.x, y: p.y }, r: p.width / 2 };
    return { type: 'poly', pts: RP.geometry.corners(p) };
  }

  function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y }; }
  function len(v) { return Math.hypot(v.x, v.y); }

  function pointInPoly(pt, pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i];
      const b = pts[j];
      if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < (b.x - a.x) * (pt.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  }

  // Closest point on segment ab to p
  function closestOnSeg(p, a, b) {
    const ab = sub(b, a);
    const l2 = ab.x * ab.x + ab.y * ab.y;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / l2));
    return { x: a.x + ab.x * t, y: a.y + ab.y * t };
  }

  // Closest point on a polygon's outline to p
  function closestOnPoly(p, pts) {
    let best = null;
    for (let i = 0; i < pts.length; i++) {
      const q = closestOnSeg(p, pts[i], pts[(i + 1) % pts.length]);
      const d = len(sub(p, q));
      if (!best || d < best.d) best = { d: d, q: q };
    }
    return best;
  }

  function polyPolyOverlap(A, B) {
    const polys = [A, B];
    for (let k = 0; k < 2; k++) {
      const pts = polys[k];
      for (let i = 0; i < pts.length; i++) {
        const e = sub(pts[(i + 1) % pts.length], pts[i]);
        const n = { x: -e.y, y: e.x };
        const nl = len(n);
        if (nl < EPS) continue;
        n.x /= nl;
        n.y /= nl;
        const proj = function (list) {
          let lo = Infinity;
          let hi = -Infinity;
          list.forEach(function (q) {
            const v = q.x * n.x + q.y * n.y;
            if (v < lo) lo = v;
            if (v > hi) hi = v;
          });
          return [lo, hi];
        };
        const pa = proj(A);
        const pb = proj(B);
        if (Math.min(pa[1], pb[1]) - Math.max(pa[0], pb[0]) <= OVERLAP_TOL_IN) return false; // separating axis
      }
    }
    return true;
  }

  function overlaps(a, b) {
    if (a.type === 'circle' && b.type === 'circle') return len(sub(a.c, b.c)) < a.r + b.r - OVERLAP_TOL_IN;
    if (a.type === 'circle') return circlePoly(a, b);
    if (b.type === 'circle') return circlePoly(b, a);
    return polyPolyOverlap(a.pts, b.pts);
  }

  function circlePoly(circle, poly) {
    if (pointInPoly(circle.c, poly.pts)) return true;
    return closestOnPoly(circle.c, poly.pts).d < circle.r - OVERLAP_TOL_IN;
  }

  // Shortest gap between two shapes that do not overlap: { dist, a, b } with a on shape A, b on shape B.
  function gapBetween(a, b) {
    if (a.type === 'circle' && b.type === 'circle') {
      const v = sub(b.c, a.c);
      const d = len(v) || 1;
      return { dist: d - a.r - b.r, a: { x: a.c.x + v.x / d * a.r, y: a.c.y + v.y / d * a.r },
        b: { x: b.c.x - v.x / d * b.r, y: b.c.y - v.y / d * b.r } };
    }
    if (a.type === 'circle' || b.type === 'circle') {
      const circle = a.type === 'circle' ? a : b;
      const poly = a.type === 'circle' ? b : a;
      const cp = closestOnPoly(circle.c, poly.pts);
      const v = sub(cp.q, circle.c);
      const d = len(v) || 1;
      const onCircle = { x: circle.c.x + v.x / d * circle.r, y: circle.c.y + v.y / d * circle.r };
      const dist = cp.d - circle.r;
      return a.type === 'circle' ? { dist: dist, a: onCircle, b: cp.q } : { dist: dist, a: cp.q, b: onCircle };
    }
    let best = null;
    a.pts.forEach(function (p) {
      const cp = closestOnPoly(p, b.pts);
      if (!best || cp.d < best.dist) best = { dist: cp.d, a: p, b: cp.q };
    });
    b.pts.forEach(function (p) {
      const cp = closestOnPoly(p, a.pts);
      if (!best || cp.d < best.dist) best = { dist: cp.d, a: cp.q, b: p };
    });
    return best;
  }

  // Shortest gap between a piece and a wall segment a-b: { dist, a (on the piece), b (on the wall) }.
  // A piece that touches or crosses the wall has gap 0.
  function segmentGap(shape, a, b) {
    if (shape.type === 'circle') {
      const q = closestOnSeg(shape.c, a, b);
      const v = sub(q, shape.c);
      const d = len(v) || 1e-9;
      return { dist: d - shape.r, a: { x: shape.c.x + v.x / d * shape.r, y: shape.c.y + v.y / d * shape.r }, b: q };
    }
    const pts = shape.pts;
    for (let i = 0; i < pts.length; i++) {
      if (RP.roomgeo.segmentsIntersect(pts[i], pts[(i + 1) % pts.length], a, b)) return { dist: 0, a: a, b: a };
    }
    let best = null;
    pts.forEach(function (p) {
      const q = closestOnSeg(p, a, b);
      const d = len(sub(p, q));
      if (!best || d < best.dist) best = { dist: d, a: p, b: q };
    });
    [a, b].forEach(function (end) {
      const cp = closestOnPoly(end, pts);
      if (cp.d < best.dist) best = { dist: cp.d, a: cp.q, b: end };
    });
    return best;
  }

  function containsPoint(shape, pt) {
    if (shape.type === 'circle') return len(sub(pt, shape.c)) < shape.r;
    return pointInPoly(pt, shape.pts);
  }

  // Is some other piece sitting in the gap between a and b?
  function gapBlocked(gap, others) {
    for (let s = 1; s <= 9; s++) {
      const t = s / 10;
      const pt = { x: gap.a.x + (gap.b.x - gap.a.x) * t, y: gap.a.y + (gap.b.y - gap.a.y) * t };
      for (let i = 0; i < others.length; i++) if (containsPoint(others[i], pt)) return true;
    }
    return false;
  }

  // -> { overlapIds: {id: true}, gaps: [{ kind: 'piece'|'wall', a, b, distance }] }
  function analyze(project) {
    const room = project.rooms[0];
    const minClear = project.minClearance === undefined ? DEFAULT_MIN_CLEARANCE_IN : project.minClearance;
    const solid = room.furniture.filter(function (f) { return f.layer !== 'floor'; });
    const shapes = solid.map(shapeOf);
    const result = { overlapIds: {}, gaps: [], blockedDoors: {} };

    // A door that opens into the room must have its swing free of furniture.
    (room.openings || []).forEach(function (op) {
      if (op.type !== 'door' || op.swing.indexOf('in') !== 0) return;
      const sector = { type: 'poly', pts: RP.openings.swingPolygon(room, op) };
      for (let i = 0; i < solid.length; i++) {
        if (solid[i].ignoreClearance) continue;
        if (overlaps(sector, shapes[i])) { result.blockedDoors[op.id] = true; break; }
      }
    });

    for (let i = 0; i < solid.length; i++) {
      for (let j = i + 1; j < solid.length; j++) {
        if (overlaps(shapes[i], shapes[j])) {
          result.overlapIds[solid[i].id] = true;
          result.overlapIds[solid[j].id] = true;
          continue;
        }
        if (solid[i].ignoreClearance || solid[j].ignoreClearance) continue;
        const gap = gapBetween(shapes[i], shapes[j]);
        if (gap.dist < IGNORE_GAP_IN - EPS || gap.dist >= minClear - EPS) continue;
        const others = shapes.filter(function (_, k) { return k !== i && k !== j; });
        if (gapBlocked(gap, others)) continue;
        result.gaps.push({ kind: 'piece', a: gap.a, b: gap.b, distance: gap.dist });
      }
    }

    // Each piece against each wall (straight or angled), at the closest points.
    const walls = RP.roomgeo.edges(room);
    solid.forEach(function (f, i) {
      if (f.ignoreClearance) return;
      walls.forEach(function (w) {
        const gap = segmentGap(shapes[i], w.a, w.b);
        if (!gap || gap.dist < IGNORE_GAP_IN - EPS || gap.dist >= minClear - EPS) return;
        result.gaps.push({ kind: 'wall', a: gap.a, b: gap.b, distance: gap.dist });
      });
    });
    return result;
  }

  // Cached by the state's edit counter, so panning and zooming do not recompute.
  let cacheRev = -1;
  let cache = null;
  const NONE = { overlapIds: {}, gaps: [], blockedDoors: {} };

  function forState(state) {
    if (!state.ui.warnings) return NONE;
    if (cacheRev !== state.rev || !cache) {
      cache = analyze(state.project);
      cacheRev = state.rev;
    }
    return cache;
  }

  RP.checks = {
    DEFAULT_MIN_CLEARANCE_IN: DEFAULT_MIN_CLEARANCE_IN,
    IGNORE_GAP_IN: IGNORE_GAP_IN,
    analyze: analyze,
    forState: forState,
  };
})(window.RP = window.RP || {});
