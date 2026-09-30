// Snapping while dragging: to the grid, the room's walls, and other pieces.
// All positions are room inches; the threshold is in inches (usually a few screen pixels).
(function (RP) {
  'use strict';

  const PRIORITY = { wall: 0, piece: 1, grid: 2 };

  // Best snap on one axis. features: positions on the moving piece; targets: [{pos, kind}].
  // Returns { delta, target } or null.
  function bestOnAxis(features, targets, threshold) {
    let best = null;
    features.forEach(function (feature) {
      targets.forEach(function (target) {
        const delta = target.pos - feature;
        const dist = Math.abs(delta);
        if (dist > threshold) return;
        if (!best || dist < best.dist - 1e-9 ||
            (Math.abs(dist - best.dist) <= 1e-9 && PRIORITY[target.kind] < PRIORITY[best.target.kind])) {
          best = { delta: delta, dist: dist, target: target };
        }
      });
    });
    return best;
  }

  // Snap a piece whose center would land at (cx, cy).
  // Returns { x, y, guides: [{ axis: 'x'|'y', pos, kind }] } (guides only for walls and pieces).
  function snapPiece(piece, cx, cy, room, others, gridSize, threshold) {
    const h = RP.geometry.halfExtents(piece);
    const out = { x: cx, y: cy, guides: [] };
    const lines = RP.roomgeo.snapLines(room);

    [
      { axis: 'x', center: cx, half: h.hx, size: room.width, lo: 'x0', hi: 'x1', mid: 'xc' },
      { axis: 'y', center: cy, half: h.hy, size: room.length, lo: 'y0', hi: 'y1', mid: 'yc' },
    ].forEach(function (a) {
      const features = [a.center - a.half, a.center + a.half, a.center];
      // Straight walls to line up with (up-down walls for x, left-right walls for y).
      const targets = (a.axis === 'x' ? lines.xs : lines.ys).map(function (pos) { return { pos: pos, kind: 'wall' }; });

      others.forEach(function (o) {
        const oh = RP.geometry.halfExtents(o);
        const oc = a.axis === 'x' ? o.x : o.y;
        const ohalf = a.axis === 'x' ? oh.hx : oh.hy;
        targets.push({ pos: oc - ohalf, kind: 'piece' }, { pos: oc + ohalf, kind: 'piece' }, { pos: oc, kind: 'piece' });
      });

      // Grid lines only line up with the piece's edges, not its center.
      const gridTargets = [];
      const nearLo = Math.round(features[0] / gridSize) * gridSize;
      const nearHi = Math.round(features[1] / gridSize) * gridSize;
      gridTargets.push({ pos: nearLo, kind: 'grid', only: 0 }, { pos: nearHi, kind: 'grid', only: 1 });

      let best = bestOnAxis(features, targets, threshold);
      [0, 1].forEach(function (i) {
        const g = bestOnAxis([features[i]], [gridTargets[i]], threshold);
        if (g && (!best || g.dist < best.dist - 1e-9)) best = g;
      });

      if (best) {
        if (a.axis === 'x') out.x = cx + best.delta; else out.y = cy + best.delta;
        if (best.target.kind !== 'grid') out.guides.push({ axis: a.axis, pos: best.target.pos, kind: best.target.kind });
      }
    });
    return out;
  }

  // Snap a measuring point (in house inches) to the nearest room corner, piece corner, or grid crossing,
  // in any room.
  function snapPoint(pt, project, gridSize, threshold) {
    const cand = [
      { x: Math.round(pt.x / gridSize) * gridSize, y: Math.round(pt.y / gridSize) * gridSize },
    ];
    project.rooms.forEach(function (room) {
      const at = function (c) { return { x: c.x + room.x, y: c.y + room.y }; };
      RP.roomgeo.outline(room).forEach(function (c) { cand.push(at(c)); }); // the room's corners
      room.furniture.forEach(function (p) {
        if (p.shape === 'circle') {
          const r = p.width / 2;
          [{ x: p.x - r, y: p.y }, { x: p.x + r, y: p.y }, { x: p.x, y: p.y - r }, { x: p.x, y: p.y + r }].forEach(function (c) { cand.push(at(c)); });
        } else {
          RP.geometry.corners(p).forEach(function (c) { cand.push(at(c)); });
        }
      });
    });
    let best = null;
    cand.forEach(function (c) {
      const d = Math.hypot(c.x - pt.x, c.y - pt.y);
      if (d <= threshold && (!best || d < best.d)) best = { d: d, pt: c };
    });
    return best ? { x: best.pt.x, y: best.pt.y } : pt;
  }

  RP.snap = { snapPiece: snapPiece, snapPoint: snapPoint };
})(window.RP = window.RP || {});
