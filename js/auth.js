// Sign-in with Supabase (email + password, password reset by email).
// The app never reads or shows layout data until a session exists.
(function (RP) {
  'use strict';

  const CFG = RP.config;
  let client = null;
  let callbacks = null;
  let user = null;          // set while the app is open for someone
  let recovering = false;   // arrived from a password-reset email link

  function hashParam(name) {
    const m = new RegExp('[#&?]' + name + '=([^&]*)').exec(location.hash || '');
    return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : '';
  }

  function cleanUrl() {
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignore */ }
  }

  function friendly(error) {
    const msg = (error && error.message) || String(error);
    if (/invalid login|invalid credentials/i.test(msg)) return 'That email or password is not right.';
    if (/failed to fetch|network|load failed/i.test(msg) || !navigator.onLine) return 'Could not reach the server. Check your connection and try again.';
    if (/rate limit|too many/i.test(msg)) return 'Too many tries. Wait a little and try again.';
    if (/same password|different from the old/i.test(msg)) return 'Choose a password different from your old one.';
    return msg;
  }

  function enter(u, offline) {
    user = { id: u.id, email: u.email || '' };
    RP.storage.setLastUser(user);
    callbacks.onSignedIn(user, { offline: !!offline });
  }

  // Start-up: decide between the app, the sign-in screen and the new-password screen.
  async function start() {
    const linkError = hashParam('error_description');
    let result;
    try {
      result = await client.auth.getSession();
    } catch (e) {
      result = { data: { session: null }, error: e };
    }
    const session = result.data && result.data.session;

    if (recovering && session) {
      RP.authscreen.show('newpass');
      return;
    }
    if (session) {
      cleanUrl();
      enter(session.user, false);
      return;
    }
    // No usable session. If the device was signed in before and we simply cannot reach the
    // server (or renew the token yet), open in offline mode rather than locking the user out.
    const last = RP.storage.getLastUser();
    let haveStoredSession = false;
    try { haveStoredSession = localStorage.getItem(CFG.AUTH_STORAGE_KEY) !== null; } catch (e) { /* ignore */ }
    if (last && haveStoredSession && (result.error || !navigator.onLine)) {
      enter(last, true);
      return;
    }
    cleanUrl();
    RP.authscreen.show('signin', linkError ? 'That link has expired or was already used. Request a new reset email.' : '');
  }

  function init(cb) {
    callbacks = cb;
    recovering = /[#&]type=recovery/.test(location.hash || '');
    if (!window.supabase || !window.supabase.createClient) {
      RP.authscreen.show('error', 'The sign-in library could not be loaded. Check your connection and reload the page.');
      return;
    }
    client = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        storageKey: CFG.AUTH_STORAGE_KEY,
        persistSession: true,   // stay signed in on this device until sign-out
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
    // Do not call Supabase from inside this handler (it can deadlock), so hop out with setTimeout.
    client.auth.onAuthStateChange(function (event, session) {
      setTimeout(function () { onAuthEvent(event, session); }, 0);
    });
    start();
  }

  function onAuthEvent(event, session) {
    if (event === 'PASSWORD_RECOVERY') {
      recovering = true;
      RP.authscreen.show('newpass');
    } else if (event === 'SIGNED_OUT') {
      if (user) leave(false);
    } else if (event === 'SIGNED_IN') {
      if (!user && !recovering && session) enter(session.user, false); // signed in from another tab
    } else if (event === 'TOKEN_REFRESHED') {
      if (callbacks.onTokenRefreshed) callbacks.onTokenRefreshed();
    }
  }

  // Close the app for this user. clearCache = also wipe this device's cached copy of their data.
  function leave(clearCache) {
    const old = user;
    user = null;
    RP.storage.clearLastUser();
    callbacks.onSignedOut(old, !!clearCache);
    RP.authscreen.show('signin', '');
  }

  async function signIn(email, password) {
    try {
      const res = await client.auth.signInWithPassword({ email: email, password: password });
      if (res.error) return { error: friendly(res.error) };
      enter(res.data.user, false);
      return {};
    } catch (e) {
      return { error: friendly(e) };
    }
  }

  async function sendReset(email) {
    try {
      const res = await client.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
      return res.error ? { error: friendly(res.error) } : {};
    } catch (e) {
      return { error: friendly(e) };
    }
  }

  async function setNewPassword(password) {
    try {
      const res = await client.auth.updateUser({ password: password });
      if (res.error) return { error: friendly(res.error) };
      recovering = false;
      cleanUrl();
      enter(res.data.user, false);
      return {};
    } catch (e) {
      return { error: friendly(e) };
    }
  }

  // Sign out on this device. Works offline too: the stored session is removed either way.
  async function signOut() {
    try { await client.auth.signOut({ scope: 'local' }); } catch (e) { /* ignore: removed below */ }
    try { localStorage.removeItem(CFG.AUTH_STORAGE_KEY); } catch (e) { /* ignore */ }
    if (user) leave(true);
  }

  // The session is gone or rejected while the app is open (for example another device revoked it).
  function forceSignedOut() {
    try { localStorage.removeItem(CFG.AUTH_STORAGE_KEY); } catch (e) { /* ignore */ }
    if (user) leave(false);
  }

  RP.auth = {
    init: init,
    signIn: signIn,
    sendReset: sendReset,
    setNewPassword: setNewPassword,
    signOut: signOut,
    forceSignedOut: forceSignedOut,
    client: function () { return client; },
    user: function () { return user; },
  };
})(window.RP = window.RP || {});
