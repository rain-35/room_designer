// Pure view math. The view is { cx, cy, ppi }: the world point (inches) at the
// center of the canvas, and how many screen pixels one inch takes up.
(function (RP) {
  'use strict';

  const MIN_PPI = 0.2;
  const MAX_PPI = 60;

  const IMPERIAL_SCALE_STEPS = [1, 2, 3, 6, 12, 24, 60, 120, 240, 600, 1200, 2400, 6000]; // inches
  const METRIC_SCALE_STEPS_CM = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];

  function clampPpi(ppi) {
    return Math.min(MAX_PPI, Math.max(MIN_PPI, ppi));
  }

  // size = { w, h } of the canvas in pixels
  function screenToWorld(view, size, sx, sy) {
    return {
      x: view.cx + (sx - size.w / 2) / view.ppi,
      y: view.cy + (sy - size.h / 2) / view.ppi,
    };
  }

  // A view where world point `world` sits at screen point (sx, sy) at zoom `ppi`.
  function anchorView(view, size, world, sx, sy, ppi) {
    return {
      cx: world.x - (sx - size.w / 2) / ppi,
      cy: world.y - (sy - size.h / 2) / ppi,
      ppi: ppi,
    };
  }

  function fitView(size, room) {
    const margin = Math.min(70, Math.min(size.w, size.h) * 0.15);
    const ppi = clampPpi(Math.min(
      (size.w - 2 * margin) / room.width,
      (size.h - 2 * margin) / room.length
    ));
    return { cx: room.x + room.width / 2, cy: room.y + room.length / 2, ppi: ppi };
  }

  // SVG viewBox in inches, matching the canvas aspect ratio exactly (1 unit = 1 inch).
  function viewBoxFor(view, size) {
    const w = size.w / view.ppi;
    const h = size.h / view.ppi;
    return [view.cx - w / 2, view.cy - h / 2, w, h];
  }

  // Longest "nice" scale-bar length (in inches) that fits within maxPx.
  function niceScaleInches(ppi, units, maxPx) {
    const steps = units === 'metric'
      ? METRIC_SCALE_STEPS_CM.map(function (cm) { return cm * RP.units.INCH_PER_CM; })
      : IMPERIAL_SCALE_STEPS;
    let best = steps[0];
    for (let i = 0; i < steps.length; i++) {
      if (steps[i] * ppi <= maxPx) best = steps[i];
    }
    return best;
  }

  // Half the width and height of the box that just contains the piece (exact, even when rotated).
  function halfExtents(p) {
    if (p.shape === 'circle') return { hx: p.width / 2, hy: p.width / 2 };
    const t = p.rotation * Math.PI / 180;
    const c = Math.abs(Math.cos(t));
    const s = Math.abs(Math.sin(t));
    return { hx: (p.width * c + p.depth * s) / 2, hy: (p.width * s + p.depth * c) / 2 };
  }

  // The four real corners of a rectangular piece, in room inches (clockwise from top-left).
  function corners(p) {
    const t = p.rotation * Math.PI / 180;
    const cos = Math.cos(t);
    const sin = Math.sin(t);
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(function (k) {
      const lx = k[0] * p.width / 2;
      const ly = k[1] * p.depth / 2;
      return { x: p.x + lx * cos - ly * sin, y: p.y + lx * sin + ly * cos };
    });
  }

  // The point on the piece that reaches furthest toward a wall: side = left | right | top | bottom.
  // For a flat edge that is the edge's midpoint; for a corner it is the corner.
  function extremePoint(p, side) {
    const h = halfExtents(p);
    const horizontal = side === 'left' || side === 'right';
    const sign = side === 'left' || side === 'top' ? -1 : 1;
    if (p.shape === 'circle') {
      return horizontal ? { x: p.x + sign * h.hx, y: p.y } : { x: p.x, y: p.y + sign * h.hy };
    }
    const pts = corners(p);
    const key = horizontal ? 'x' : 'y';
    const other = horizontal ? 'y' : 'x';
    const best = Math.max.apply(null, pts.map(function (q) { return sign * q[key]; }));
    const hit = pts.filter(function (q) { return Math.abs(sign * q[key] - best) < 1e-6; });
    const avg = hit.reduce(function (sum, q) { return sum + q[other]; }, 0) / hit.length;
    const pos = sign * best;
    return horizontal ? { x: pos, y: avg } : { x: avg, y: pos };
  }

  // Distance from each side of the piece (its real extent) to the wall on that side.
  function wallDistances(p, room) {
    const out = {};
    ['left', 'right', 'top', 'bottom'].forEach(function (side) {
      const from = extremePoint(p, side);
      const d = side === 'left' ? from.x : side === 'right' ? room.width - from.x :
        side === 'top' ? from.y : room.length - from.y;
      out[side] = { distance: d, from: from };
    });
    return out;
  }

  RP.geometry = {
    MIN_PPI, MAX_PPI, clampPpi, screenToWorld, anchorView, fitView, viewBoxFor, niceScaleInches,
    halfExtents, corners, extremePoint, wallDistances,
  };
})(window.RP = window.RP || {});
