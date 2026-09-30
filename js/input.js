// Zoom and pan: wheel/pinch to zoom, space+drag / middle-drag / two fingers to pan.
(function (RP) {
  'use strict';

  function init(svg) {
    const G = RP.geometry;
    const S = RP.state;
    const pointers = new Map(); // pointerId -> {x, y} in canvas pixels
    let spaceDown = false;
    let panLast = null;
    let pinch = null;

    function local(e) {
      const r = svg.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    function zoomAt(pt, factor) {
      const view = S.get().view;
      const size = RP.render.getSize();
      const world = G.screenToWorld(view, size, pt.x, pt.y);
      S.setView(G.anchorView(view, size, world, pt.x, pt.y, G.clampPpi(view.ppi * factor)));
    }

    function zoomBy(factor) {
      const size = RP.render.getSize();
      zoomAt({ x: size.w / 2, y: size.h / 2 }, factor);
    }

    function fit() {
      const size = RP.render.getSize();
      S.setView(G.fitView(size, S.room()));
    }

    // Show every room in the layout
    function fitHouse() {
      const size = RP.render.getSize();
      S.setView(G.fitBox(size, RP.rooms.houseBox(S.get().project)));
    }

    svg.addEventListener('wheel', function (e) {
      e.preventDefault();
      let dy = e.deltaY;
      if (e.deltaMode === 1) dy *= 16;
      else if (e.deltaMode === 2) dy *= 400;
      const speed = e.ctrlKey ? 0.01 : 0.0015; // ctrl = trackpad pinch
      zoomAt(local(e), Math.exp(-dy * speed));
    }, { passive: false });

    svg.addEventListener('pointerdown', function (e) {
      pointers.set(e.pointerId, local(e));
      try { svg.setPointerCapture(e.pointerId); } catch (err) { /* pointer already gone */ }
      if (pointers.size === 2) {
        const pts = Array.from(pointers.values());
        panLast = null;
        svg.classList.remove('panning');
        pinch = {
          mid: { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 },
          dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
        };
      } else if (pointers.size === 1 && (e.button === 1 || spaceDown)) {
        e.preventDefault();
        panLast = local(e);
        svg.classList.add('panning');
      }
    });

    svg.addEventListener('pointermove', function (e) {
      if (!pointers.has(e.pointerId)) return;
      const p = local(e);
      pointers.set(e.pointerId, p);
      const view = S.get().view;
      const size = RP.render.getSize();

      if (pointers.size === 2 && pinch) {
        const pts = Array.from(pointers.values());
        const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        if (pinch.dist > 0 && dist > 0) {
          const world = G.screenToWorld(view, size, pinch.mid.x, pinch.mid.y);
          const ppi = G.clampPpi(view.ppi * dist / pinch.dist);
          S.setView(G.anchorView(view, size, world, mid.x, mid.y, ppi));
        }
        pinch = { mid: mid, dist: dist };
      } else if (panLast) {
        const world = G.screenToWorld(view, size, panLast.x, panLast.y);
        S.setView(G.anchorView(view, size, world, p.x, p.y, view.ppi));
        panLast = p;
      }
    });

    function release(e) {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (pointers.size === 0) {
        panLast = null;
        svg.classList.remove('panning');
      }
    }
    svg.addEventListener('pointerup', release);
    svg.addEventListener('pointercancel', release);

    function typingTarget(t) {
      return t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.tagName === 'BUTTON');
    }
    window.addEventListener('keydown', function (e) {
      if (e.code === 'Space' && !typingTarget(e.target)) {
        e.preventDefault();
        spaceDown = true;
        svg.classList.add('can-pan');
      }
    });
    window.addEventListener('keyup', function (e) {
      if (e.code === 'Space') {
        spaceDown = false;
        svg.classList.remove('can-pan');
      }
    });
    window.addEventListener('blur', function () {
      spaceDown = false;
      svg.classList.remove('can-pan');
    });

    return {
      zoomBy: zoomBy,
      fit: fit,
      fitHouse: fitHouse,
      spaceDown: function () { return spaceDown; },
      pointerCount: function () { return pointers.size; },
    };
  }

  RP.input = { init: init };
})(window.RP = window.RP || {});
