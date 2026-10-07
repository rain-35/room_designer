// Room outline geometry for rectangular and polygon rooms (pure functions, no drawing).
//
// A rectangular room is { shape: 'rect', width, length }. A polygon room is
// { shape: 'polygon', points: [{x, y}, ...] } and keeps width/length equal to the size of the
// smallest box around its points. Its points are kept shifted so that box starts at (0, 0),
// which lets everything that only needs "the room's box" (fitting the view, keeping pieces
// inside) work for both kinds.
(function (RP) {
  'use strict';

  const MIN_EDGE_IN = 6;
  const EPS = 1e-9;

  function isPolygon(room) {
    return room.shape === 'polygon' && Array.isArray(room.points) && room.points.length >= 3;
  }

  // Corners in order; for a rectangle, clockwise from the top-left.
  function outline(room) {
    if (isPolygon(room)) return room.points;
    return [{ x: 0, y: 0 }, { x: room.width, y: 0 }, { x: room.width, y: room.length }, { x: 0, y: room.length }];
  }

  // Positive when the corners run clockwise on screen.
  function signedArea(pts) {
    let s = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      s += a.x * b.y - b.x * a.y;
    }
    return s / 2;
  }

  function area(room) {
    return Math.abs(signedArea(outline(room)));
  }

  // Every wall: its two corners, length, unit direction, and the unit normal pointing into the room.
  function edges(room) {
    const pts = outline(room);
    const sign = signedArea(pts) >= 0 ? 1 : -1;
    return pts.map(function (a, i) {
      const b = pts[(i + 1) % pts.length];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || EPS;
      const d = { x: dx / len, y: dy / len };
      return { index: i, a: a, b: b, length: len, dir: d, n: { x: -d.y * sign, y: d.x * sign } };
    });
  }

  function bbox(pts) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    pts.forEach(function (p) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    });
    return { minX: minX, minY: minY, maxX: maxX, maxY: maxY };
  }

  function syncBBox(room) {
    if (!isPolygon(room)) return;
    const b = bbox(room.points);
    room.width = b.maxX - b.minX;
    room.length = b.maxY - b.minY;
  }

  // Shift a polygon room (and the furniture in it) so its box starts at (0, 0).
  // Returns the shift that was applied, so the view can follow it.
  function normalize(room) {
    if (!isPolygon(room)) return { dx: 0, dy: 0 };
    const b = bbox(room.points);
    const dx = -b.minX;
    const dy = -b.minY;
    if (Math.abs(dx) > 1e-9 || Math.abs(dy) > 1e-9) {
      room.points.forEach(function (p) { p.x += dx; p.y += dy; });
      room.furniture.forEach(function (f) { f.x += dx; f.y += dy; });
      if (room.nameAt && typeof room.nameAt.x === 'number') { room.nameAt.x += dx; room.nameAt.y += dy; }
      (room.dividers || []).forEach(function (d) {
        if (d && d.a && d.b) { d.a.x += dx; d.a.y += dy; d.b.x += dx; d.b.y += dy; }
      });
    } else {
      room.points.forEach(function (p) { if (Math.abs(p.x) < 1e-9) p.x = 0; if (Math.abs(p.y) < 1e-9) p.y = 0; });
    }
    syncBBox(room);
    return { dx: dx, dy: dy };
  }

  function pointInPolygon(pt, pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i];
      const b = pts[j];
      if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < (b.x - a.x) * (pt.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  }

  function orient(a, b, c) {
    return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  }

  function onSegment(a, b, p) {
    return Math.min(a.x, b.x) - 1e-7 <= p.x && p.x <= Math.max(a.x, b.x) + 1e-7 &&
      Math.min(a.y, b.y) - 1e-7 <= p.y && p.y <= Math.max(a.y, b.y) + 1e-7;
  }

  // Do segments p1-p2 and p3-p4 cross or touch?
  function segmentsIntersect(p1, p2, p3, p4) {
    const d1 = orient(p3, p4, p1);
    const d2 = orient(p3, p4, p2);
    const d3 = orient(p1, p2, p3);
    const d4 = orient(p1, p2, p4);
    if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
    const tol = 1e-7;
    if (Math.abs(d1) < tol && onSegment(p3, p4, p1)) return true;
    if (Math.abs(d2) < tol && onSegment(p3, p4, p2)) return true;
    if (Math.abs(d3) < tol && onSegment(p1, p2, p3)) return true;
    if (Math.abs(d4) < tol && onSegment(p1, p2, p4)) return true;
    return false;
  }

  // True when no two walls cross or touch (other than neighbors meeting at a corner).
  function isSimple(pts) {
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      // A wall that doubles straight back on its neighbor is a spike.
      const a = pts[i];
      const b = pts[(i + 1) % n];
      const c = pts[(i + 2) % n];
      if (Math.abs(orient(a, b, c)) < 1e-7 && (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) < 0) return false;
      for (let j = i + 1; j < n; j++) {
        if (j === i + 1 || (i === 0 && j === n - 1)) continue;
        if (segmentsIntersect(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return false;
      }
    }
    return true;
  }

  // A usable room outline: at least 3 corners, no tiny walls, walls do not cross.
  function validPolygon(pts) {
    if (pts.length < 3) return false;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      if (Math.hypot(b.x - a.x, b.y - a.y) < MIN_EDGE_IN) return false;
    }
    return Math.abs(signedArea(pts)) > 1 && isSimple(pts);
  }

  function distToSegment(p, a, b) {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const l2 = abx * abx + aby * aby;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / l2));
    return Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t));
  }

  // A point well inside the room (for dropping new pieces): the roomiest spot on a coarse grid.
  function interiorPoint(room) {
    if (!isPolygon(room)) return { x: room.width / 2, y: room.length / 2 };
    const pts = room.points;
    const b = bbox(pts);
    let best = null;
    const N = 24;
    for (let i = 0; i <= N; i++) {
      for (let j = 0; j <= N; j++) {
        const p = { x: b.minX + (b.maxX - b.minX) * i / N, y: b.minY + (b.maxY - b.minY) * j / N };
        if (!pointInPolygon(p, pts)) continue;
        let d = Infinity;
        for (let k = 0; k < pts.length; k++) d = Math.min(d, distToSegment(p, pts[k], pts[(k + 1) % pts.length]));
        if (!best || d > best.d) best = { d: d, p: p };
      }
    }
    return best ? best.p : { x: room.width / 2, y: room.length / 2 };
  }

  // x and y positions of the walls that run straight up-down / left-right (pieces snap to these).
  function snapLines(room) {
    const xs = [];
    const ys = [];
    const add = function (list, v) {
      for (let i = 0; i < list.length; i++) if (Math.abs(list[i] - v) < 1e-6) return;
      list.push(v);
    };
    edges(room).forEach(function (e) {
      if (Math.abs(e.a.x - e.b.x) < 1e-6) add(xs, e.a.x);
      if (Math.abs(e.a.y - e.b.y) < 1e-6) add(ys, e.a.y);
    });
    return { xs: xs, ys: ys };
  }

  function cross(u, v) { return u.x * v.y - u.y * v.x; }

  // First wall hit by a ray from origin along dir (unit). Returns { t, point } or null.
  function rayHit(origin, dir, edgeList) {
    let best = null;
    edgeList.forEach(function (e) {
      const r = { x: e.b.x - e.a.x, y: e.b.y - e.a.y };
      const denom = cross(dir, r);
      if (Math.abs(denom) < 1e-12) return;
      const ao = { x: e.a.x - origin.x, y: e.a.y - origin.y };
      const t = cross(ao, r) / denom;
      const s = cross(ao, dir) / denom;
      if (s < -1e-9 || s > 1 + 1e-9 || t < -1e-6) return;
      if (!best || t < best.t) best = { t: t, point: { x: origin.x + dir.x * t, y: origin.y + dir.y * t } };
    });
    return best;
  }

  // From the piece's extreme point on each side, straight to the wall in that direction.
  // -> { left, right, top, bottom }, each { distance, from, to } or null if no wall that way.
  function wallDistances(piece, room) {
    const list = edges(room);
    const dirs = { left: { x: -1, y: 0 }, right: { x: 1, y: 0 }, top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 } };
    const out = {};
    Object.keys(dirs).forEach(function (side) {
      const from = RP.geometry.extremePoint(piece, side);
      const hit = rayHit(from, dirs[side], list);
      out[side] = hit ? { distance: hit.t, from: from, to: hit.point } : null;
    });
    return out;
  }

  // An L: overall w x l with a notch (nw x nl) cut from one corner: 'tl' | 'tr' | 'br' | 'bl'.
  function lShapePoints(w, l, nw, nl, corner) {
    switch (corner) {
      case 'tl': return [[nw, 0], [w, 0], [w, l], [0, l], [0, nl], [nw, nl]];
      case 'br': return [[0, 0], [w, 0], [w, l - nl], [w - nw, l - nl], [w - nw, l], [0, l]];
      case 'bl': return [[0, 0], [w, 0], [w, l], [nw, l], [nw, l - nl], [0, l - nl]];
      default: return [[0, 0], [w - nw, 0], [w - nw, nl], [w, nl], [w, l], [0, l]]; // 'tr'
    }
  }

  RP.roomgeo = {
    MIN_EDGE_IN: MIN_EDGE_IN,
    isPolygon: isPolygon, outline: outline, signedArea: signedArea, area: area, edges: edges, bbox: bbox,
    syncBBox: syncBBox, normalize: normalize, pointInPolygon: pointInPolygon, segmentsIntersect: segmentsIntersect,
    isSimple: isSimple, validPolygon: validPolygon, distToSegment: distToSegment, interiorPoint: interiorPoint,
    snapLines: snapLines, rayHit: rayHit, wallDistances: wallDistances, lShapePoints: lShapePoints,
  };
})(window.RP = window.RP || {});
