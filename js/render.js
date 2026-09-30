// Draws the state into the SVG canvas and the scale bar. Reads state, never changes it.
(function (RP) {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const LABEL_PX = 13;       // wall label text size on screen
  const LABEL_GAP_PX = 10;   // space between wall and its label
  const MIN_GRID_PX = 6;     // hide grid lines packed tighter than this
  const SCALE_MAX_PX = 140;  // longest scale bar

  const PIECE_LABEL_PX = 11; // furniture name text size on screen

  const HANDLE_PX = 10;      // visible size of a resize handle
  const HANDLE_HIT_PX = 28;  // touch-friendly hit area

  const VERTEX_PX = 6;       // visible radius of a room corner handle
  const VERTEX_HIT_PX = 14;  // and its hit area
  const MIN_LABELED_EDGE_PX = 44; // walls shorter than this on screen get no length label

  let svg, roomG, floor, clipPath, gridG, gridMinor, gridMajor, furnG, handlesG, wall, openingsG, vertexG, labelsG, overlayG;
  let scaleBar, scaleLabel, gridLabel;
  let gridKey = '';

  function make(name, attrs, parent) {
    const node = document.createElementNS(NS, name);
    if (attrs) Object.keys(attrs).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    if (parent) parent.appendChild(node);
    return node;
  }

  function init(svgEl) {
    svg = svgEl;
    // The grid is clipped to the room's outline, so it also fits L-shapes and other polygons.
    const defs = make('defs', null, svg);
    const clip = make('clipPath', { id: 'room-clip' }, defs);
    clipPath = make('path', null, clip);
    roomG = make('g', null, svg);
    floor = make('path', { class: 'floor' }, roomG);
    gridG = make('g', { 'clip-path': 'url(#room-clip)' }, roomG);
    gridMinor = make('path', { class: 'grid-minor' }, gridG);
    gridMajor = make('path', { class: 'grid-major' }, gridG);
    furnG = make('g', { class: 'furniture' }, roomG);
    handlesG = make('g', { class: 'handles' }, roomG);
    wall = make('path', { class: 'wall' }, roomG);
    openingsG = make('g', { class: 'openings' }, roomG);
    vertexG = make('g', { class: 'vertices' }, roomG);
    labelsG = make('g', { class: 'wall-labels' }, roomG);
    overlayG = make('g', { class: 'overlay' }, roomG);
    scaleBar = document.getElementById('scale-bar');
    scaleLabel = document.getElementById('scale-label');
    gridLabel = document.getElementById('grid-label');
  }

  function getSize() {
    return { w: svg.clientWidth, h: svg.clientHeight };
  }

  // Grid lines at every `step` inches; lines on whole feet are the heavier "major" ones.
  function gridPaths(b, step) {
    let minor = '';
    let major = '';
    for (let i = Math.ceil((b.minX + 1e-9) / step); i * step < b.maxX - 1e-9; i++) {
      const x = i * step;
      const seg = 'M' + x + ' ' + b.minY + 'V' + b.maxY;
      if (x % 12 === 0) major += seg; else minor += seg;
    }
    for (let j = Math.ceil((b.minY + 1e-9) / step); j * step < b.maxY - 1e-9; j++) {
      const y = j * step;
      const seg = 'M' + b.minX + ' ' + y + 'H' + b.maxX;
      if (y % 12 === 0) major += seg; else minor += seg;
    }
    return { minor: minor, major: major };
  }

  function polygonPath(pts) {
    return pts.map(function (p, i) { return (i ? 'L' : 'M') + p.x + ' ' + p.y; }).join('') + 'Z';
  }

  // A length label beside each wall, turned to run along it, kept a constant size on screen.
  function drawWallLabels(room, units, view) {
    while (labelsG.firstChild) labelsG.removeChild(labelsG.firstChild);
    const px = 1 / view.ppi;
    const fs = LABEL_PX * px;
    RP.openings.wallKeys(room).forEach(function (key) {
      const f = RP.openings.wallFrame(room, key);
      if (f.length * view.ppi < MIN_LABELED_EDGE_PX) return;
      const off = LABEL_GAP_PX * px + fs * 0.65;
      const x = f.start.x + f.a.x * f.length / 2 - f.n.x * off; // outside the room: against the inward normal
      const y = f.start.y + f.a.y * f.length / 2 - f.n.y * off;
      let angle = Math.atan2(f.a.y, f.a.x) * 180 / Math.PI;
      if (angle > 90) angle -= 180;
      if (angle <= -90) angle += 180;
      const t = make('text', { class: 'wall-label', x: x, y: y, 'font-size': fs, dy: '0.35em',
        transform: 'rotate(' + angle + ' ' + x + ' ' + y + ')' }, labelsG);
      t.textContent = RP.units.formatLength(f.length, units);
    });
  }

  // Corner handles for a polygon room (drag to move, click a wall's + to add a corner).
  function drawVertexHandles(state) {
    while (vertexG.firstChild) vertexG.removeChild(vertexG.firstChild);
    const room = state.project.rooms[0];
    const ui = state.ui;
    if (!RP.roomgeo.isPolygon(room) || ui.tool !== 'select' || ui.selectedId || ui.selectedOpeningId) return;
    const px = 1 / state.view.ppi;
    RP.roomgeo.edges(room).forEach(function (e) {
      if (e.length * state.view.ppi < 70) return;
      const mx = (e.a.x + e.b.x) / 2;
      const my = (e.a.y + e.b.y) / 2;
      const g = make('g', { class: 'vertex-add', 'data-addvertex': e.index }, vertexG);
      make('circle', { class: 'vertex-hit', cx: mx, cy: my, r: VERTEX_HIT_PX * px }, g);
      make('circle', { class: 'vertex-add-dot', cx: mx, cy: my, r: 6 * px }, g);
      make('path', { class: 'vertex-add-plus', d: 'M' + (mx - 3 * px) + ' ' + my + 'H' + (mx + 3 * px) +
        'M' + mx + ' ' + (my - 3 * px) + 'V' + (my + 3 * px) }, g);
    });
    room.points.forEach(function (p, i) {
      const g = make('g', { class: 'vertex' + (ui.selectedVertex === i ? ' selected' : ''), 'data-vertex': i }, vertexG);
      make('circle', { class: 'vertex-hit', cx: p.x, cy: p.y, r: VERTEX_HIT_PX * px }, g);
      make('circle', { class: 'vertex-dot', cx: p.x, cy: p.y, r: VERTEX_PX * px }, g);
    });
  }

  // Rugs ("floor" layer) draw first so everything else sits on top of them.
  function drawFurniture(state) {
    const project = state.project;
    const ppi = state.view.ppi;
    const list = project.rooms[0].furniture;
    const ordered = list.filter(function (f) { return f.layer === 'floor'; })
      .concat(list.filter(function (f) { return f.layer !== 'floor'; }));

    const overlapIds = RP.checks.forState(state).overlapIds;

    while (furnG.firstChild) furnG.removeChild(furnG.firstChild);
    ordered.forEach(function (f) {
      const overlapping = !!overlapIds[f.id];
      const g = make('g', {
        class: 'piece' + (f.id === state.ui.selectedId ? ' selected' : '') + (f.locked ? ' locked' : '') +
          (overlapping ? ' overlap' : ''),
        'data-id': f.id,
        transform: 'translate(' + f.x + ' ' + f.y + ') rotate(' + f.rotation + ')',
      }, furnG);

      const shape = f.shape === 'circle'
        ? make('circle', { r: f.width / 2 }, g)
        : make('rect', { x: -f.width / 2, y: -f.depth / 2, width: f.width, height: f.depth }, g);
      shape.setAttribute('class', 'piece-shape');
      shape.setAttribute('fill', RP.library.colorOf(project, f));
      if (overlapping) {
        // Red tint on top of the piece's own color
        const tint = f.shape === 'circle'
          ? make('circle', { r: f.width / 2 }, g)
          : make('rect', { x: -f.width / 2, y: -f.depth / 2, width: f.width, height: f.depth }, g);
        tint.setAttribute('class', 'overlap-tint');
      }

      // Name, kept upright and a constant size on screen; hidden when the piece is too small.
      const fitPx = Math.min(f.width, f.depth) * ppi;
      const maxChars = Math.floor(Math.max(f.width, f.depth) * ppi / 6.5);
      if (fitPx >= 18 && maxChars >= 3) {
        const text = make('text', {
          class: 'piece-label',
          'font-size': PIECE_LABEL_PX / ppi,
          dy: '0.35em',
          transform: 'rotate(' + (-f.rotation) + ')',
        }, g);
        text.textContent = f.name.length > maxChars ? f.name.slice(0, maxChars - 1) + '…' : f.name;
      }
    });
  }

  // Four corner handles on the selected piece, turned with it. Locked pieces get none.
  function drawHandles(state) {
    while (handlesG.firstChild) handlesG.removeChild(handlesG.firstChild);
    const f = RP.actions.selectedPiece();
    if (!f || f.locked) return;
    const px = 1 / state.view.ppi;
    const g = make('g', { transform: 'translate(' + f.x + ' ' + f.y + ') rotate(' + f.rotation + ')' }, handlesG);
    [['nw', -1, -1], ['ne', 1, -1], ['se', 1, 1], ['sw', -1, 1]].forEach(function (h) {
      const hg = make('g', { class: 'handle', 'data-handle': h[0] }, g);
      const cx = h[1] * f.width / 2;
      const cy = h[2] * f.depth / 2;
      make('rect', { class: 'handle-hit', x: cx - HANDLE_HIT_PX * px / 2, y: cy - HANDLE_HIT_PX * px / 2,
        width: HANDLE_HIT_PX * px, height: HANDLE_HIT_PX * px }, hg);
      make('rect', { class: 'handle-dot', x: cx - HANDLE_PX * px / 2, y: cy - HANDLE_PX * px / 2,
        width: HANDLE_PX * px, height: HANDLE_PX * px }, hg);
    });
  }

  // The four walls as line segments, leaving a gap wherever a door, window or doorway sits.
  function wallPath(room) {
    let d = '';
    RP.openings.wallKeys(room).forEach(function (name) {
      const f = RP.openings.wallFrame(room, name);
      const gaps = room.openings.filter(function (o) { return o.wall === name; })
        .map(function (o) { return [o.offset, o.offset + o.width]; })
        .sort(function (a, b) { return a[0] - b[0]; });
      const seg = function (from, to) {
        if (to - from < 1e-6) return;
        const a = { x: f.start.x + f.a.x * from, y: f.start.y + f.a.y * from };
        const b = { x: f.start.x + f.a.x * to, y: f.start.y + f.a.y * to };
        d += 'M' + a.x + ' ' + a.y + 'L' + b.x + ' ' + b.y;
      };
      let cursor = 0;
      gaps.forEach(function (g) {
        seg(cursor, g[0]);
        cursor = Math.max(cursor, g[1]);
      });
      seg(cursor, f.length);
    });
    return d;
  }

  function openingLine(parent, p, q, cls) {
    return make('line', { class: cls, x1: p.x, y1: p.y, x2: q.x, y2: q.y }, parent);
  }

  // Doors (leaf and swing arc), windows and doorways, drawn over the gaps in the wall.
  function drawOpenings(state) {
    while (openingsG.firstChild) openingsG.removeChild(openingsG.firstChild);
    const room = state.project.rooms[0];
    const blocked = RP.checks.forState(state).blockedDoors;
    room.openings.forEach(function (op) {
      const e = RP.openings.ends(room, op);
      const g = make('g', {
        class: 'opening opening-' + op.type + (op.id === state.ui.selectedOpeningId ? ' selected' : ''),
        'data-opening': op.id,
      }, openingsG);

      if (op.type === 'door') {
        const s = RP.openings.swingOf(room, op);
        const cross = (s.closedEnd.x - s.hinge.x) * (s.openEnd.y - s.hinge.y) - (s.closedEnd.y - s.hinge.y) * (s.openEnd.x - s.hinge.x);
        const sweep = cross > 0 ? 1 : 0;
        const arc = 'A' + op.width + ' ' + op.width + ' 0 0 ' + sweep + ' ';
        make('path', {
          class: 'door-swing' + (blocked[op.id] ? ' blocked' : ''),
          d: 'M' + s.hinge.x + ' ' + s.hinge.y + 'L' + s.closedEnd.x + ' ' + s.closedEnd.y + arc + s.openEnd.x + ' ' + s.openEnd.y + 'Z',
        }, g);
        openingLine(g, s.hinge, s.openEnd, 'door-leaf');
      } else if (op.type === 'window') {
        openingLine(g, e.p0, e.p1, 'window-glass');
        openingLine(g, e.p0, e.p1, 'window-core');
      } else {
        openingLine(g, e.p0, e.p1, 'doorway-line');
      }
      openingLine(g, e.p0, e.p1, 'opening-hit'); // fat invisible line so the gap is easy to click
    });
  }

  function line(x1, y1, x2, y2, cls) {
    return make('line', { class: cls, x1: x1, y1: y1, x2: x2, y2: y2 }, overlayG);
  }

  // Text with a background-colored outline so it stays readable over pieces and grid.
  function overlayText(text, x, y, px, size, cls) {
    const t = make('text', { class: 'dim-label ' + (cls || ''), x: x, y: y, 'font-size': size * px,
      'stroke-width': 3 * px, dy: '0.35em' }, overlayG);
    t.textContent = text;
    return t;
  }

  // Snap guides, distances from the selected piece to each wall, and the measure tool.
  function drawOverlay(state) {
    while (overlayG.firstChild) overlayG.removeChild(overlayG.firstChild);
    const room = state.project.rooms[0];
    const units = state.project.units;
    const px = 1 / state.view.ppi;
    const fmt = function (n) { return RP.units.formatLength(n, units); };

    state.ui.guides.forEach(function (g) {
      if (g.axis === 'x') line(g.pos, 0, g.pos, room.length, 'guide');
      else line(0, g.pos, room.width, g.pos, 'guide');
    });

    RP.checks.forState(state).gaps.forEach(function (gap) {
      line(gap.a.x, gap.a.y, gap.b.x, gap.b.y, 'gap-line');
      overlayText(fmt(gap.distance), (gap.a.x + gap.b.x) / 2, (gap.a.y + gap.b.y) / 2, px, 11, 'gap-text');
    });

    if (state.ui.hoverEdge !== null && RP.roomgeo.isPolygon(room)) {
      const e = RP.roomgeo.edges(room)[state.ui.hoverEdge];
      if (e) line(e.a.x, e.a.y, e.b.x, e.b.y, 'edge-hover');
    }

    const piece = state.ui.tool === 'select' ? RP.actions.selectedPiece() : null;
    if (piece) {
      const d = RP.roomgeo.wallDistances(piece, room);
      Object.keys(d).forEach(function (side) {
        if (!d[side] || Math.abs(d[side].distance) < 0.05) return; // no wall that way, or touching it
        const from = d[side].from;
        const to = d[side].to;
        line(from.x, from.y, to.x, to.y, 'dim-line');
        overlayText(fmt(d[side].distance), (from.x + to.x) / 2, (from.y + to.y) / 2, px, 11, '');
      });
    }

    const m = state.ui.measure;
    if (m && m.a) {
      const end = m.b || m.hover;
      const dot = function (p) { make('circle', { class: 'measure-dot', cx: p.x, cy: p.y, r: 4 * px }, overlayG); };
      if (end) {
        line(m.a.x, m.a.y, end.x, end.y, 'measure-line');
        dot(end);
        overlayText(fmt(Math.hypot(end.x - m.a.x, end.y - m.a.y)),
          (m.a.x + end.x) / 2, (m.a.y + end.y) / 2 - 12 * px, px, 14, 'measure-text');
      }
      dot(m.a);
    }
  }

  function draw(state) {
    const size = getSize();
    if (!size.w || !size.h) return;

    const project = state.project;
    const room = project.rooms[0];
    const view = state.view;
    const units = project.units;
    const U = RP.units;
    const px = 1 / view.ppi; // one screen pixel, in inches

    svg.setAttribute('viewBox', RP.geometry.viewBoxFor(view, size).join(' '));
    roomG.setAttribute('transform', 'translate(' + room.x + ' ' + room.y + ')');

    const outline = RP.roomgeo.outline(room);
    const outlineD = polygonPath(outline);
    floor.setAttribute('d', outlineD);
    clipPath.setAttribute('d', outlineD);
    wall.setAttribute('d', wallPath(room));
    drawOpenings(state);

    // Grid
    const step = state.ui.gridSize;
    const minorOn = step * view.ppi >= MIN_GRID_PX;
    const majorOn = 12 * view.ppi >= MIN_GRID_PX;
    const box = RP.roomgeo.bbox(outline);
    const key = [box.minX, box.minY, box.maxX, box.maxY, step].join('|');
    if (key !== gridKey) {
      const paths = gridPaths(box, step);
      gridMinor.setAttribute('d', paths.minor);
      gridMajor.setAttribute('d', paths.major);
      gridKey = key;
    }
    gridMinor.style.display = minorOn ? '' : 'none';
    gridMajor.style.display = majorOn ? '' : 'none';

    drawFurniture(state);
    drawHandles(state);
    drawVertexHandles(state);
    drawOverlay(state);
    drawWallLabels(room, units, view);

    // Scale bar (HTML overlay, bottom-left) and grid-size label
    const inches = RP.geometry.niceScaleInches(view.ppi, units, SCALE_MAX_PX);
    scaleBar.style.width = (inches * view.ppi) + 'px';
    scaleLabel.textContent = U.formatLength(inches, units);
    gridLabel.textContent = 'Grid: ' + step + '"';
  }

  RP.render = { init: init, draw: draw, getSize: getSize };
})(window.RP = window.RP || {});
