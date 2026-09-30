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

    // Pointer position in room inches (origin at the room's top-left corner)
    function worldAt(e) {
      const r = svg.getBoundingClientRect();
      const w = RP.geometry.screenToWorld(S.get().view, RP.render.getSize(), e.clientX - r.left, e.clientY - r.top);
      const room = S.get().project.rooms[0];
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

    function doResize(w) {
      const d = { x: w.x - drag.opp.x, y: w.y - drag.opp.y };
      let width = Math.max(MIN_PIECE_IN, (d.x * drag.u.x + d.y * drag.u.y) * drag.c[0]);
      let depth = Math.max(MIN_PIECE_IN, (d.x * drag.v.x + d.y * drag.v.y) * drag.c[1]);
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
      const room = S.get().project.rooms[0];
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

    // ---- Measure tool ----
    function measurePoint(e) {
      const pt = worldAt(e);
      if (!snapping(e)) return pt;
      const room = S.get().project.rooms[0];
      return RP.snap.snapPoint(pt, room, room.furniture, S.get().ui.gridSize, snapThreshold());
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
      if (drag.kind === 'resize') doResize(w);
      else doMove(e, w);
    });

    function end(e) {
      if (tap && e.pointerId === tap.id) {
        const moved = Math.hypot(e.clientX - tap.x, e.clientY - tap.y);
        tap = null;
        if (e.type === 'pointerup' && moved <= TAP_SLOP_PX) placeMeasurePoint(e);
      }
      if (drag && e.pointerId === drag.pointerId) {
        drag = null;
        clearGuides();
      }
    }
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', end);

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

      if (ARROWS[e.key] && sel && ui.tool === 'select') {
        e.preventDefault();
        const step = e.shiftKey ? 6 : 1;
        A.movePiece(sel.id, sel.x + ARROWS[e.key][0] * step, sel.y + ARROWS[e.key][1] * step,
          { coalesce: 'nudge:' + sel.id, windowMs: 800 });
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (sel) {
          e.preventDefault();
          A.deleteSelected();
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
