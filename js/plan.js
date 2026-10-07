// Printable plan: draws the layout as a to-scale SVG in paper inches, then saves it as a PNG
// or sends it to the browser's print dialog (choose "Save as PDF" there for a PDF).
(function (RP) {
  'use strict';

  const U = RP.units;
  const R = RP.roomgeo;

  const PAPERS = [
    { key: 'letter', name: 'Letter (8.5 × 11 in)', w: 8.5, h: 11 },
    { key: 'legal', name: 'Legal (8.5 × 14 in)', w: 8.5, h: 14 },
    { key: 'tabloid', name: 'Tabloid (11 × 17 in)', w: 11, h: 17 },
    { key: 'a4', name: 'A4 (210 × 297 mm)', w: 8.268, h: 11.693 },
    { key: 'a3', name: 'A3 (297 × 420 mm)', w: 11.693, h: 16.535 },
  ];

  // k = inches of paper per inch of room
  const IMPERIAL_SCALES = [
    { label: '1" = 1\'', k: 1 / 12 }, { label: '3/4" = 1\'', k: 0.75 / 12 }, { label: '1/2" = 1\'', k: 0.5 / 12 },
    { label: '3/8" = 1\'', k: 0.375 / 12 }, { label: '1/4" = 1\'', k: 0.25 / 12 }, { label: '3/16" = 1\'', k: 0.1875 / 12 },
    { label: '1/8" = 1\'', k: 0.125 / 12 }, { label: '3/32" = 1\'', k: 0.09375 / 12 }, { label: '1/16" = 1\'', k: 0.0625 / 12 },
  ];
  const METRIC_SCALES = [10, 20, 25, 50, 75, 100, 200].map(function (n) { return { label: '1:' + n, k: 1 / n }; });

  const MARGIN = 0.5;   // paper inches
  const TITLE_H = 0.8;  // title block height
  const PAD = 0.12;     // space between the plan and the frame
  const INK = '#1a1a1a';
  const FONT = 'Arial, Helvetica, sans-serif';

  function scalesFor(project) { return project.units === 'metric' ? METRIC_SCALES : IMPERIAL_SCALES; }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function num(n) { return Math.round(n * 1000) / 1000; }

  function paperByKey(key) {
    return PAPERS.filter(function (p) { return p.key === key; })[0] || PAPERS[0];
  }

  function exactLabel(project, k) {
    if (project.units === 'metric') return '1:' + Math.round(1 / k);
    return '1" = ' + (Math.round(10 / (12 * k)) / 10) + '\'';
  }

  // Work out page orientation, scale and placement.
  // opts.scale is 'fit' or a number (k). Returns { w, h, k, fits, label }.
  function layout(project, opts) {
    const paper = paperByKey(opts.paper);
    const houseBox = RP.rooms.houseBox(project);

    // The drawn area at scale k: the rooms plus any floating labels (whose text size is fixed on paper)
    function boxFor(k) {
      const box = { minX: houseBox.minX, minY: houseBox.minY, maxX: houseBox.maxX, maxY: houseBox.maxY };
      (project.labels || []).forEach(function (l) {
        const e = labelExtent(l, k);
        box.minX = Math.min(box.minX, l.x - e.w / 2);
        box.maxX = Math.max(box.maxX, l.x + e.w / 2);
        box.minY = Math.min(box.minY, l.y - e.h / 2);
        box.maxY = Math.max(box.maxY, l.y + e.h / 2);
      });
      return box;
    }
    const sizeOf = function (box) { return { w: box.maxX - box.minX, h: box.maxY - box.minY }; };

    function room(w, h) {
      return { aw: w - 2 * MARGIN - 2 * PAD, ah: h - 2 * MARGIN - TITLE_H - 2 * PAD };
    }
    function attempt(w, h) {
      const a = room(w, h);
      const fitsAt = function (k) { const s = sizeOf(boxFor(k)); return s.w * k <= a.aw + 1e-9 && s.h * k <= a.ah + 1e-9; };
      let k;
      let label;
      if (opts.scale === 'fit') {
        // Find the largest scale that fits (labels grow with the scale, so settle it in a few passes)
        let exact = Math.min(a.aw / sizeOf(houseBox).w, a.ah / sizeOf(houseBox).h);
        for (let i = 0; i < 6; i++) {
          const s = sizeOf(boxFor(exact));
          exact = Math.min(a.aw / s.w, a.ah / s.h) * (i === 5 ? 1 : 0.999);
        }
        exact = Math.min(exact, 1 / 12);
        const std = scalesFor(project).filter(function (s) { return fitsAt(s.k); })[0];
        if (std) { k = std.k; label = std.label; } else { k = exact; label = exactLabel(project, k); }
      } else {
        k = opts.scale;
        const std = scalesFor(project).filter(function (s) { return Math.abs(s.k - k) < 1e-9; })[0];
        label = std ? std.label : exactLabel(project, k);
      }
      return { w: w, h: h, k: k, label: label, fits: fitsAt(k), aw: a.aw, ah: a.ah, box: boxFor(k) };
    }
    const portrait = attempt(paper.w, paper.h);
    const landscape = attempt(paper.h, paper.w);
    const rooms = sizeOf(houseBox);
    const preferLandscape = rooms.w >= rooms.h;
    let a = preferLandscape ? landscape : portrait;
    const b = preferLandscape ? portrait : landscape;
    if (opts.scale === 'fit') {
      if (b.k > a.k * 1.0001) a = b;
    } else if (!a.fits && b.fits) {
      a = b;
    }
    const s = sizeOf(a.box);
    a.bw = s.w;
    a.bh = s.h;
    return a;
  }

  const LABEL_PT = { small: 8, medium: 11, large: 16 }; // floating label text size on paper

  // Size of a floating label in room inches at scale k
  function labelExtent(l, k) {
    const pts = LABEL_PT[l.size] || LABEL_PT.medium;
    const lines = String(l.text).split('\n');
    const widest = lines.reduce(function (m, s) { return Math.max(m, s.length); }, 1);
    return { w: (widest * pts * 0.58 + 6) / 72 / k, h: (lines.length * pts * 1.25 + 4) / 72 / k };
  }

  // ---- drawing ----

  function niceBar(project, k) {
    const inches = project.units === 'metric'
      ? [0.5, 1, 2, 5, 10, 20, 50].map(function (m) { return m * 100 / 2.54; })
      : [12, 24, 60, 120, 240, 600, 1200];
    let best = inches[0];
    inches.forEach(function (n) { if (n * k <= 2.2) best = n; });
    return best;
  }

  function buildRoom(project, room, o, k) {
    const pt = function (pts) { return 1 / 72 / k * pts; }; // printer's points -> room inches
    const f = function (n) { return num(n); };
    const outline = R.outline(room);
    let out = '<g transform="translate(' + f(room.x) + ' ' + f(room.y) + ')">';

    out += '<polygon points="' + outline.map(function (p) { return f(p.x) + ',' + f(p.y); }).join(' ') + '" fill="#fff"/>';

    // Divider lines, under the furniture
    (room.dividers || []).forEach(function (d) {
      out += '<line x1="' + f(d.a.x) + '" y1="' + f(d.a.y) + '" x2="' + f(d.b.x) + '" y2="' + f(d.b.y) + '" stroke="#555" stroke-width="' + f(pt(1.3)) +
        '" stroke-linecap="round"' + (d.style === 'dashed' ? ' stroke-dasharray="' + f(pt(5)) + ' ' + f(pt(3)) + '"' : '') + '/>';
    });

    // Furniture: rugs first
    const list = room.furniture.filter(function (p) { return p.layer === 'floor'; })
      .concat(room.furniture.filter(function (p) { return p.layer !== 'floor'; }));
    list.forEach(function (p) {
      const color = RP.library.colorOf(project, p);
      const rug = p.layer === 'floor';
      let g = '<g transform="translate(' + f(p.x) + ' ' + f(p.y) + ') rotate(' + f(p.rotation) + ')">';
      const style = ' fill="' + esc(color) + '" fill-opacity="' + (rug ? 0.45 : 0.8) + '" stroke="' + INK + '" stroke-width="' + f(pt(0.7)) + '"' +
        (rug ? ' stroke-dasharray="' + f(pt(3)) + ' ' + f(pt(2)) + '"' : '');
      g += p.shape === 'circle'
        ? '<circle r="' + f(p.width / 2) + '"' + style + '/>'
        : '<rect x="' + f(-p.width / 2) + '" y="' + f(-p.depth / 2) + '" width="' + f(p.width) + '" height="' + f(p.depth) + '"' + style + '/>';

      // Name and size, kept upright; skipped when the piece is too small for them
      const quarter = Math.round(p.rotation / 90) * 90;
      const sideways = Math.abs(p.rotation - quarter) < 0.5 && quarter % 180 !== 0;
      const flat = Math.abs(p.rotation - quarter) < 0.5;
      const availW = (flat ? (sideways ? p.depth : p.width) : Math.min(p.width, p.depth)) * k * 72; // points
      const availH = (flat ? (sideways ? p.width : p.depth) : Math.min(p.width, p.depth)) * k * 72;
      const size = 6.5;
      const nameChars = Math.floor(availW / (size * 0.56));
      if (o.names && nameChars >= 3 && availH >= size * 1.6) {
        const name = p.name.length > nameChars ? p.name.slice(0, nameChars - 1) + '…' : p.name;
        const dims = p.shape === 'circle' ? U.formatLength(p.width, project.units) + ' dia.'
          : U.formatLength(p.width, project.units) + ' × ' + U.formatLength(p.depth, project.units);
        const showDims = o.sizes && dims.length <= nameChars && availH >= size * 3;
        const rot = 'rotate(' + f(-p.rotation) + ')';
        g += '<text text-anchor="middle" font-family="' + FONT + '" font-size="' + f(pt(size)) + '" fill="' + INK + '" transform="' + rot + '" y="' +
          f(showDims ? -pt(size * 0.45) : 0) + '" dominant-baseline="central">' + esc(name) + '</text>';
        if (showDims) {
          g += '<text text-anchor="middle" font-family="' + FONT + '" font-size="' + f(pt(size * 0.9)) + '" fill="#444" transform="' + rot + '" y="' +
            f(pt(size * 0.8)) + '" dominant-baseline="central">' + esc(dims) + '</text>';
        }
      } else if (o.sizes && !o.names && availW / (size * 0.56) >= 8 && availH >= size * 1.6) {
        const dims = p.shape === 'circle' ? U.formatLength(p.width, project.units) + ' dia.'
          : U.formatLength(p.width, project.units) + ' × ' + U.formatLength(p.depth, project.units);
        if (dims.length <= availW / (size * 0.56)) {
          g += '<text text-anchor="middle" font-family="' + FONT + '" font-size="' + f(pt(size)) + '" fill="' + INK + '" transform="rotate(' + f(-p.rotation) +
            ')" dominant-baseline="central">' + esc(dims) + '</text>';
        }
      }
      out += g + '</g>';
    });

    // Walls, with gaps for doors, windows and doorways
    out += '<path d="' + RP.render.wallPath(project, room) + '" fill="none" stroke="' + INK + '" stroke-width="' + f(pt(2.4)) + '" stroke-linecap="square"/>';

    // Doors, windows, doorways
    room.openings.forEach(function (op) {
      const e = RP.openings.ends(room, op);
      const line = function (a, b, color, w, dash) {
        return '<line x1="' + f(a.x) + '" y1="' + f(a.y) + '" x2="' + f(b.x) + '" y2="' + f(b.y) + '" stroke="' + color + '" stroke-width="' + f(pt(w)) + '"' +
          (dash ? ' stroke-dasharray="' + f(pt(3)) + ' ' + f(pt(2)) + '"' : '') + '/>';
      };
      if (op.type === 'door') {
        const s = RP.openings.swingOf(room, op);
        const cross = (s.closedEnd.x - s.hinge.x) * (s.openEnd.y - s.hinge.y) - (s.closedEnd.y - s.hinge.y) * (s.openEnd.x - s.hinge.x);
        const arc = 'A' + f(op.width) + ' ' + f(op.width) + ' 0 0 ' + (cross > 0 ? 1 : 0) + ' ';
        out += '<path d="M' + f(s.closedEnd.x) + ' ' + f(s.closedEnd.y) + arc + f(s.openEnd.x) + ' ' + f(s.openEnd.y) + '" fill="none" stroke="#555" stroke-width="' +
          f(pt(0.6)) + '"/>';
        out += line(s.hinge, s.openEnd, INK, 1.1);
      } else if (op.type === 'window') {
        out += line(e.p0, e.p1, '#fff', 3.4);
        out += line(e.p0, e.p1, '#2a6fdb', 1.6);
      } else {
        out += line(e.p0, e.p1, '#777', 0.8, true);
      }
    });

    // Wall lengths, just inside each wall
    if (o.walls) {
      R.edges(room).forEach(function (ed) {
        if (ed.length * k * 72 < 26) return; // too short to label
        const off = pt(9);
        const cx = (ed.a.x + ed.b.x) / 2 + ed.n.x * off;
        const cy = (ed.a.y + ed.b.y) / 2 + ed.n.y * off;
        let deg = Math.atan2(ed.dir.y, ed.dir.x) * 180 / Math.PI;
        if (deg > 90) deg -= 180;
        if (deg < -90) deg += 180;
        out += '<text x="' + f(cx) + '" y="' + f(cy) + '" text-anchor="middle" dominant-baseline="central" font-family="' + FONT + '" font-size="' + f(pt(7)) +
          '" fill="#0b4a9e" style="paint-order:stroke;stroke:#fff;stroke-width:' + f(pt(2.2)) + 'px;stroke-linejoin:round" transform="rotate(' + f(deg) + ' ' + f(cx) + ' ' + f(cy) + ')">' +
          esc(U.formatLength(ed.length, project.units)) + '</text>';
      });
    }

    // Room name and area
    if (o.rooms) {
      const c = room.nameAt || R.interiorPoint(room);
      const halo = 'paint-order:stroke;stroke:#fff;stroke-width:' + f(pt(3)) + 'px;stroke-linejoin:round';
      out += '<text x="' + f(c.x) + '" y="' + f(c.y) + '" text-anchor="middle" font-family="' + FONT + '" font-size="' + f(pt(11)) + '" font-weight="bold" fill="#333" style="' + halo + '">' + esc(room.name) + '</text>';
      out += '<text x="' + f(c.x) + '" y="' + f(c.y + pt(12)) + '" text-anchor="middle" font-family="' + FONT + '" font-size="' + f(pt(8)) + '" fill="#555" style="' + halo + '">' +
        esc(U.formatAreaSq(R.area(room), project.units)) + '</text>';
    }
    return out + '</g>';
  }

  // Returns { svg, w, h, label, fits } (w and h in paper inches).
  function build(project, opts) {
    const L = layout(project, opts);
    const w = L.w;
    const h = L.h;
    const k = L.k;
    const f = num;
    const px = L.box;
    // Center the plan in the drawing area
    const left = MARGIN + PAD + (L.aw - L.bw * k) / 2;
    const top = MARGIN + PAD + (L.ah - L.bh * k) / 2;
    const tx = left - px.minX * k;
    const ty = top - px.minY * k;

    let s = '<svg xmlns="http://www.w3.org/2000/svg" width="' + f(w) + 'in" height="' + f(h) + 'in" viewBox="0 0 ' + f(w) + ' ' + f(h) + '">';
    s += '<rect width="' + f(w) + '" height="' + f(h) + '" fill="#fff"/>';
    s += '<rect x="' + MARGIN + '" y="' + MARGIN + '" width="' + f(w - 2 * MARGIN) + '" height="' + f(h - 2 * MARGIN) + '" fill="none" stroke="#999" stroke-width="0.008"/>';
    s += '<g transform="translate(' + f(tx) + ' ' + f(ty) + ') scale(' + k + ')">';
    project.rooms.forEach(function (room) { s += buildRoom(project, room, opts, k); });
    // Floating labels
    (project.labels || []).forEach(function (l) {
      const pts = LABEL_PT[l.size] || LABEL_PT.medium;
      const fs = pts / 72 / k;
      const lines = String(l.text).split('\n');
      const top = l.y - (lines.length - 1) * fs * 0.625;
      s += '<text x="' + f(l.x) + '" y="' + f(top) + '" text-anchor="middle" font-family="' + FONT + '" font-size="' + f(fs) + '" font-weight="bold" fill="#222" ' +
        'style="paint-order:stroke;stroke:#fff;stroke-width:' + f(3 / 72 / k) + 'px;stroke-linejoin:round" dominant-baseline="central">';
      lines.forEach(function (line, i) {
        s += '<tspan x="' + f(l.x) + '"' + (i ? ' dy="' + f(fs * 1.25) + '"' : '') + '>' + esc(line || ' ') + '</tspan>';
      });
      s += '</text>';
    });
    s += '</g>';

    // Title block
    const ty0 = h - MARGIN - TITLE_H;
    s += '<line x1="' + MARGIN + '" y1="' + f(ty0) + '" x2="' + f(w - MARGIN) + '" y2="' + f(ty0) + '" stroke="#999" stroke-width="0.008"/>';
    const total = project.rooms.reduce(function (a, r) { return a + R.area(r); }, 0);
    const date = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    s += '<text x="' + f(MARGIN + 0.12) + '" y="' + f(ty0 + 0.27) + '" font-family="' + FONT + '" font-size="0.19" font-weight="bold" fill="' + INK + '">' + esc(project.name) + '</text>';
    s += '<text x="' + f(MARGIN + 0.12) + '" y="' + f(ty0 + 0.48) + '" font-family="' + FONT + '" font-size="0.12" fill="#333">Scale ' + esc(L.label) + '   ·   ' +
      project.rooms.length + (project.rooms.length === 1 ? ' room' : ' rooms') + ', ' + esc(U.formatAreaSq(total, project.units)) + '   ·   ' + esc(date) + '</text>';
    s += '<text x="' + f(MARGIN + 0.12) + '" y="' + f(ty0 + 0.67) + '" font-family="' + FONT + '" font-size="0.085" fill="#777">Print at 100% (actual size) for the scale to be true.</text>';

    // Scale bar
    const bar = niceBar(project, k);
    const barW = bar * k;
    const bx = w - MARGIN - 0.15 - barW;
    const by = ty0 + 0.32;
    s += '<rect x="' + f(bx) + '" y="' + f(by) + '" width="' + f(barW / 2) + '" height="0.07" fill="' + INK + '" stroke="' + INK + '" stroke-width="0.006"/>';
    s += '<rect x="' + f(bx + barW / 2) + '" y="' + f(by) + '" width="' + f(barW / 2) + '" height="0.07" fill="#fff" stroke="' + INK + '" stroke-width="0.006"/>';
    s += '<text x="' + f(bx) + '" y="' + f(by + 0.2) + '" text-anchor="middle" font-family="' + FONT + '" font-size="0.1" fill="' + INK + '">0</text>';
    s += '<text x="' + f(bx + barW) + '" y="' + f(by + 0.2) + '" text-anchor="middle" font-family="' + FONT + '" font-size="0.1" fill="' + INK + '">' +
      esc(U.formatLength(bar, project.units)) + '</text>';
    s += '</svg>';
    return { svg: s, w: w, h: h, label: L.label, fits: L.fits };
  }

  // ---- outputs ----

  function baseName(project) {
    return project.name.trim().replace(/[^\w\- ]+/g, '').replace(/\s+/g, '-') || 'plan';
  }

  // Save as PNG at the given resolution (dots per paper inch).
  function savePng(project, opts, dpi) {
    return new Promise(function (resolve, reject) {
      const built = build(project, opts);
      const img = new Image();
      const url = URL.createObjectURL(new Blob([built.svg], { type: 'image/svg+xml;charset=utf-8' }));
      img.onload = function () {
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(built.w * dpi);
        canvas.height = Math.round(built.h * dpi);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        canvas.toBlob(function (blob) {
          if (!blob) { reject(new Error('The image could not be made.')); return; }
          const u = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = u;
          a.download = baseName(project) + '-plan.png';
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(function () { URL.revokeObjectURL(u); }, 1000);
          resolve();
        }, 'image/png');
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('The image could not be made.')); };
      img.src = url;
    });
  }

  // Open the browser's print dialog with only the plan on the page.
  function print(project, opts) {
    const built = build(project, opts);
    const root = document.createElement('div');
    root.id = 'print-root';
    root.innerHTML = built.svg;
    const style = document.createElement('style');
    style.id = 'print-page-size';
    style.textContent = '@page { size: ' + num(built.w) + 'in ' + num(built.h) + 'in; margin: 0; }';
    document.head.appendChild(style);
    document.body.appendChild(root);
    const oldTitle = document.title;
    document.title = baseName(project) + '-plan';
    function cleanup() {
      window.removeEventListener('afterprint', cleanup);
      root.remove();
      style.remove();
      document.title = oldTitle;
    }
    window.addEventListener('afterprint', cleanup);
    window.print();
  }

  RP.plan = { PAPERS: PAPERS, scalesFor: scalesFor, build: build, layout: layout, savePng: savePng, print: print };
})(window.RP = window.RP || {});
