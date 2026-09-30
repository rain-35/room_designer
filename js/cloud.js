// Cloud sync with Supabase. The browser cache is always the working copy; this module
// copies changes both ways when online.
//
// Layouts: each device remembers the updatedAt both sides agreed on at the last sync.
//   changed only here  -> push    changed only in the cloud -> pull
//   changed on both    -> ask the user (keep this device's, the cloud's, or both)
// Categories and saved pieces: the newest edit of each item wins.
(function (RP) {
  'use strict';

  const S = RP.state;
  const SYNC_DELAY_MS = 2500;    // wait after the last edit before syncing
  const PERIOD_MS = 60000;       // and check the cloud about once a minute
  const BUSY = 'busy';

  let client = null;
  let user = null;
  let hooks = null;
  let running = false;
  let again = false;
  let delayTimer = 0;
  let periodTimer = 0;
  let skippedConflicts = {};   // layouts the user chose "decide later" for, this visit
  let current = { state: 'idle', message: '' };

  function setState(state, message) {
    current = { state: state, message: message || '' };
    if (hooks && hooks.onStatus) hooks.onStatus(current);
  }

  function isNetworkError(err) {
    const m = ((err && err.message) || String(err)).toLowerCase();
    return !navigator.onLine || /failed to fetch|networkerror|network request failed|load failed|fetch failed/.test(m);
  }

  function must(res) {
    if (res.error) throw res.error;
    return res.data;
  }

  function ms(iso) {
    const t = Date.parse(iso);
    return isNaN(t) ? 0 : t;
  }

  function raceError() {
    const e = new Error('The cloud copy changed while syncing.');
    e.race = true;
    return e;
  }

  // ---------------------------------------------------------------- layouts

  async function pullLayout(id, cloudRow, meta) {
    const isCurrent = id === hooks.currentId();
    const stamp = isCurrent ? hooks.currentUpdatedAt() : null;
    const row = cloudRow && cloudRow.data ? cloudRow : must(await client.from('projects').select('*').eq('id', id).single());
    const project = RP.projectio.parseProject(JSON.stringify(row.data));
    project.id = id;
    project.updatedAt = new Date(ms(row.updated_at)).toISOString();
    // The user kept editing the open layout while we fetched: do not overwrite it; look again later.
    if (isCurrent && hooks.currentUpdatedAt() !== stamp) { again = true; return null; }
    RP.storage.saveLayout(project);
    meta.synced[id] = ms(row.updated_at);
    RP.storage.saveSync(meta);
    if (isCurrent) hooks.reloadCurrent(project);
    return project;
  }

  async function pushLayout(id, cloudRow, meta, force) {
    const p = RP.storage.loadLayout(id);
    if (!p) return;
    const fields = { name: p.name, data: p, updated_at: p.updatedAt, deleted_at: null };
    if (cloudRow) {
      let q = client.from('projects').update(fields).eq('id', id);
      if (!force) q = q.eq('updated_at', cloudRow.updated_at); // only if nobody changed it since we looked
      const rows = must(await q.select('id'));
      if (!rows.length) throw raceError();
    } else {
      const res = await client.from('projects').insert(Object.assign({ id: id }, fields));
      if (res.error) {
        if (res.error.code === '23505') throw raceError(); // someone created it meanwhile
        throw res.error;
      }
    }
    meta.synced[id] = ms(p.updatedAt);
    RP.storage.saveSync(meta);
  }

  async function pushDeletion(id, tombIso, meta) {
    const rows = must(await client.from('projects')
      .update({ deleted_at: tombIso, updated_at: tombIso }).eq('id', id).select('id'));
    if (!rows.length) throw raceError();
    delete meta.deleted[id];
    RP.storage.saveSync(meta);
  }

  // Overwrite the cloud copy with this device's version. The pushed version gets a fresh
  // timestamp, newer than the cloud's, so other computers notice the change.
  async function pushOverCloud(id, cloudRow, meta) {
    const p = RP.storage.loadLayout(id);
    if (!p) return;
    const newer = Math.max(Date.now(), ms(cloudRow.updated_at) + 1, ms(p.updatedAt) + 1);
    p.updatedAt = new Date(newer).toISOString();
    RP.storage.saveLayout(p);
    if (id === hooks.currentId()) hooks.reloadCurrent(RP.projectio.parseProject(JSON.stringify(p)));
    await pushLayout(id, cloudRow, meta, true);
  }

  // The user picked how to settle a layout changed on both sides.
  async function resolveConflict(id, choice, cloudRow, meta) {
    if (choice === 'local') {
      await pushOverCloud(id, cloudRow, meta);
    } else if (choice === 'cloud') {
      await pullLayout(id, cloudRow, meta);
    } else if (choice === 'both') {
      // The other computer's version becomes its own layout; this device's version stays and is kept.
      const full = must(await client.from('projects').select('*').eq('id', id).single());
      const copy = RP.projectio.parseProject(JSON.stringify(full.data));
      copy.id = S.newId('p');
      copy.name = copy.name + ' (other computer)';
      copy.updatedAt = new Date().toISOString();
      RP.storage.saveLayout(copy);
      await pushOverCloud(id, cloudRow, meta);
      again = true; // the copy still has to be uploaded
    }
  }

  async function syncProjects() {
    const meta = RP.storage.loadSync();
    const cloudRows = must(await client.from('projects').select('id,name,updated_at,deleted_at'));
    const cloud = {};
    cloudRows.forEach(function (r) { cloud[r.id] = r; });
    const localList = RP.storage.listLayouts();
    const local = {};
    localList.forEach(function (l) { local[l.id] = l; });

    const ids = {};
    Object.keys(local).concat(Object.keys(cloud), Object.keys(meta.deleted)).forEach(function (id) { ids[id] = true; });

    for (const id of Object.keys(ids)) {
      const L = local[id];
      const C = cloud[id];
      const tomb = meta.deleted[id];              // { at, synced } when deleted on this device
      const ls = tomb ? tomb.synced : meta.synced[id];   // ms both sides agreed on, or undefined
      const cu = C ? ms(C.updated_at) : null;
      const isCurrent = id === hooks.currentId();

      // If this is the open layout and it changed since we looked, leave it for the next round.
      if (isCurrent && L && hooks.currentUpdatedAt() !== L.updatedAt) { again = true; continue; }

      if (tomb) {                                   // deleted on this device
        if (!C || C.deleted_at) { delete meta.deleted[id]; RP.storage.saveSync(meta); continue; }
        if (cu === ls) { await pushDeletion(id, tomb.at, meta); continue; }
        delete meta.deleted[id];                    // changed elsewhere since: keep that copy
        RP.storage.saveSync(meta);
        await pullLayout(id, null, meta);
        continue;
      }
      if (!L && !C) continue;
      if (!L) {                                     // only in the cloud
        if (!C.deleted_at) await pullLayout(id, null, meta);
        continue;
      }
      if (!C) { await pushLayout(id, null, meta); continue; }   // only here

      const lu = ms(L.updatedAt);
      if (C.deleted_at) {                           // deleted on another computer
        if (ls !== undefined && lu <= ls) {
          RP.storage.dropLayoutQuietly(id);
          if (isCurrent) hooks.currentRemoved();
        } else {
          await pushOverCloud(id, C, meta);         // edited here after; keep it and restore it
        }
        continue;
      }
      if (ls === undefined && cu === lu) { meta.synced[id] = cu; RP.storage.saveSync(meta); continue; }
      const localChanged = ls === undefined ? true : lu > ls;
      const cloudChanged = ls === undefined ? cu !== lu : cu > ls;
      if (localChanged && cloudChanged) {
        if (skippedConflicts[id]) continue;
        const choice = await RP.dialogs.conflictDialog({ name: L.name, localUpdatedAt: L.updatedAt, cloudUpdatedAt: C.updated_at });
        if (!choice) { skippedConflicts[id] = true; continue; }
        if (isCurrent && hooks.currentUpdatedAt() !== L.updatedAt) { again = true; continue; }
        await resolveConflict(id, choice, C, meta);
      } else if (localChanged) {
        await pushLayout(id, C, meta, false);
      } else if (cloudChanged) {
        await pullLayout(id, null, meta);
      }
    }
  }

  // ---------------------------------------------------------------- library

  function categoryToRow(c) {
    return { id: c.id, name: c.name, color: c.color, sort_order: c.sortOrder || 0, updated_at: c.updatedAt, deleted_at: null };
  }
  function categoryFromRow(r) {
    return { id: r.id, name: r.name, color: r.color, builtIn: false, sortOrder: r.sort_order, ownerId: '', updatedAt: new Date(ms(r.updated_at)).toISOString() };
  }
  function itemToRow(i) {
    return { type: i.type, name: i.name, default_width: i.defaultWidth, default_depth: i.defaultDepth, shape: i.shape,
      category_id: i.categoryId, updated_at: i.updatedAt, deleted_at: null };
  }
  function itemFromRow(r) {
    return { type: r.type, name: r.name, defaultWidth: Number(r.default_width), defaultDepth: Number(r.default_depth), shape: r.shape,
      categoryId: r.category_id, builtIn: false, ownerId: '', updatedAt: new Date(ms(r.updated_at)).toISOString() };
  }

  // Newest edit wins, item by item. Returns the merged local list.
  async function syncTable(table, key, localList, tombs, toRow, fromRow) {
    const cloudRows = must(await client.from(table).select('*'));
    const cloud = {};
    cloudRows.forEach(function (r) { cloud[r[key]] = r; });
    const result = [];
    const uid = user.id;

    // Removals made here
    for (const k of Object.keys(tombs)) {
      const row = cloud[k];
      const td = ms(tombs[k]);
      if (row && !row.deleted_at && ms(row.updated_at) <= td) {
        must(await client.from(table).update({ deleted_at: tombs[k], updated_at: tombs[k] }).eq(key, k).select(key));
        row.deleted_at = tombs[k];
        row.updated_at = tombs[k];
      }
      delete tombs[k];
    }

    const seen = {};
    for (const item of localList) {
      const k = item[key === 'type' ? 'type' : 'id'];
      seen[k] = true;
      const row = cloud[k];
      const lu = ms(item.updatedAt);
      if (!row) {
        must(await client.from(table).upsert(Object.assign({ owner_id: uid }, toRow(item)), { onConflict: 'owner_id,' + key }).select(key));
        result.push(item);
      } else if (row.deleted_at) {
        if (lu > ms(row.updated_at)) {             // edited here after it was deleted elsewhere: restore
          must(await client.from(table).upsert(Object.assign({ owner_id: uid }, toRow(item)), { onConflict: 'owner_id,' + key }).select(key));
          result.push(item);
        }                                           // else it stays deleted: drop it here
      } else if (lu > ms(row.updated_at)) {
        must(await client.from(table).upsert(Object.assign({ owner_id: uid }, toRow(item)), { onConflict: 'owner_id,' + key }).select(key));
        result.push(item);
      } else if (ms(row.updated_at) > lu) {
        result.push(fromRow(row));
      } else {
        result.push(item);
      }
    }
    cloudRows.forEach(function (row) {              // only in the cloud
      if (!seen[row[key]] && !row.deleted_at) result.push(fromRow(row));
    });
    return result;
  }

  async function syncLibrary() {
    const lib = RP.library.getUser();
    const before = JSON.stringify([lib.categories, lib.items]);
    const tombs = { categories: Object.assign({}, lib.deleted.categories), items: Object.assign({}, lib.deleted.items) };

    const categories = await syncTable('categories', 'id', lib.categories.slice(), tombs.categories, categoryToRow, categoryFromRow);
    const items = await syncTable('library_items', 'type', lib.items.slice(), tombs.items, itemToRow, itemFromRow);

    // Apply unless the user edited their library while we were talking to the cloud.
    if (JSON.stringify([lib.categories, lib.items]) !== before) { again = true; return; }
    categories.sort(function (a, b) { return (a.sortOrder || 0) - (b.sortOrder || 0); });
    RP.library.setUser({ categories: categories, items: items, deleted: tombs });
    RP.storage.saveUserLibrary(RP.library.getUser());
    const meta = RP.storage.loadSync();
    meta.libDirty = false;
    RP.storage.saveSync(meta);
    if (JSON.stringify([categories, items]) !== before && hooks.libraryReplaced) hooks.libraryReplaced();
  }

  // ---------------------------------------------------------------- running

  async function syncAll() {
    if (!client || !user) return;
    if (running) { again = true; return; }
    running = true;
    clearTimeout(delayTimer);
    try {
      setState('syncing');
      hooks.flush();
      // Make sure we hold a valid session (this also renews an expired token).
      const sess = await client.auth.getSession();
      if (!sess.data.session) {
        if (sess.error && isNetworkError(sess.error)) { setState('offline'); return; }
        if (!navigator.onLine) { setState('offline'); return; }
        RP.auth.forceSignedOut();
        return;
      }
      await syncLibrary();
      await syncProjects();
      const pending = Object.keys(skippedConflicts).length;
      setState(pending ? 'conflict' : 'synced');
    } catch (err) {
      if (err && err.race) again = true;
      else if (isNetworkError(err)) setState('offline');
      else setState('error', (err && err.message) || 'Unknown error');
    } finally {
      running = false;
      if (again && client) {
        again = false;
        delayTimer = setTimeout(syncAll, 300);
      }
    }
  }

  function hasUnsynced() {
    const meta = RP.storage.loadSync();
    if (Object.keys(meta.deleted).length || meta.libDirty) return true;
    return RP.storage.listLayouts().some(function (l) {
      const ls = meta.synced[l.id];
      return ls === undefined || ms(l.updatedAt) > ls;
    });
  }

  // Called when something changed locally: sync shortly (edits arrive in bursts).
  function localChanged() {
    if (!client || !user) return;
    if (current.state !== 'syncing') setState(navigator.onLine ? 'pending' : 'offline');
    clearTimeout(delayTimer);
    delayTimer = setTimeout(syncAll, SYNC_DELAY_MS);
  }

  function libraryChanged() {
    const meta = RP.storage.loadSync();
    meta.libDirty = true;
    RP.storage.saveSync(meta);
    localChanged();
  }

  function syncNow(manual) {
    if (manual) skippedConflicts = {};
    return syncAll();
  }

  function onOnline() { syncNow(false); }
  function onOffline() { if (user) setState('offline'); }
  function onVisible() { if (document.visibilityState === 'visible') syncNow(false); }

  function start(u, h) {
    stop();
    user = u;
    hooks = h;
    client = RP.auth.client();
    skippedConflicts = {};
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisible);
    periodTimer = setInterval(function () {
      if (document.visibilityState === 'visible') syncNow(false);
    }, PERIOD_MS);
    setState(navigator.onLine ? 'pending' : 'offline');
    return syncNow(false); // resolves when the first sync pass ends
  }

  function stop() {
    clearTimeout(delayTimer);
    clearInterval(periodTimer);
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
    document.removeEventListener('visibilitychange', onVisible);
    client = null;
    user = null;
    running = false;
    again = false;
    current = { state: 'idle', message: '' };
  }

  RP.cloud = {
    start: start,
    stop: stop,
    syncNow: syncNow,
    localChanged: localChanged,
    libraryChanged: libraryChanged,
    hasUnsynced: hasUnsynced,
    status: function () { return current; },
    BUSY: BUSY,
  };
})(window.RP = window.RP || {});
