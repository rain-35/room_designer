// Doors, windows and open doorways on the room's walls: geometry only (no drawing, no state).
//
// Each opening: { id, type: 'door'|'window'|'opening', wall: 'top'|'right'|'bottom'|'left',
//                 offset, width, swing: 'in-left'|'in-right'|'out-left'|'out-right' }
// offset = distance from the wall's start to the opening's near edge. Walls are measured in
// reading order: the top and bottom walls from their left end, the left and right walls from
// their top end. "left"/"right" in swing is the hinge side seen from inside the room, facing
// that wall. "in" swings into the room.
(function (RP) {
  'use strict';

  const WALLS = ['top', 'right', 'bottom', 'left'];
  const TYPES = ['door', 'window', 'opening'];
  const SWINGS = ['in-left', 'in-right', 'out-left', 'out-right'];
  const ARC_STEPS = 14;

  // What the library offers: click to add.
  const TEMPLATES = [
    { key: 'door-36', type: 'door', name: 'Door', width: 36 },
    { key: 'door-30', type: 'door', name: 'Door, narrow', width: 30 },
    { key: 'window-36', type: 'window', name: 'Window', width: 36 },
    { key: 'window-60', type: 'window', name: 'Window, wide', width: 60 },
    { key: 'opening-36', type: 'opening', name: 'Open doorway', width: 36 },
  ];

  function isPolygonWall(room) {
    return RP.roomgeo.isPolygon(room);
  }

  // The walls of a room: names for a rectangle, corner-order numbers (0, 1, 2...) for a polygon.
  function wallKeys(room) {
    if (!isPolygonWall(room)) return WALLS;
    return room.points.map(function (_, i) { return i; });
  }

  function isValidWall(room, wall) {
    if (isPolygonWall(room)) return typeof wall === 'number' && wall >= 0 && wall < room.points.length && wall % 1 === 0;
    return WALLS.indexOf(wall) !== -1;
  }

  function wallLength(room, wall) {
    return wallFrame(room, wall).length;
  }

  // start: where the wall starts (room inches); a: unit vector along it; n: unit vector into the room.
  // In a polygon, wall i runs from corner i to corner i+1.
  function wallFrame(room, wall) {
    if (isPolygonWall(room)) {
      const e = RP.roomgeo.edges(room)[wall] || RP.roomgeo.edges(room)[0];
      return { start: { x: e.a.x, y: e.a.y }, a: e.dir, n: e.n, length: e.length };
    }
    switch (wall) {
      case 'top': return { start: { x: 0, y: 0 }, a: { x: 1, y: 0 }, n: { x: 0, y: 1 }, length: room.width };
      case 'bottom': return { start: { x: 0, y: room.length }, a: { x: 1, y: 0 }, n: { x: 0, y: -1 }, length: room.width };
      case 'left': return { start: { x: 0, y: 0 }, a: { x: 0, y: 1 }, n: { x: 1, y: 0 }, length: room.length };
      default: return { start: { x: room.width, y: 0 }, a: { x: 0, y: 1 }, n: { x: -1, y: 0 }, length: room.length };
    }
  }

  function along(frame, dist) {
    return { x: frame.start.x + frame.a.x * dist, y: frame.start.y + frame.a.y * dist };
  }

  // The two ends of the opening and its center, in room inches.
  function ends(room, op) {
    const f = wallFrame(room, op.wall);
    return { frame: f, p0: along(f, op.offset), p1: along(f, op.offset + op.width), mid: along(f, op.offset + op.width / 2) };
  }

  // For a door: hinge point, the free end when closed, the free end when fully open, and swing data.
  function swingOf(room, op) {
    if (op.type !== 'door') return null;
    const e = ends(room, op);
    const f = e.frame;
    const inward = op.swing.indexOf('in') === 0;
    const leftHinge = op.swing.slice(-4) === 'left';
    // Seen from inside facing the wall, the viewer's left is (fy, -fx) where f = -n.
    const fx = -f.n.x;
    const fy = -f.n.y;
    const left = { x: fy, y: -fx };
    const leftIsEnd = left.x * f.a.x + left.y * f.a.y > 0;
    const hingeAtEnd = leftHinge ? leftIsEnd : !leftIsEnd;
    const sign = inward ? 1 : -1;
    const hinge = hingeAtEnd ? e.p1 : e.p0;
    const closedEnd = hingeAtEnd ? e.p0 : e.p1;
    const openEnd = { x: hinge.x + f.n.x * sign * op.width, y: hinge.y + f.n.y * sign * op.width };
    return { hinge: hinge, closedEnd: closedEnd, openEnd: openEnd, inward: inward, radius: op.width };
  }

  // The area the door sweeps, as a convex polygon (hinge plus points along the arc).
  function swingPolygon(room, op) {
    const s = swingOf(room, op);
    if (!s) return null;
    const u0 = { x: s.closedEnd.x - s.hinge.x, y: s.closedEnd.y - s.hinge.y };
    const u1 = { x: s.openEnd.x - s.hinge.x, y: s.openEnd.y - s.hinge.y };
    const pts = [{ x: s.hinge.x, y: s.hinge.y }];
    for (let i = 0; i <= ARC_STEPS; i++) {
      const t = (i / ARC_STEPS) * Math.PI / 2;
      pts.push({ x: s.hinge.x + u0.x * Math.cos(t) + u1.x * Math.sin(t), y: s.hinge.y + u0.y * Math.cos(t) + u1.y * Math.sin(t) });
    }
    return pts;
  }

  // Keep an opening on its wall: width no longer than the wall, offset inside it.
  function clampOpening(room, op) {
    const len = wallLength(room, op.wall);
    op.width = Math.max(1, Math.min(op.width, len));
    op.offset = Math.max(0, Math.min(op.offset, len - op.width));
  }

  function clampAll(room) {
    room.openings.forEach(function (op) { clampOpening(room, op); });
  }

  // Which wall is nearest a point, and how far along it the point is.
  function nearestWall(room, pt) {
    let best = null;
    wallKeys(room).forEach(function (wall) {
      const f = wallFrame(room, wall);
      const rel = { x: pt.x - f.start.x, y: pt.y - f.start.y };
      const t = rel.x * f.a.x + rel.y * f.a.y;
      const clamped = Math.max(0, Math.min(f.length, t));
      const dist = Math.hypot(rel.x - f.a.x * clamped, rel.y - f.a.y * clamped);
      if (!best || dist < best.dist) best = { wall: wall, along: t, dist: dist };
    });
    return best;
  }

  function label(op) {
    const names = { door: 'Door', window: 'Window', opening: 'Open doorway' };
    return names[op.type] || 'Opening';
  }

  // "From left" / "From top" text for the offset field.
  function offsetLabel(wall) {
    if (typeof wall === 'number') return 'From corner';
    return wall === 'top' || wall === 'bottom' ? 'From left' : 'From top';
  }

  // Name of a wall for menus: "Top" for a rectangle, "Wall 3" for a polygon.
  function wallName(wall) {
    if (typeof wall === 'number') return 'Wall ' + (wall + 1);
    return wall.charAt(0).toUpperCase() + wall.slice(1);
  }

  RP.openings = {
    WALLS: WALLS, TYPES: TYPES, SWINGS: SWINGS, TEMPLATES: TEMPLATES,
    wallKeys: wallKeys, isValidWall: isValidWall, wallName: wallName,
    wallLength: wallLength, wallFrame: wallFrame, ends: ends, swingOf: swingOf, swingPolygon: swingPolygon,
    clampOpening: clampOpening, clampAll: clampAll, nearestWall: nearestWall, label: label, offsetLabel: offsetLabel,
  };
})(window.RP = window.RP || {});
