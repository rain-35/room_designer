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

  let svg, roomG, floor, gridMinor, gridMajor, furnG, handlesG, wall, overlayG;
  let labels = {};
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
    roomG = make('g', null, svg);
    floor = make('rect', { class: 'floor' }, roomG);
    gridMinor = make('path', { class: 'grid-minor' }, roomG);
    gridMajor = make('path', { class: 'grid-major' }, roomG);
    furnG = make('g', { class: 'furniture' }, roomG);
    handlesG = make('g', { class: 'handles' }, roomG);
    wall = make('rect', { class: 'wall' }, roomG);
    ['top', 'bottom', 'left', 'right'].forEach(function (side) {
      labels[side] = make('text', { class: 'wall-label' }, roomG);
    });
    overlayG = make('g', { class: 'overlay' }, roomG);
    scaleBar = document.getElementById('scale-bar');
    scaleLabel = document.getElementById('scale-label');
    gridLabel = document.getElementById('grid-label');
  }

  function getSize() {
    return { w: svg.clientWidth, h: svg.clientHeight };
  }

  // Grid lines at every `step` inches; lines on whole feet are the heavier "major" ones.
  function gridPaths(room, step) {
    let minor = '';
    let major = '';
    const maxI = Math.floor(room.width / step + 1e-9);
    for (let i = 1; i <= maxI; i++) {
      const x = i * step;
      if (x >= room.width) break;
      const seg = 'M' + x + ' 0V' + room.length;
      if (x % 12 === 0) major += seg; else minor += seg;
    }
    const maxJ = Math.floor(room.length / step + 1e-9);
    for (let j = 1; j <= maxJ; j++) {
      const y = j * step;
      if (y >= room.length) break;
      const seg = 'M0 ' + y + 'H' + room.width;
      if (y % 12 === 0) major += seg; else minor += seg;
    }
    return { minor: minor, major: major };
  }

  function setText(node, text, x, y, fontSize, rotate) {
    node.textContent = text;
    node.setAttribute('x', x);
    node.setAttribute('y', y);
    node.setAttribute('font-size', fontSize);
    if (rotate) node.setAttribute('transform', 'rotate(' + rotate + ' ' + x + ' ' + y + ')');
    else node.removeAttribute('transform');
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

    const piece = state.ui.tool === 'select' ? RP.actions.selectedPiece() : null;
    if (piece) {
      const d = RP.geometry.wallDistances(piece, room);
      Object.keys(d).forEach(function (side) {
        const dist = d[side].distance;
        if (Math.abs(dist) < 0.05) return; // touching the wall
        const from = d[side].from;
        let to;
        if (side === 'left') to = { x: 0, y: from.y };
        else if (side === 'right') to = { x: room.width, y: from.y };
        else if (side === 'top') to = { x: from.x, y: 0 };
        else to = { x: from.x, y: room.length };
        line(from.x, from.y, to.x, to.y, 'dim-line');
        overlayText(fmt(dist), (from.x + to.x) / 2, (from.y + to.y) / 2, px, 11, '');
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

    floor.setAttribute('width', room.width);
    floor.setAttribute('height', room.length);
    wall.setAttribute('width', room.width);
    wall.setAttribute('height', room.length);

    // Grid
    const step = state.ui.gridSize;
    const minorOn = step * view.ppi >= MIN_GRID_PX;
    const majorOn = 12 * view.ppi >= MIN_GRID_PX;
    const key = [room.width, room.length, step].join('|');
    if (key !== gridKey) {
      const paths = gridPaths(room, step);
      gridMinor.setAttribute('d', paths.minor);
      gridMajor.setAttribute('d', paths.major);
      gridKey = key;
    }
    gridMinor.style.display = minorOn ? '' : 'none';
    gridMajor.style.display = majorOn ? '' : 'none';

    drawFurniture(state);
    drawHandles(state);
    drawOverlay(state);

    // Wall labels: constant size on screen, so sized in inches from the zoom.
    const fs = LABEL_PX * px;
    const gap = LABEL_GAP_PX * px;
    const widthText = U.formatLength(room.width, units);
    const lengthText = U.formatLength(room.length, units);
    setText(labels.top, widthText, room.width / 2, -gap, fs);
    setText(labels.bottom, widthText, room.width / 2, room.length + gap + fs * 0.75, fs);
    setText(labels.left, lengthText, -gap, room.length / 2, fs, -90);
    setText(labels.right, lengthText, room.width + gap, room.length / 2, fs, 90);

    // Scale bar (HTML overlay, bottom-left) and grid-size label
    const inches = RP.geometry.niceScaleInches(view.ppi, units, SCALE_MAX_PX);
    scaleBar.style.width = (inches * view.ppi) + 'px';
    scaleLabel.textContent = U.formatLength(inches, units);
    gridLabel.textContent = 'Grid: ' + step + '"';
  }

  RP.render = { init: init, draw: draw, getSize: getSize };
})(window.RP = window.RP || {});
