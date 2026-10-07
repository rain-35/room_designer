// Draws the state into the SVG canvas and the scale bar. Reads state, never changes it.
// Every room has its own group (its own coordinates, moved to the room's place in the house);
// the room being edited is drawn last, so it sits on top.
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
  const TAG_FONT_PX = 12;    // room name tag

  const FLOAT_LABEL_PX = { small: 12, medium: 16, large: 24 }; // floating label text size on screen
  const ROOM_NAME_PX = 14;   // room name shown inside the room

  let svg, housesG, labelsG, houseOverlayG;
  let scaleBar, scaleLabel, gridLabel;
  const views = {};          // room id -> the room's drawing nodes
  let orderKey = '';

  function make(name, attrs, parent) {
    const node = document.createElementNS(NS, name);
    if (attrs) Object.keys(attrs).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    if (parent) parent.appendChild(node);
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function init(svgEl) {
    svg = svgEl;
    make('defs', null, svg);
    housesG = make('g', null, svg);
    labelsG = make('g', { class: 'float-labels' }, svg); // floating text notes, above the rooms
    houseOverlayG = make('g', { class: 'overlay' }, svg); // things in house coordinates (the measure tool)
    scaleBar = document.getElementById('scale-bar');
    scaleLabel = document.getElementById('scale-label');
    gridLabel = document.getElementById('grid-label');
  }

  function getSize() {
    return { w: svg.clientWidth, h: svg.clientHeight };
  }

  // The drawing nodes for one room, made the first time the room is seen.
  function viewFor(room) {
    let rv = views[room.id];
    if (rv) return rv;
    const clipId = 'clip-' + room.id;
    const defs = svg.querySelector('defs');
    const clip = make('clipPath', { id: clipId }, defs);
    rv = views[room.id] = { id: room.id, gridKey: '', clip: clip, clipPath: make('path', null, clip) };
    rv.g = make('g', { 'data-room': room.id }, housesG);
    rv.floor = make('path', { class: 'floor' }, rv.g);
    rv.gridG = make('g', { 'clip-path': 'url(#' + clipId + ')' }, rv.g);
    rv.gridMinor = make('path', { class: 'grid-minor' }, rv.gridG);
    rv.gridMajor = make('path', { class: 'grid-major' }, rv.gridG);
    rv.wallHitG = make('g', { class: 'wall-hits' }, rv.g); // under the furniture, so pieces beside a wall stay grabbable
    rv.furnG = make('g', { class: 'furniture' }, rv.g);
    rv.handlesG = make('g', { class: 'handles' }, rv.g);
    rv.wall = make('path', { class: 'wall' }, rv.g);
    rv.openingsG = make('g', { class: 'openings' }, rv.g);
    rv.vertexG = make('g', { class: 'vertices' }, rv.g);
    rv.infoG = make('g', { class: 'room-info' }, rv.g);
    rv.labelsG = make('g', { class: 'wall-labels' }, rv.g);
    rv.overlayG = make('g', { class: 'overlay' }, rv.g);
    return rv;
  }

  function dropView(id) {
    const rv = views[id];
    if (!rv) return;
    housesG.removeChild(rv.g);
    rv.clip.parentNode.removeChild(rv.clip);
    delete views[id];
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
  function drawWallLabels(rv, room, units, view) {
    clear(rv.labelsG);
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
        transform: 'rotate(' + angle + ' ' + x + ' ' + y + ')' }, rv.labelsG);
      t.textContent = RP.units.formatLength(f.length, units);
    });
  }

  // Corner handles for a polygon room (drag to move, click a wall's + to add a corner).
  function drawVertexHandles(rv, room, state, active) {
    clear(rv.vertexG);
    clear(rv.wallHitG);
    const ui = state.ui;
    if (!active || !RP.roomgeo.isPolygon(room) || ui.tool !== 'select' || ui.selectedId || ui.selectedOpeningId) return;
    const px = 1 / state.view.ppi;
    // Fat invisible lines along each wall: drag one to move the whole wall
    RP.roomgeo.edges(room).forEach(function (e) {
      const dir = Math.abs(e.n.x) > 0.999 ? 'ew-resize' : Math.abs(e.n.y) > 0.999 ? 'ns-resize' : 'move';
      make('line', { class: 'wall-hit', 'data-wall': e.index, x1: e.a.x, y1: e.a.y, x2: e.b.x, y2: e.b.y,
        'stroke-width': 14 * px, style: 'cursor:' + dir }, rv.wallHitG);
    });
    RP.roomgeo.edges(room).forEach(function (e) {
      if (e.length * state.view.ppi < 70) return;
      const mx = (e.a.x + e.b.x) / 2;
      const my = (e.a.y + e.b.y) / 2;
      const g = make('g', { class: 'vertex-add', 'data-addvertex': e.index }, rv.vertexG);
      make('circle', { class: 'vertex-hit', cx: mx, cy: my, r: VERTEX_HIT_PX * px }, g);
      make('circle', { class: 'vertex-add-dot', cx: mx, cy: my, r: 6 * px }, g);
      make('path', { class: 'vertex-add-plus', d: 'M' + (mx - 3 * px) + ' ' + my + 'H' + (mx + 3 * px) +
        'M' + mx + ' ' + (my - 3 * px) + 'V' + (my + 3 * px) }, g);
    });
    room.points.forEach(function (p, i) {
      const g = make('g', { class: 'vertex' + (ui.selectedVertex === i ? ' selected' : ''), 'data-vertex': i }, rv.vertexG);
      make('circle', { class: 'vertex-hit', cx: p.x, cy: p.y, r: VERTEX_HIT_PX * px }, g);
      make('circle', { class: 'vertex-dot', cx: p.x, cy: p.y, r: VERTEX_PX * px }, g);
    });
  }

  // With several rooms: the room's name tag (drag it to move the room) and its area.
  function drawRoomInfo(rv, room, state, active) {
    clear(rv.infoG);
    const project = state.project;
    const px = 1 / state.view.ppi;
    const units = project.units;

    // The room's name in the middle (or wherever the user dragged it), to tell odd shapes apart
    let nameAt = null;
    if (room.showName) {
      nameAt = room.nameAt || RP.roomgeo.interiorPoint(room);
      const ng = make('g', { class: 'room-name', 'data-roomname': room.id }, rv.infoG);
      const hw = (room.name.length * ROOM_NAME_PX * 0.3 + 6) * px;
      make('rect', { class: 'room-name-hit', x: nameAt.x - hw, y: nameAt.y - 12 * px, width: hw * 2, height: 24 * px }, ng);
      const nt = make('text', { x: nameAt.x, y: nameAt.y, 'font-size': ROOM_NAME_PX * px, dy: '0.35em' }, ng);
      nt.textContent = room.name;
    }

    if (project.rooms.length < 2) return;

    if (Math.min(room.width, room.length) * state.view.ppi >= 70) {
      const spot = nameAt ? { x: nameAt.x, y: nameAt.y + 18 * px } : RP.roomgeo.interiorPoint(room);
      const t = make('text', { class: 'room-area', x: spot.x, y: spot.y, 'font-size': 15 * px, dy: '0.35em' }, rv.infoG);
      t.textContent = RP.units.formatAreaSq(RP.roomgeo.area(room), units);
    }

    const label = room.name;
    const w = (label.length * 6.9 + 16) * px;
    const h = 20 * px;
    const g = make('g', { class: 'room-tag' + (active ? ' active' : ''), 'data-roomtag': room.id }, rv.infoG);
    make('rect', { x: 6 * px, y: 6 * px, width: w, height: h, rx: 4 * px }, g);
    const text = make('text', { x: 6 * px + 8 * px, y: 6 * px + h / 2, 'font-size': TAG_FONT_PX * px, dy: '0.35em' }, g);
    text.textContent = label;
  }

  // Rugs ("floor" layer) draw first so everything else sits on top of them.
  function drawFurniture(rv, room, state) {
    const project = state.project;
    const ppi = state.view.ppi;
    const list = room.furniture;
    const ordered = list.filter(function (f) { return f.layer === 'floor'; })
      .concat(list.filter(function (f) { return f.layer !== 'floor'; }));

    const overlapIds = RP.checks.forState(state).overlapIds;

    clear(rv.furnG);
    ordered.forEach(function (f) {
      const overlapping = !!overlapIds[f.id];
      const g = make('g', {
        class: 'piece' + (f.id === state.ui.selectedId ? ' selected' : '') + (f.locked ? ' locked' : '') +
          (overlapping ? ' overlap' : ''),
        'data-id': f.id,
        transform: 'translate(' + f.x + ' ' + f.y + ') rotate(' + f.rotation + ')',
      }, rv.furnG);

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
  function drawHandles(rv, state, active) {
    clear(rv.handlesG);
    if (!active) return;
    const f = RP.actions.selectedPiece();
    if (!f || f.locked) return;
    const px = 1 / state.view.ppi;
    const g = make('g', { transform: 'translate(' + f.x + ' ' + f.y + ') rotate(' + f.rotation + ')' }, rv.handlesG);
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

  // The walls as line segments, leaving a gap wherever a door, window or doorway sits
  // (including a door in the next room that shares this wall).
  function wallPath(project, room) {
    let d = '';
    RP.openings.wallKeys(room).forEach(function (name) {
      const f = RP.openings.wallFrame(room, name);
      const gaps = room.openings.filter(function (o) { return o.wall === name; })
        .map(function (o) { return [o.offset, o.offset + o.width]; })
        .concat(RP.rooms.sharedGaps(project, room, name))
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

  function lineIn(parent, p, q, cls) {
    return make('line', { class: cls, x1: p.x, y1: p.y, x2: q.x, y2: q.y }, parent);
  }

  // Doors (leaf and swing arc), windows and doorways, drawn over the gaps in the wall.
  function drawOpenings(rv, room, state) {
    clear(rv.openingsG);
    const blocked = RP.checks.forState(state).blockedDoors;
    room.openings.forEach(function (op) {
      const e = RP.openings.ends(room, op);
      const g = make('g', {
        class: 'opening opening-' + op.type + (op.id === state.ui.selectedOpeningId ? ' selected' : ''),
        'data-opening': op.id,
      }, rv.openingsG);

      if (op.type === 'door') {
        const s = RP.openings.swingOf(room, op);
        const cross = (s.closedEnd.x - s.hinge.x) * (s.openEnd.y - s.hinge.y) - (s.closedEnd.y - s.hinge.y) * (s.openEnd.x - s.hinge.x);
        const sweep = cross > 0 ? 1 : 0;
        const arc = 'A' + op.width + ' ' + op.width + ' 0 0 ' + sweep + ' ';
        make('path', {
          class: 'door-swing' + (blocked[op.id] ? ' blocked' : ''),
          d: 'M' + s.hinge.x + ' ' + s.hinge.y + 'L' + s.closedEnd.x + ' ' + s.closedEnd.y + arc + s.openEnd.x + ' ' + s.openEnd.y + 'Z',
        }, g);
        lineIn(g, s.hinge, s.openEnd, 'door-leaf');
      } else if (op.type === 'window') {
        lineIn(g, e.p0, e.p1, 'window-glass');
        lineIn(g, e.p0, e.p1, 'window-core');
      } else {
        lineIn(g, e.p0, e.p1, 'doorway-line');
      }
      lineIn(g, e.p0, e.p1, 'opening-hit'); // fat invisible line so the gap is easy to click
    });
  }

  // Text with a background-colored outline so it stays readable over pieces and grid.
  function textIn(parent, text, x, y, px, size, cls) {
    const t = make('text', { class: 'dim-label ' + (cls || ''), x: x, y: y, 'font-size': size * px,
      'stroke-width': 3 * px, dy: '0.35em' }, parent);
    t.textContent = text;
    return t;
  }

  // Tight-walkway lines for every room; snap guides and distances from the selected piece to each
  // wall for the room being edited.
  function drawOverlay(rv, room, state, active) {
    clear(rv.overlayG);
    const units = state.project.units;
    const px = 1 / state.view.ppi;
    const fmt = function (n) { return RP.units.formatLength(n, units); };
    const line = function (x1, y1, x2, y2, cls) { return lineIn(rv.overlayG, { x: x1, y: y1 }, { x: x2, y: y2 }, cls); };

    if (active) {
      state.ui.guides.forEach(function (g) {
        if (g.axis === 'x') line(g.pos, 0, g.pos, room.length, 'guide');
        else line(0, g.pos, room.width, g.pos, 'guide');
      });
    }

    RP.checks.forState(state).gaps.forEach(function (gap) {
      if (gap.roomId !== room.id) return;
      line(gap.a.x, gap.a.y, gap.b.x, gap.b.y, 'gap-line');
      textIn(rv.overlayG, fmt(gap.distance), (gap.a.x + gap.b.x) / 2, (gap.a.y + gap.b.y) / 2, px, 11, 'gap-text');
    });

    if (!active) return;

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
        textIn(rv.overlayG, fmt(d[side].distance), (from.x + to.x) / 2, (from.y + to.y) / 2, px, 11, '');
      });
    }
  }

  // The measure tool works across rooms, so it is drawn in house coordinates.
  function drawMeasure(state) {
    clear(houseOverlayG);
    const m = state.ui.measure;
    if (!m || !m.a) return;
    const px = 1 / state.view.ppi;
    const fmt = function (n) { return RP.units.formatLength(n, state.project.units); };
    const end = m.b || m.hover;
    const dot = function (p) { make('circle', { class: 'measure-dot', cx: p.x, cy: p.y, r: 4 * px }, houseOverlayG); };
    if (end) {
      lineIn(houseOverlayG, m.a, end, 'measure-line');
      dot(end);
      textIn(houseOverlayG, fmt(Math.hypot(end.x - m.a.x, end.y - m.a.y)),
        (m.a.x + end.x) / 2, (m.a.y + end.y) / 2 - 12 * px, px, 14, 'measure-text');
    }
    dot(m.a);
  }

  // Floating text notes. Several lines are allowed. A selected label gets a dashed box.
  function drawFloatLabels(state) {
    clear(labelsG);
    const px = 1 / state.view.ppi;
    (state.project.labels || []).forEach(function (label) {
      const size = (FLOAT_LABEL_PX[label.size] || FLOAT_LABEL_PX.medium) * px;
      const lines = String(label.text).split('\n');
      const widest = lines.reduce(function (m, l) { return Math.max(m, l.length); }, 1);
      const w = widest * size * 0.58 + 10 * px;
      const h = lines.length * size * 1.25 + 6 * px;
      const g = make('g', {
        class: 'float-label' + (label.id === state.ui.selectedLabelId ? ' selected' : ''),
        'data-label': label.id,
      }, labelsG);
      make('rect', { class: 'float-label-box', x: label.x - w / 2, y: label.y - h / 2, width: w, height: h, rx: 3 * px }, g);
      const t = make('text', { x: label.x, y: label.y - (lines.length - 1) * size * 0.625, 'font-size': size, dy: '0.35em' }, g);
      lines.forEach(function (line, i) {
        const span = make('tspan', { x: label.x, dy: i === 0 ? '0.35em' : '1.25em' }, t);
        span.textContent = line || ' ';
      });
      t.removeAttribute('dy');
    });
  }

  function drawRoom(rv, room, state, active) {
    const view = state.view;
    const units = state.project.units;
    rv.g.setAttribute('transform', 'translate(' + room.x + ' ' + room.y + ')');
    rv.g.setAttribute('class', 'room ' + (active ? 'active' : 'inactive'));

    const outline = RP.roomgeo.outline(room);
    const outlineD = polygonPath(outline);
    rv.floor.setAttribute('d', outlineD);
    rv.clipPath.setAttribute('d', outlineD);
    rv.wall.setAttribute('d', wallPath(state.project, room));

    // Grid
    const step = state.ui.gridSize;
    const minorOn = step * view.ppi >= MIN_GRID_PX;
    const majorOn = 12 * view.ppi >= MIN_GRID_PX;
    const box = RP.roomgeo.bbox(outline);
    const key = [box.minX, box.minY, box.maxX, box.maxY, step].join('|');
    if (key !== rv.gridKey) {
      const paths = gridPaths(box, step);
      rv.gridMinor.setAttribute('d', paths.minor);
      rv.gridMajor.setAttribute('d', paths.major);
      rv.gridKey = key;
    }
    rv.gridMinor.style.display = minorOn ? '' : 'none';
    rv.gridMajor.style.display = majorOn ? '' : 'none';

    drawOpenings(rv, room, state);
    drawFurniture(rv, room, state);
    drawHandles(rv, state, active);
    drawVertexHandles(rv, room, state, active);
    drawRoomInfo(rv, room, state, active);
    drawOverlay(rv, room, state, active);
    if (active) drawWallLabels(rv, room, units, view); else clear(rv.labelsG);
  }

  function draw(state) {
    const size = getSize();
    if (!size.w || !size.h) return;

    const project = state.project;
    const view = state.view;
    const units = project.units;
    const U = RP.units;

    svg.setAttribute('viewBox', RP.geometry.viewBoxFor(view, size).join(' '));

    const activeRoom = RP.state.activeOf(project);
    const ids = {};
    project.rooms.forEach(function (r) { ids[r.id] = true; });
    Object.keys(views).forEach(function (id) { if (!ids[id]) dropView(id); });

    // The room being edited goes last (on top); the others keep their order.
    const ordered = project.rooms.filter(function (r) { return r !== activeRoom; }).concat([activeRoom]);
    const key = ordered.map(function (r) { return r.id; }).join('|');
    ordered.forEach(function (room) {
      const rv = viewFor(room);
      if (key !== orderKey) housesG.appendChild(rv.g); // re-stack only when the order changed
      drawRoom(rv, room, state, room === activeRoom);
    });
    orderKey = key;
    drawFloatLabels(state);
    drawMeasure(state);

    // Scale bar (HTML overlay, bottom-left) and grid-size label
    const inches = RP.geometry.niceScaleInches(view.ppi, units, SCALE_MAX_PX);
    scaleBar.style.width = (inches * view.ppi) + 'px';
    scaleLabel.textContent = U.formatLength(inches, units);
    gridLabel.textContent = 'Grid: ' + state.ui.gridSize + '"';
  }

  RP.render = { init: init, draw: draw, getSize: getSize, wallPath: wallPath };
})(window.RP = window.RP || {});
