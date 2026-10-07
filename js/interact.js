// Selecting, dragging (with snapping), resizing, nudging and measuring on the canvas,
// plus keyboard shortcuts.
(function (RP) {
  'use strict';

  const MIN_PIECE_IN = 1;
  const SNAP_PX = 8;          // how close (on screen) before something snaps
  const TAP_SLOP_PX = 6;      // pointer movement that still counts as a tap
  const CORNERS = { nw: [-1, -1], ne: [1, -1], se: [1, 1], sw: [-1, 1] };
  const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

  function init(svg, nav) {
    const S = RP.state;
    const A = RP.actions;
    let drag = null;     // { kind: 'move' | 'resize', pointerId, ... }
    let tap = null;      // pending measure-tool click

    // Pointer position in house inches (the whole canvas)
    function houseAt(e) {
      const r = svg.getBoundingClientRect();
      return RP.geometry.screenToWorld(S.get().view, RP.render.getSize(), e.clientX - r.left, e.clientY - r.top);
    }

    // Pointer position in the active room's own inches (origin at that room's top-left corner)
    function worldAt(e) {
      const w = houseAt(e);
      const room = S.room();
      return { x: w.x - room.x, y: w.y - room.y };
    }

    function snapThreshold() { return SNAP_PX / S.get().view.ppi; }
    function snapping(e) { return S.get().ui.snap && !e.altKey; }

    function clearGuides() {
      if (S.get().ui.guides.length) S.setUi({ guides: [] });
    }

    // ---- Resize ----
    function startResize(e, piece, corner) {
      const c = CORNERS[corner];
      const t = piece.rotation * Math.PI / 180;
      const u = { x: Math.cos(t), y: Math.sin(t) };   // piece's width axis
      const v = { x: -Math.sin(t), y: Math.cos(t) };  // piece's depth axis
      // The opposite corner stays put while this one follows the pointer.
      const opp = {
        x: piece.x - c[0] * piece.width / 2 * u.x - c[1] * piece.depth / 2 * v.x,
        y: piece.y - c[0] * piece.width / 2 * u.y - c[1] * piece.depth / 2 * v.y,
      };
      drag = { kind: 'resize', pointerId: e.pointerId, id: piece.id, c: c, u: u, v: v, opp: opp,
        circle: piece.shape === 'circle', key: S.newId('resize') };
    }

    // A size within snap range of a whole number of grid squares becomes exactly that.
    function snapSize(n) {
      const grid = S.get().ui.gridSize;
      const g = Math.round(n / grid) * grid;
      return g >= MIN_PIECE_IN && Math.abs(g - n) <= snapThreshold() ? g : n;
    }

    function doResize(e, w) {
      const d = { x: w.x - drag.opp.x, y: w.y - drag.opp.y };
      let width = Math.max(MIN_PIECE_IN, (d.x * drag.u.x + d.y * drag.u.y) * drag.c[0]);
      let depth = Math.max(MIN_PIECE_IN, (d.x * drag.v.x + d.y * drag.v.y) * drag.c[1]);
      if (snapping(e)) {
        width = snapSize(width);
        depth = snapSize(depth);
      }
      if (!e.altKey) { // whole inches, unless Alt is held
        width = Math.max(MIN_PIECE_IN, Math.round(width));
        depth = Math.max(MIN_PIECE_IN, Math.round(depth));
      }
      if (drag.circle) width = depth = Math.max(width, depth);
      A.updatePiece(drag.id, {
        width: width,
        depth: depth,
        x: drag.opp.x + drag.c[0] * width / 2 * drag.u.x + drag.c[1] * depth / 2 * drag.v.x,
        y: drag.opp.y + drag.c[0] * width / 2 * drag.u.y + drag.c[1] * depth / 2 * drag.v.y,
      }, { coalesce: drag.key });
    }

    // ---- Move with snapping ----
    function doMove(e, w) {
      const piece = A.findPiece(drag.id);
      if (!piece) return;
      const ui = S.get().ui;
      const room = S.room();
      let cx = w.x + drag.dx;
      let cy = w.y + drag.dy;
      let guides = [];
      if (snapping(e)) {
        const others = room.furniture.filter(function (f) { return f.id !== piece.id && f.layer !== 'floor'; });
        const s = RP.snap.snapPiece(piece, cx, cy, room, others, ui.gridSize, snapThreshold());
        cx = s.x;
        cy = s.y;
        guides = s.guides;
      }
      ui.guides = guides; // picked up by the redraw that movePiece triggers
      A.movePiece(drag.id, cx, cy, { coalesce: drag.key });
    }

    // ---- Doors and windows: slide along a wall, or jump to another wall ----
    function startOpeningDrag(e, op) {
      const room = S.room();
      const f = RP.openings.wallFrame(room, op.wall);
      const w = worldAt(e);
      const t = (w.x - f.start.x) * f.a.x + (w.y - f.start.y) * f.a.y;
      drag = { kind: 'opening', pointerId: e.pointerId, id: op.id, wall: op.wall, grab: t - op.offset, key: S.newId('open') };
    }

    function doOpeningDrag(e, w) {
      const op = A.findOpening(drag.id);
      if (!op) return;
      const room = S.room();
      const hit = RP.openings.nearestWall(room, w);
      if (hit.wall !== drag.wall) { drag.wall = hit.wall; drag.grab = op.width / 2; }
      let offset = hit.along - drag.grab;
      const len = RP.openings.wallLength(room, hit.wall);
      if (snapping(e)) {
        const grid = S.get().ui.gridSize;
        const tol = snapThreshold();
        const tries = [
          Math.round(offset / grid) * grid,                       // near edge on a grid line
          Math.round((offset + op.width) / grid) * grid - op.width, // far edge on a grid line
          0,                                                      // against the wall's start
          len - op.width,                                         // against the wall's end
        ];
        let best = null;
        tries.forEach(function (c) {
          const d = Math.abs(c - offset);
          if (d <= tol && (!best || d < best.d)) best = { d: d, v: c };
        });
        if (best) offset = best.v;
      }
      A.updateOpening(drag.id, { wall: hit.wall, offset: offset }, { coalesce: drag.key });
    }

    // ---- Room corners (polygon rooms) ----
    // Snap a dragged corner to the grid and to the x / y of the room's other corners.
    // Where a dragged corner goes. In a square room the walls that touch it are made a whole number of
    // inches long (measured from their far ends), unless Alt is held.
    function snapCorner(e, index, w, startPts) {
      const out = snapCornerRaw(e, index, w, startPts);
      const live = S.room();
      if (e.altKey || !live.squareCorners) return out;
      const P = startPts || live.points;
      const n = P.length;
      const prev = P[(index + n - 1) % n];
      const next = P[(index + 1) % n];
      const horiz = function (a, b) { return Math.abs(b.y - a.y) < Math.abs(b.x - a.x); };
      const wholeFrom = function (v, anchor) { return anchor + Math.round(v - anchor); };
      const r = { x: out.x, y: out.y };
      if (startPts) {
        // A point on a straight wall being dragged: the cut is a whole number of inches from the nearer end,
        // and its depth is a whole number of inches.
        const h = horiz(prev, P[index]);
        const key = h ? 'x' : 'y';
        const other = h ? 'y' : 'x';
        const near = Math.abs(r[key] - prev[key]) <= Math.abs(r[key] - next[key]) ? prev : next;
        r[key] = wholeFrom(r[key], near[key]);
        r[other] = wholeFrom(r[other], P[index][other]);
        return r;
      }
      if (horiz(prev, P[index])) r.x = wholeFrom(r.x, prev.x); else r.y = wholeFrom(r.y, prev.y);
      if (horiz(P[index], next)) r.x = wholeFrom(r.x, next.x); else r.y = wholeFrom(r.y, next.y);
      return r;
    }

    function snapCornerRaw(e, index, w, startPts) {
      const whole = function (p) { return e.altKey ? p : { x: Math.round(p.x), y: Math.round(p.y) }; }; // whole inches unless Alt
      if (!snapping(e)) return whole(w);
      const live = S.room();
      // startPts: the outline as it was when a pivot drag began (the live outline changes while dragging)
      const room = { squareCorners: live.squareCorners, points: startPts || live.points };
      const tol = snapThreshold();
      const grid = S.get().ui.gridSize;
      let hit = false;
      const axis = function (value, key) {
        let best = null;
        room.points.forEach(function (p, i) {
          if (i === index) return;
          // Square rooms: the two corners beside this one move with it, so they are not targets
          if (room.squareCorners && (i === (index + 1) % room.points.length || i === (index + room.points.length - 1) % room.points.length)) return;
          const d = Math.abs(p[key] - value);
          if (d <= tol && (!best || d < best.d)) best = { d: d, v: p[key] };
        });
        if (best) { hit = true; return best.v; }
        const g = Math.round(value / grid) * grid;
        if (Math.abs(g - value) <= tol) { hit = true; return g; }
        return value;
      };
      const out = { x: axis(w.x, 'x'), y: axis(w.y, 'y') };
      if (hit) return out;
      if (room.squareCorners) return whole(out); // neighbors move with it, so wall lengths follow the corner

      // Not on a grid line or in line with another corner: make a wall a whole number of grid squares long.
      const n = room.points.length;
      let best = null;
      [(index + n - 1) % n, (index + 1) % n].forEach(function (j) {
        const a = room.points[j];
        const len = Math.hypot(out.x - a.x, out.y - a.y);
        const target = Math.round(len / grid) * grid;
        const d = Math.abs(target - len);
        if (target > 0 && len > 0 && d <= tol && (!best || d < best.d)) {
          best = { d: d, x: a.x + (out.x - a.x) * target / len, y: a.y + (out.y - a.y) * target / len };
        }
      });
      return best ? { x: best.x, y: best.y } : whole(out);
    }

    function startCornerDrag(e, index, alreadyMoved) {
      S.setUi({ selectedVertex: index });
      const room = S.room();
      if (room.squareCorners && RP.roomedit.isPivot(room.points, index)) {
        // A corner on a straight wall: dragging it cuts or extends the room into an L
        drag = {
          kind: 'pivot', pointerId: e.pointerId, index: index, moved: false, key: S.newId('pivot'),
          pts: room.points.map(function (p) { return { x: p.x, y: p.y }; }),
          ops: JSON.parse(JSON.stringify(room.openings)),
        };
        return;
      }
      drag = { kind: 'vertex', pointerId: e.pointerId, index: index, moved: !!alreadyMoved, key: S.newId('corner') };
    }

    // ---- Moving a whole wall (polygon rooms): it slides straight in or out ----
    function startWallDrag(e, index, alreadyMoved) {
      const room = S.room();
      const pts = room.points.map(function (p) { return { x: p.x, y: p.y }; });
      const n = RP.roomedit.wallNormal(pts, index);
      const w = worldAt(e);
      drag = { kind: 'wall', pointerId: e.pointerId, index: index, pts: pts, n: n, start: w, moved: !!alreadyMoved, key: S.newId('wall') };
    }

    // How far to move the wall (inches, positive = into the room): snapped to grid lines and other corners
    // when the wall runs straight, and in whole inches unless Alt is held.
    function snapWallOffset(e, d) {
      if (e.altKey) return d;
      const n = drag.n;
      const axis = Math.abs(n.x) > 0.999 ? 'x' : Math.abs(n.y) > 0.999 ? 'y' : null;
      if (!axis) return Math.round(d);
      const other = axis === 'x' ? 'y' : 'x';
      const sign = axis === 'x' ? Math.sign(n.x) : Math.sign(n.y);
      const pts = drag.pts;
      const count = pts.length;
      const base = pts[drag.index][axis];
      const pos = base + sign * d;

      // The walls touching this one change length as it moves. Their far ends stay put, so those are the
      // positions the new lengths are measured from (only for walls running straight in the moving direction).
      const ids = S.room().squareCorners ? RP.roomedit.runIndices(pts, drag.index) : [drag.index, (drag.index + 1) % count];
      const first = pts[ids[0]];
      const last = pts[ids[ids.length - 1]];
      const anchors = [];
      const before = pts[(ids[0] + count - 1) % count];
      const after = pts[(ids[ids.length - 1] + 1) % count];
      if (Math.abs(before[other] - first[other]) < 1e-6) anchors.push(before[axis]);
      if (Math.abs(after[other] - last[other]) < 1e-6) anchors.push(after[axis]);
      const wholeLengths = function (p) {
        return anchors.every(function (a) { return Math.abs((p - a) - Math.round(p - a)) < 1e-6; });
      };

      if (snapping(e)) {
        // Line up with the grid or another corner, if that keeps the wall lengths whole
        const grid = S.get().ui.gridSize;
        const tol = snapThreshold();
        let best = null;
        pts.forEach(function (p, i) {
          if (ids.indexOf(i) !== -1) return;
          const dist = Math.abs(p[axis] - pos);
          if (dist <= tol && wholeLengths(p[axis]) && (!best || dist < best.d)) best = { d: dist, v: p[axis] };
        });
        const g = Math.round(pos / grid) * grid;
        if (!best && Math.abs(g - pos) <= tol && wholeLengths(g)) best = { d: 0, v: g };
        if (best) return (best.v - base) * sign;
      }

      // Otherwise make the touching walls a whole number of inches long
      let result = Math.round(pos);
      let bestGap = Infinity;
      anchors.forEach(function (a) {
        const c = a + Math.round(pos - a);
        if (Math.abs(c - pos) < bestGap) { bestGap = Math.abs(c - pos); result = c; }
      });
      return (result - base) * sign;
    }

    function doWallDrag(e, w) {
      const d = (w.x - drag.start.x) * drag.n.x + (w.y - drag.start.y) * drag.n.y;
      if (RP.roomedit.moveWall(drag.index, drag.pts, snapWallOffset(e, d), { coalesce: drag.key })) drag.moved = true;
    }

    // ---- Moving a whole room (drag its name tag) ----
    function startRoomDrag(e) {
      const room = S.room();
      const h = houseAt(e);
      drag = { kind: 'room', pointerId: e.pointerId, id: room.id, dx: room.x - h.x, dy: room.y - h.y, key: S.newId('room') };
    }

    function doRoomDrag(e) {
      const project = S.get().project;
      const room = S.room();
      const h = houseAt(e);
      let x = h.x + drag.dx;
      let y = h.y + drag.dy;
      if (snapping(e)) {
        const others = project.rooms.filter(function (r) { return r !== room; });
        const s = RP.rooms.snapPosition(room, x, y, others, S.get().ui.gridSize, snapThreshold());
        x = s.x;
        y = s.y;
      }
      RP.rooms.setPosition(room.id, x, y, { coalesce: drag.key });
      drag.moved = true;
    }

    // ---- Measure tool (in house inches, so it can measure across rooms) ----
    function measurePoint(e) {
      const pt = houseAt(e);
      if (!snapping(e)) return pt;
      return RP.snap.snapPoint(pt, S.get().project, S.get().ui.gridSize, snapThreshold());
    }

    function placeMeasurePoint(e) {
      const pt = measurePoint(e);
      const m = S.get().ui.measure;
      if (!m || m.b) S.setUi({ measure: { a: pt, b: null, hover: null } });
      else S.setUi({ measure: { a: m.a, b: pt, hover: null } });
    }

    svg.addEventListener('pointerdown', function (e) {
      if (e.button !== 0 || nav.spaceDown() || nav.pointerCount() > 1) {
        drag = null; // panning or pinching, not editing
        tap = null;
        return;
      }
      if (S.get().ui.tool === 'measure') {
        tap = { id: e.pointerId, x: e.clientX, y: e.clientY };
        return;
      }
      // A floating label: select it and drag to move
      const labelNode = e.target.closest ? e.target.closest('[data-label]') : null;
      if (labelNode) {
        const label = A.findLabel(labelNode.getAttribute('data-label'));
        if (label) {
          A.selectLabel(label.id);
          const h = houseAt(e);
          drag = { kind: 'label', pointerId: e.pointerId, id: label.id, dx: label.x - h.x, dy: label.y - h.y, key: S.newId('label') };
        }
        return;
      }
      // Touching something in another room makes that room the one being edited.
      const roomNode = e.target.closest ? e.target.closest('[data-room]') : null;
      if (roomNode && roomNode.getAttribute('data-room') !== S.room().id) S.setActiveRoom(roomNode.getAttribute('data-room'));
      if (e.target.closest && e.target.closest('[data-roomtag]')) {
        startRoomDrag(e);
        return;
      }
      const nameNode = e.target.closest ? e.target.closest('[data-roomname]') : null;
      if (nameNode) {
        // The room's name label: drag to put it where it identifies the room best
        const room = S.room();
        const at = room.nameAt || RP.roomgeo.interiorPoint(room);
        const w0 = worldAt(e);
        A.select(null);
        drag = { kind: 'roomname', pointerId: e.pointerId, dx: at.x - w0.x, dy: at.y - w0.y, key: S.newId('name') };
        return;
      }
      const cornerNode = e.target.closest ? e.target.closest('[data-vertex]') : null;
      if (cornerNode) {
        startCornerDrag(e, Number(cornerNode.getAttribute('data-vertex')), false);
        return;
      }
      const addNode = e.target.closest ? e.target.closest('[data-addvertex]') : null;
      if (addNode) {
        // Clicking a wall's + adds a corner there (square rooms: a small step); keep dragging to place it.
        const wallIndex = Number(addNode.getAttribute('data-addvertex'));
        if (S.room().squareCorners && e.shiftKey) { // Shift+click in a square room: a step instead of a single corner
          const stepWall = RP.roomedit.insertStep(wallIndex);
          if (stepWall < 0) RP.fields.message('That wall is too short to add a step.');
          else startWallDrag(e, stepWall, true);
          return;
        }
        const at = RP.roomedit.insertVertex(wallIndex);
        startCornerDrag(e, at, true);
        return;
      }
      const wallNode = e.target.closest ? e.target.closest('[data-wall]') : null;
      if (wallNode) {
        startWallDrag(e, Number(wallNode.getAttribute('data-wall')), false);
        return;
      }
      const opNode = e.target.closest ? e.target.closest('[data-opening]') : null;
      if (opNode) {
        const op = A.findOpening(opNode.getAttribute('data-opening'));
        if (op) {
          A.selectOpening(op.id);
          startOpeningDrag(e, op);
        }
        return;
      }
      const handle = e.target.closest ? e.target.closest('[data-handle]') : null;
      if (handle) {
        const sel = A.selectedPiece();
        if (sel && !sel.locked) startResize(e, sel, handle.getAttribute('data-handle'));
        return;
      }
      const node = e.target.closest ? e.target.closest('[data-id]') : null;
      if (!node) {
        A.select(null);
        return;
      }
      const piece = A.findPiece(node.getAttribute('data-id'));
      if (!piece) return;
      A.select(piece.id);
      if (piece.locked) return;
      const w = worldAt(e);
      drag = { kind: 'move', pointerId: e.pointerId, id: piece.id, dx: piece.x - w.x, dy: piece.y - w.y, key: S.newId('move') };
    });

    svg.addEventListener('pointermove', function (e) {
      const ui = S.get().ui;
      if (ui.tool === 'measure') {
        // Live preview line from the first point to the cursor (mouse/pen)
        if (ui.measure && ui.measure.a && !ui.measure.b && e.pointerType !== 'touch' && nav.pointerCount() === 0) {
          S.setUi({ measure: { a: ui.measure.a, b: null, hover: measurePoint(e) } });
        }
        return;
      }
      if (!drag || e.pointerId !== drag.pointerId) return;
      if (nav.pointerCount() > 1) { drag = null; clearGuides(); return; }
      const w = worldAt(e);
      if (drag.kind === 'label') {
        const h = houseAt(e);
        const x = h.x + drag.dx;
        const y = h.y + drag.dy;
        A.updateLabel(drag.id, e.altKey ? { x: x, y: y } : { x: Math.round(x), y: Math.round(y) }, { coalesce: drag.key });
      } else if (drag.kind === 'roomname') {
        const room = S.room();
        const x = Math.min(room.width, Math.max(0, w.x + drag.dx));
        const y = Math.min(room.length, Math.max(0, w.y + drag.dy));
        const at = e.altKey ? { x: x, y: y } : { x: Math.round(x), y: Math.round(y) };
        S.update(function (p) { S.activeOf(p).nameAt = at; }, { coalesce: drag.key });
      } else if (drag.kind === 'room') doRoomDrag(e);
      else if (drag.kind === 'resize') doResize(e, w);
      else if (drag.kind === 'vertex') {
        const at = snapCorner(e, drag.index, w);
        if (RP.roomedit.moveVertex(drag.index, at.x, at.y, { coalesce: drag.key })) drag.moved = true;
      } else if (drag.kind === 'pivot') {
        const at = snapCorner(e, drag.index, w, drag.pts);
        if (RP.roomedit.movePivot(drag.pts, drag.ops, drag.index, at, { coalesce: drag.key })) drag.moved = true;
      } else if (drag.kind === 'wall') doWallDrag(e, w);
      else if (drag.kind === 'opening') doOpeningDrag(e, w);
      else doMove(e, w);
    });

    function end(e) {
      if (tap && e.pointerId === tap.id) {
        const moved = Math.hypot(e.clientX - tap.x, e.clientY - tap.y);
        tap = null;
        if (e.type === 'pointerup' && moved <= TAP_SLOP_PX) placeMeasurePoint(e);
      }
      if (drag && e.pointerId === drag.pointerId) {
        // A dragged corner: move the room's box back to (0, 0), as part of the same undo step.
        if ((drag.kind === 'vertex' || drag.kind === 'wall' || drag.kind === 'pivot') && drag.moved) RP.roomedit.finishVertexMove({ coalesce: drag.key });
        if (drag.kind === 'room' && drag.moved) RP.rooms.finishMove({ coalesce: drag.key });
        drag = null;
        clearGuides();
      }
    }
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', end);

    // Double-click a floating label to edit its text
    svg.addEventListener('dblclick', function (e) {
      const node = e.target.closest ? e.target.closest('[data-label]') : null;
      const label = node ? A.findLabel(node.getAttribute('data-label')) : null;
      if (label) RP.dialogs.labelDialog(label);
    });

    // ---- Keyboard ----
    window.addEventListener('keydown', function (e) {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        const k = e.key.toLowerCase();
        if (k === 'z' && !e.shiftKey) { e.preventDefault(); RP.app.undo(); }
        else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); RP.app.redo(); }
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const ui = S.get().ui;
      const sel = A.selectedPiece();
      const selOp = A.selectedOpening();
      const selLabel = A.selectedLabel();

      if (ARROWS[e.key] && selLabel && ui.tool === 'select') {
        e.preventDefault();
        const step = e.shiftKey ? 6 : 1;
        A.updateLabel(selLabel.id, { x: selLabel.x + ARROWS[e.key][0] * step, y: selLabel.y + ARROWS[e.key][1] * step },
          { coalesce: 'nudge:' + selLabel.id, windowMs: 800 });
      } else if (ARROWS[e.key] && selOp && ui.tool === 'select') {
        // Arrow keys slide a door or window along its wall
        e.preventDefault();
        const f = RP.openings.wallFrame(S.room(), selOp.wall);
        const dir = ARROWS[e.key][0] * f.a.x + ARROWS[e.key][1] * f.a.y;
        if (dir) A.updateOpening(selOp.id, { offset: selOp.offset + dir * (e.shiftKey ? 6 : 1) },
          { coalesce: 'nudge:' + selOp.id, windowMs: 800 });
      } else if (ARROWS[e.key] && sel && ui.tool === 'select') {
        e.preventDefault();
        const step = e.shiftKey ? 6 : 1;
        A.movePiece(sel.id, sel.x + ARROWS[e.key][0] * step, sel.y + ARROWS[e.key][1] * step,
          { coalesce: 'nudge:' + sel.id, windowMs: 800 });
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (sel || selOp || selLabel) {
          e.preventDefault();
          A.deleteSelected();
        } else if (ui.selectedVertex !== null) {
          e.preventDefault();
          if (!RP.roomedit.deleteVertex(ui.selectedVertex)) {
            RP.fields.message(S.room().squareCorners ? 'That corner cannot be removed without crossing walls. Untick "Keep corners square" to remove it freely.'
              : 'A room needs at least 3 corners, and its walls cannot cross.');
          }
        }
      } else if (e.key === 'Escape') {
        if (ui.tool === 'measure') {
          if (ui.measure) S.setUi({ measure: null });
          else S.setUi({ tool: 'select' });
        } else {
          A.select(null);
        }
      } else if ((e.key === 'r' || e.key === 'R') && sel) {
        e.preventDefault();
        A.rotatePiece(sel.id, e.shiftKey ? -1 : 1);
      }
    });
  }

  RP.interact = { init: init };
})(window.RP = window.RP || {});
