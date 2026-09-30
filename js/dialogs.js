// Modal dialogs: new category, new/edit piece, layouts list, import choice.
(function (RP) {
  'use strict';

  const S = RP.state;
  const U = RP.units;
  let modal;

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function field(label, input) {
    const row = el('label', 'row');
    row.appendChild(el('span', null, label));
    row.appendChild(input);
    return row;
  }

  function textInput(value) {
    const i = el('input');
    i.type = 'text';
    i.autocomplete = 'off';
    i.spellcheck = false;
    i.value = value || '';
    return i;
  }

  function close() {
    if (modal.open) modal.close();
  }

  // actions: [{ label, primary, run() }] — run returns false to keep the dialog open.
  function open(title, bodyEl, actions) {
    modal.textContent = '';
    const head = el('div', 'modal-head');
    head.appendChild(el('h2', null, title));
    const x = el('button', null, '×');
    x.type = 'button';
    x.setAttribute('aria-label', 'Close');
    x.addEventListener('click', close);
    head.appendChild(x);
    modal.appendChild(head);
    bodyEl.classList.add('modal-body');
    modal.appendChild(bodyEl);
    const foot = el('div', 'modal-foot');
    (actions || []).forEach(function (a) {
      const b = el('button', a.primary ? 'primary' : '', a.label);
      b.type = 'button';
      b.addEventListener('click', function () {
        if (a.run() !== false) close();
      });
      foot.appendChild(b);
    });
    modal.appendChild(foot);
    if (!modal.open) modal.showModal();
  }

  function errorLine() {
    const e = el('div', 'form-error');
    e.setAttribute('role', 'alert');
    return e;
  }

  function saveUserLibrary() {
    RP.storage.saveUserLibrary(RP.library.getUser());
    S.setUi({}); // refresh anything showing categories or pieces
  }

  // ---- New category ----
  function newCategory(onCreated) {
    const body = el('div');
    const name = textInput('');
    name.placeholder = 'e.g. Office';
    const color = el('input');
    color.type = 'color';
    color.value = RP.library.nextPaletteColor().toLowerCase();
    const err = errorLine();
    body.appendChild(field('Name', name));
    body.appendChild(field('Color', color));
    body.appendChild(err);

    open('New category', body, [
      { label: 'Cancel', run: function () {} },
      {
        label: 'Add category',
        primary: true,
        run: function () {
          const n = name.value.trim();
          if (!n) { err.textContent = 'Give the category a name.'; return false; }
          const taken = RP.library.allCategories(S.get().project).some(function (c) { return c.name.toLowerCase() === n.toLowerCase(); });
          if (taken) { err.textContent = 'A category with that name already exists.'; return false; }
          const cat = RP.library.newCategory(n, color.value);
          RP.library.getUser().categories.push(cat);
          saveUserLibrary();
          if (onCreated) onCreated(cat);
        },
      },
    ]);
    name.focus();
  }

  // ---- New piece / edit a saved piece ----
  function pieceDialog(existing) {
    const body = el('div');
    const name = textInput(existing ? existing.name : '');
    const cat = el('select');
    RP.library.allCategories(S.get().project).forEach(function (c) {
      const o = el('option', null, c.name);
      o.value = c.id;
      cat.appendChild(o);
    });
    cat.value = existing ? existing.categoryId : 'custom';
    const shape = el('select');
    [['rect', 'Rectangle'], ['circle', 'Circle']].forEach(function (s) {
      const o = el('option', null, s[1]);
      o.value = s[0];
      shape.appendChild(o);
    });
    shape.value = existing ? existing.shape : 'rect';
    const units = S.get().project.units;
    const width = textInput(existing ? U.formatLength(existing.defaultWidth, units) : '');
    const depth = textInput(existing ? U.formatLength(existing.defaultDepth, units) : '');
    const widthLabel = el('span', null, 'Width');
    const widthRow = el('label', 'row');
    widthRow.appendChild(widthLabel);
    widthRow.appendChild(width);
    const depthRow = field('Depth', depth);
    const save = el('input');
    save.type = 'checkbox';
    save.checked = true;
    const saveRow = el('label', 'check');
    saveRow.appendChild(save);
    saveRow.appendChild(document.createTextNode(' Save to my library for reuse'));
    const err = errorLine();

    function syncShape() {
      const circle = shape.value === 'circle';
      widthLabel.textContent = circle ? 'Diameter' : 'Width';
      depthRow.hidden = circle;
    }
    shape.addEventListener('change', syncShape);
    syncShape();

    body.appendChild(field('Name', name));
    body.appendChild(field('Category', cat));
    body.appendChild(field('Shape', shape));
    body.appendChild(widthRow);
    body.appendChild(depthRow);
    if (!existing) body.appendChild(saveRow);
    body.appendChild(el('p', 'hint', 'Sizes like 6\', 30", 19 5/8" or 120 cm all work.'));
    body.appendChild(err);

    open(existing ? 'Edit piece' : 'New piece', body, [
      { label: 'Cancel', run: function () {} },
      {
        label: existing ? 'Save' : 'Add to room',
        primary: true,
        run: function () {
          const parse = function (t) { return U.parseLength(t, units === 'metric' ? 'cm' : 'in'); };
          const circle = shape.value === 'circle';
          const w = parse(width.value);
          const d = circle ? w : parse(depth.value);
          const n = name.value.trim() || 'Custom piece';
          if (w === null || d === null || w < 1 || d < 1 || w > 600 || d > 600) {
            err.textContent = 'Enter a size between 1" and 50\' for each side.';
            return false;
          }
          const data = { name: n, categoryId: cat.value, shape: shape.value, defaultWidth: w, defaultDepth: d };
          if (existing) {
            Object.assign(existing, data);
            saveUserLibrary();
            return;
          }
          let item = Object.assign({ type: 'u-' + S.newId(''), builtIn: false, ownerId: '' }, data);
          if (save.checked) {
            RP.library.getUser().items.push(item);
            saveUserLibrary();
          }
          RP.actions.addPiece(item);
        },
      },
    ]);
    name.focus();
  }

  // ---- Layouts list ----
  function formatWhen(iso) {
    const d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  }

  function layoutsDialog(hooks) {
    const body = el('div');
    const list = el('div', 'layout-list');
    body.appendChild(list);

    function refresh() {
      list.textContent = '';
      const currentId = S.get().project.id;
      const rows = RP.storage.listLayouts();
      if (!rows.length) list.appendChild(el('p', 'hint', 'No saved layouts yet.'));
      rows.forEach(function (row) {
        const isCurrent = row.id === currentId;
        // The open layout's name and time come from memory (autosave may lag a moment).
        const name = isCurrent ? S.get().project.name : row.name;
        const when = isCurrent ? S.get().project.updatedAt : row.updatedAt;

        const item = el('div', 'layout-row' + (isCurrent ? ' current' : ''));
        const info = el('div', 'layout-info');
        const title = el('div', 'layout-name', name + (isCurrent ? '  (open)' : ''));
        info.appendChild(title);
        info.appendChild(el('div', 'layout-when', 'Updated ' + formatWhen(when)));
        item.appendChild(info);

        const btns = el('div', 'layout-btns');
        const mk = function (label, fn, cls) {
          const b = el('button', cls || '', label);
          b.type = 'button';
          b.addEventListener('click', fn);
          btns.appendChild(b);
        };
        if (!isCurrent) mk('Open', function () { hooks.openLayout(row.id); close(); });
        mk('Rename', function () { startRename(row, item, title, isCurrent); });
        mk('Delete', function () {
          if (window.confirm('Delete "' + name + '"? This cannot be undone.')) {
            hooks.deleteLayout(row.id);
            refresh();
          }
        }, 'danger');
        item.appendChild(btns);
        list.appendChild(item);
      });
    }

    function startRename(row, item, title, isCurrent) {
      const input = textInput(isCurrent ? S.get().project.name : row.name);
      input.className = 'rename-input';
      title.textContent = '';
      title.appendChild(input);
      input.focus();
      input.select();
      let done = false;
      function commit(save) {
        if (done) return;
        done = true;
        const v = input.value.trim();
        if (save && v) hooks.renameLayout(row.id, v);
        refresh();
      }
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') commit(true);
        if (e.key === 'Escape') { e.stopPropagation(); commit(false); }
      });
      input.addEventListener('blur', function () { commit(true); });
    }

    refresh();
    open('Layouts', body, [
      { label: 'Import file…', run: function () { hooks.importFile(); } },
      { label: 'New layout', primary: true, run: function () { hooks.newLayout(); } },
    ]);
  }

  // ---- Import choice ----
  function importDialog(project, hooks) {
    const body = el('div');
    body.appendChild(el('p', null, 'Import "' + project.name + '"?'));
    body.appendChild(el('p', 'hint', 'It opens as a new layout by default. Your other layouts are not touched.'));
    open('Import layout', body, [
      { label: 'Cancel', run: function () {} },
      {
        label: 'Replace current layout',
        run: function () {
          const current = S.get().project.name;
          if (!window.confirm('Replace "' + current + '" with the imported layout? "' + current + '" will be overwritten and this cannot be undone.')) return false;
          hooks.replaceCurrent(project);
        },
      },
      { label: 'Open as new layout', primary: true, run: function () { hooks.openAsNew(project); } },
    ]);
  }

  function init() {
    modal = document.getElementById('modal');
    modal.addEventListener('click', function (e) {
      if (e.target === modal) close(); // click on the backdrop
    });
  }

  RP.dialogs = { init: init, newCategory: newCategory, pieceDialog: pieceDialog, layoutsDialog: layoutsDialog, importDialog: importDialog };
})(window.RP = window.RP || {});
