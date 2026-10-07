// Left furniture library (search, grouped by category; click or drag to add)
// and the selection bar on the canvas.
(function (RP) {
  'use strict';

  const S = RP.state;
  const A = RP.actions;
  const DRAG_START_PX = 6;

  let listEl, searchEl, panelEl, svg;
  let suppressClick = false;

  function dimsText(it, units) {
    const f = function (n) { return RP.units.formatLength(n, units); };
    return it.shape === 'circle' ? f(it.defaultWidth) + ' dia.' : f(it.defaultWidth) + ' × ' + f(it.defaultDepth);
  }

  function smallButton(label, title, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'lib-mini';
    b.textContent = label;
    b.title = title;
    b.setAttribute('aria-label', title);
    b.addEventListener('click', function (e) {
      e.preventDefault(); // do not toggle the category open/closed
      e.stopPropagation();
      onClick();
    });
    return b;
  }

  function renderList() {
    const project = S.get().project;
    const q = searchEl.value.trim().toLowerCase();
    const allItems = RP.library.allItems();
    listEl.textContent = '';

    // Doors and windows come first: click to add, then slide along a wall.
    const templates = RP.openings.TEMPLATES.filter(function (t) {
      return !q || (t.name + ' door window opening doorway').toLowerCase().indexOf(q) !== -1;
    });
    if (templates.length) {
      const details = document.createElement('details');
      details.open = true;
      const summary = document.createElement('summary');
      const swatch = document.createElement('span');
      swatch.className = 'swatch swatch-openings';
      summary.appendChild(swatch);
      const label = document.createElement('span');
      label.className = 'cat-name';
      label.textContent = 'Doors & windows';
      summary.appendChild(label);
      details.appendChild(summary);
      templates.forEach(function (t) {
        const row = document.createElement('div');
        row.className = 'lib-row';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'lib-item lib-opening';
        btn.dataset.opening = t.key;
        const name = document.createElement('span');
        name.className = 'lib-name';
        name.textContent = t.name;
        const dims = document.createElement('span');
        dims.className = 'lib-dims';
        dims.textContent = RP.units.formatLength(t.width, project.units);
        btn.appendChild(name);
        btn.appendChild(dims);
        row.appendChild(btn);
        details.appendChild(row);
      });
      listEl.appendChild(details);
    }

    RP.library.allCategories(project).forEach(function (cat) {
      const catItems = allItems.filter(function (it) { return it.categoryId === cat.id; });
      const items = catItems.filter(function (it) {
        return !q || it.name.toLowerCase().indexOf(q) !== -1 || cat.name.toLowerCase().indexOf(q) !== -1;
      });
      if (!items.length && q) return;

      const details = document.createElement('details');
      details.open = true;
      const summary = document.createElement('summary');
      const swatch = document.createElement('span');
      swatch.className = 'swatch';
      swatch.style.background = cat.color;
      summary.appendChild(swatch);
      const label = document.createElement('span');
      label.className = 'cat-name';
      label.textContent = cat.name;
      summary.appendChild(label);

      const isUserCategory = !RP.library.isBuiltInCategory(cat.id) &&
        RP.library.getUser().categories.some(function (c) { return c.id === cat.id; });
      const inUse = project.rooms.some(function (r) { return r.furniture.some(function (f) { return f.categoryId === cat.id; }); });
      if (isUserCategory && !catItems.length && !inUse) {
        summary.appendChild(smallButton('×', 'Delete category ' + cat.name, function () {
          RP.library.removeUserCategory(cat.id);
          renderList();
        }));
      }
      details.appendChild(summary);

      if (!items.length) {
        const empty = document.createElement('div');
        empty.className = 'lib-empty';
        empty.textContent = 'No pieces yet';
        details.appendChild(empty);
      }
      items.forEach(function (it) {
        const row = document.createElement('div');
        row.className = 'lib-row';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'lib-item';
        btn.dataset.type = it.type;
        const name = document.createElement('span');
        name.className = 'lib-name';
        name.textContent = it.name;
        const dims = document.createElement('span');
        dims.className = 'lib-dims';
        dims.textContent = dimsText(it, project.units);
        btn.appendChild(name);
        btn.appendChild(dims);
        row.appendChild(btn);
        if (!it.builtIn) {
          row.appendChild(smallButton('✎', 'Edit ' + it.name, function () { RP.dialogs.pieceDialog(it); }));
          row.appendChild(smallButton('×', 'Delete ' + it.name + ' from library', function () {
            RP.library.removeUserItem(it.type);
            renderList();
          }));
        }
        details.appendChild(row);
      });
      listEl.appendChild(details);
    });

    if (!listEl.firstChild) {
      const none = document.createElement('div');
      none.className = 'lib-empty';
      none.textContent = 'No matches';
      listEl.appendChild(none);
    }
  }

  function itemFor(btn) {
    const type = btn.dataset.type;
    return RP.library.allItems().filter(function (it) { return it.type === type; })[0];
  }

  function closeDrawer() {
    panelEl.classList.remove('open');
  }

  // Mouse/pen can drag a piece from the list onto the canvas; touch taps to add.
  function setupDragging() {
    let start = null;
    let ghost = null;

    listEl.addEventListener('pointerdown', function (e) {
      const btn = e.target.closest('.lib-item');
      if (!btn || btn.classList.contains('lib-opening') || e.button !== 0 || e.pointerType === 'touch') return;
      start = { x: e.clientX, y: e.clientY, btn: btn, id: e.pointerId };
    });

    window.addEventListener('pointermove', function (e) {
      if (!start || e.pointerId !== start.id) return;
      if (!ghost && Math.hypot(e.clientX - start.x, e.clientY - start.y) > DRAG_START_PX) {
        ghost = document.createElement('div');
        ghost.className = 'drag-ghost';
        ghost.textContent = itemFor(start.btn).name;
        document.body.appendChild(ghost);
      }
      if (ghost) {
        ghost.style.left = e.clientX + 'px';
        ghost.style.top = e.clientY + 'px';
      }
    });

    function finish(e, drop) {
      if (!start || e.pointerId !== start.id) return;
      if (ghost) {
        suppressClick = true;
        setTimeout(function () { suppressClick = false; }, 0);
        const r = svg.getBoundingClientRect();
        const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
        if (drop && inside) {
          const w = RP.geometry.screenToWorld(S.get().view, RP.render.getSize(), e.clientX - r.left, e.clientY - r.top);
          // Dropped inside a room: that room gets the piece
          const target = RP.rooms.roomAt(S.get().project, w);
          if (target) S.setActiveRoom(target.id);
          const room = S.room();
          A.addPiece(itemFor(start.btn), w.x - room.x, w.y - room.y);
        }
        ghost.remove();
        ghost = null;
      }
      start = null;
    }
    window.addEventListener('pointerup', function (e) { finish(e, true); });
    window.addEventListener('pointercancel', function (e) { finish(e, false); });
  }

  function init() {
    panelEl = document.getElementById('library');
    listEl = document.getElementById('library-list');
    searchEl = document.getElementById('library-search');
    svg = document.getElementById('canvas');

    searchEl.addEventListener('input', renderList);
    listEl.addEventListener('click', function (e) {
      const btn = e.target.closest('.lib-item');
      if (!btn || suppressClick) return;
      if (btn.classList.contains('lib-opening')) {
        const key = btn.dataset.opening;
        A.addOpening(RP.openings.TEMPLATES.filter(function (t) { return t.key === key; })[0]);
        closeDrawer();
        return;
      }
      A.addPiece(itemFor(btn));
      closeDrawer();
    });
    document.getElementById('library-toggle').addEventListener('click', function () {
      panelEl.classList.toggle('open');
    });
    document.getElementById('library-close').addEventListener('click', closeDrawer);
    document.getElementById('new-piece').addEventListener('click', function () { RP.dialogs.pieceDialog(null); });
    document.getElementById('new-category').addEventListener('click', function () { RP.dialogs.newCategory(); });

    document.getElementById('delete-btn').addEventListener('click', A.deleteSelected);
    document.getElementById('sb-div-style').addEventListener('click', function () {
      const d = A.selectedDivider();
      if (d) A.updateDivider(d.id, { style: d.style === 'dashed' ? 'solid' : 'dashed' });
    });
    document.getElementById('sb-edit-label').addEventListener('click', function () {
      const label = A.selectedLabel();
      if (label) RP.dialogs.labelDialog(label);
    });

    setupDragging();
    renderList();
  }

  // Keep the selection bar and the library list in step with state.
  let lastSignature = null;
  function librarySignature(state) {
    return JSON.stringify([
      state.project.units,
      RP.library.allCategories(state.project).map(function (c) { return [c.id, c.name, c.color]; }),
      RP.library.getUser().items,
      state.project.rooms.map(function (r) { return r.furniture.map(function (f) { return f.categoryId; }); }).join(",").split(",").filter(function (id, i, a) { return a.indexOf(id) === i; }),
    ]);
  }

  function sync(state) {
    const sig = librarySignature(state);
    if (sig !== lastSignature) {
      lastSignature = sig;
      renderList();
    }
    const piece = A.selectedPiece();
    const opening = A.selectedOpening();
    const label = A.selectedLabel();
    const divider = A.selectedDivider();
    const bar = document.getElementById('selection-bar');
    bar.hidden = !piece && !opening && !label && !divider;
    // Rotate and Duplicate only make sense for furniture
    document.getElementById('sb-rotate').hidden = !!opening || !!label || !!divider;
    document.getElementById('sb-dup').hidden = !!opening || !!label || !!divider;
    document.getElementById('sb-edit-label').hidden = !label;
    document.getElementById('sb-div-style').hidden = !divider;
    if (divider) {
      document.getElementById('selection-name').textContent = 'Divider · ' +
        RP.units.formatLength(Math.hypot(divider.b.x - divider.a.x, divider.b.y - divider.a.y), state.project.units);
      document.getElementById('sb-div-style').textContent = divider.style === 'dashed' ? 'Make solid' : 'Make dashed';
      document.getElementById('delete-btn').disabled = false;
    } else if (label) {
      const first = String(label.text).split('\n')[0];
      document.getElementById('selection-name').textContent = 'Label · ' + (first.length > 24 ? first.slice(0, 23) + '…' : first);
      document.getElementById('delete-btn').disabled = false;
    } else if (opening) {
      document.getElementById('selection-name').textContent = RP.openings.label(opening) + ' · ' +
        RP.units.formatLength(opening.width, state.project.units);
      document.getElementById('delete-btn').disabled = false;
    } else if (piece) {
      const f = function (n) { return RP.units.formatLength(n, state.project.units); };
      document.getElementById('selection-name').textContent = piece.name + ' · ' +
        (piece.shape === 'circle' ? f(piece.width) + ' dia.' : f(piece.width) + ' × ' + f(piece.depth));
      document.getElementById('delete-btn').disabled = piece.locked;
    }
  }

  RP.panel = { init: init, sync: sync };
})(window.RP = window.RP || {});
