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

  function saveLibrary() {
    RP.storage.saveUserLibrary(RP.library.getUser());
    renderList();
  }

  function renderList() {
    const project = S.get().project;
    const q = searchEl.value.trim().toLowerCase();
    const allItems = RP.library.allItems();
    listEl.textContent = '';

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
      const inUse = project.rooms[0].furniture.some(function (f) { return f.categoryId === cat.id; });
      if (isUserCategory && !catItems.length && !inUse) {
        summary.appendChild(smallButton('×', 'Delete category ' + cat.name, function () {
          const u = RP.library.getUser();
          u.categories = u.categories.filter(function (c) { return c.id !== cat.id; });
          saveLibrary();
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
            const u = RP.library.getUser();
            u.items = u.items.filter(function (x) { return x.type !== it.type; });
            saveLibrary();
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
      if (!btn || e.button !== 0 || e.pointerType === 'touch') return;
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
          const room = S.get().project.rooms[0];
          const w = RP.geometry.screenToWorld(S.get().view, RP.render.getSize(), e.clientX - r.left, e.clientY - r.top);
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
      state.project.rooms[0].furniture.map(function (f) { return f.categoryId; }).filter(function (id, i, a) { return a.indexOf(id) === i; }),
    ]);
  }

  function sync(state) {
    const sig = librarySignature(state);
    if (sig !== lastSignature) {
      lastSignature = sig;
      renderList();
    }
    const piece = A.selectedPiece();
    const bar = document.getElementById('selection-bar');
    bar.hidden = !piece;
    if (piece) {
      const f = function (n) { return RP.units.formatLength(n, state.project.units); };
      document.getElementById('selection-name').textContent = piece.name + ' · ' +
        (piece.shape === 'circle' ? f(piece.width) + ' dia.' : f(piece.width) + ' × ' + f(piece.depth));
      document.getElementById('delete-btn').disabled = piece.locked;
    }
  }

  RP.panel = { init: init, sync: sync };
})(window.RP = window.RP || {});
