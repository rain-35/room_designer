// Built-in categories and default pieces (sizes in inches, width x depth from above).
(function (RP) {
  'use strict';

  const categories = [
    { id: 'beds',     name: 'Beds',     color: '#7B9ACC' },
    { id: 'dressers', name: 'Dressers', color: '#C08552' },
    { id: 'shelves',  name: 'Shelves',  color: '#8FB573' },
    { id: 'tables',   name: 'Tables',   color: '#D9A441' },
    { id: 'seating',  name: 'Seating',  color: '#B5739D' },
    { id: 'rugs',     name: 'Rugs',     color: '#CFC6B8' },
    { id: 'custom',   name: 'Custom',   color: '#9AA0A6' },
  ].map(function (c, i) {
    return { id: c.id, name: c.name, color: c.color, builtIn: true, sortOrder: i, ownerId: '' };
  });

  function slug(name) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  function item(categoryId, name, w, d, shape) {
    return {
      type: slug(name),
      name: name,
      defaultWidth: w,
      defaultDepth: d,
      shape: shape || 'rect',
      categoryId: categoryId,
      builtIn: true,
      ownerId: '',
    };
  }

  const items = [
    item('beds', 'Twin mattress', 38, 75),
    item('beds', 'Twin XL mattress', 38, 80),
    item('beds', 'Full mattress', 54, 75),
    item('beds', 'Queen mattress', 60, 80),
    item('beds', 'King mattress', 76, 80),
    item('beds', 'California king mattress', 72, 84),

    item('dressers', 'IKEA MALM 6-drawer', 63, 19),
    item('dressers', 'IKEA HEMNES 8-drawer', 63, 19.625),
    item('dressers', 'Tall chest', 36, 18),

    item('shelves', 'IKEA KALLAX 1x4', 16.5, 15.375),
    item('shelves', 'IKEA KALLAX 3x3', 44.125, 15.375),
    item('shelves', 'IKEA KALLAX 4x4', 57.875, 15.375),
    item('shelves', 'IKEA KALLAX 5x5', 71.625, 15.375),
    item('shelves', 'IKEA BILLY, narrow', 15.75, 11),
    item('shelves', 'IKEA BILLY, wide', 31.5, 11),

    item('tables', 'Dining table, rectangle', 64, 40),
    item('tables', 'Kitchen table', 60, 36),
    item('tables', 'Dining table, round', 44, 44, 'circle'),
    item('tables', 'Coffee table', 48, 30),
    item('tables', 'End table', 24, 24),
    item('tables', 'Nightstand', 19, 15),
    item('tables', 'Desk', 48, 30),

    item('seating', 'Sofa, 3-seat', 84, 38),
    item('seating', 'Loveseat', 60, 38),
    item('seating', 'Armchair', 35, 35),
    item('seating', 'Dining chair', 19, 19),
    item('seating', 'Barstool', 17, 17),

    item('rugs', 'Rug 8\' x 10\'', 96, 120),
    item('rugs', 'Rug 9\' x 12\'', 108, 144),
  ];

  // The signed-in user's own categories and pieces (kept in storage, shared by all their layouts).
  let user = { categories: [], items: [] };

  function setUser(lib) {
    user = { categories: lib.categories || [], items: lib.items || [] };
  }

  function getUser() {
    return user;
  }

  function byId(list, id) {
    for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  // Built-ins, then the user's categories, then any a layout carries that the user does not have.
  function allCategories(project) {
    const out = categories.concat(user.categories);
    ((project && project.categories) || []).forEach(function (c) {
      if (!byId(out, c.id)) out.push(c);
    });
    return out;
  }

  function allItems() {
    return items.concat(user.items);
  }

  function getCategory(project, id) {
    return byId(allCategories(project), id) || categories[categories.length - 1]; // Custom
  }

  function colorOf(project, piece) {
    return piece.color || getCategory(project, piece.categoryId).color;
  }

  function isBuiltInCategory(id) {
    return !!byId(categories, id);
  }

  // Keep project.categories equal to copies of the custom categories its furniture uses,
  // so an exported file is self-contained.
  function syncProjectCategories(project) {
    const used = [];
    project.rooms.forEach(function (room) {
      room.furniture.forEach(function (f) {
        if (!isBuiltInCategory(f.categoryId) && used.indexOf(f.categoryId) === -1) used.push(f.categoryId);
      });
    });
    const existing = project.categories || [];
    const next = [];
    used.forEach(function (id) {
      const c = byId(user.categories, id) || byId(existing, id);
      if (c) next.push(Object.assign({}, c));
    });
    if (JSON.stringify(next) !== JSON.stringify(existing)) project.categories = next;
  }

  const PALETTE = ['#E07A5F', '#3D8C95', '#81B29A', '#9B5DE5', '#F2CC8F', '#5E8CE0', '#D1495B', '#6C757D'];

  function newCategory(name, color) {
    return {
      id: 'c-' + Math.random().toString(36).slice(2, 9),
      name: name,
      color: color,
      builtIn: false,
      sortOrder: categories.length + user.categories.length,
      ownerId: '',
    };
  }

  function nextPaletteColor() {
    return PALETTE[user.categories.length % PALETTE.length];
  }

  RP.library = {
    categories: categories,
    items: items,
    allCategories: allCategories,
    allItems: allItems,
    getCategory: getCategory,
    colorOf: colorOf,
    setUser: setUser,
    getUser: getUser,
    isBuiltInCategory: isBuiltInCategory,
    syncProjectCategories: syncProjectCategories,
    newCategory: newCategory,
    nextPaletteColor: nextPaletteColor,
    slug: slug,
  };
})(window.RP = window.RP || {});
