// The full-page sign-in screen. Until someone signs in, this is all a visitor sees.
(function (RP) {
  'use strict';

  const $ = function (id) { return document.getElementById(id); };
  const FORMS = ['signin', 'reset', 'newpass'];

  function setBusy(form, busy) {
    Array.prototype.forEach.call(form.querySelectorAll('button, input'), function (n) { n.disabled = busy; });
  }

  // which: 'signin' | 'reset' | 'newpass' | 'error'; message is shown under the form.
  function show(which, message) {
    document.body.dataset.state = 'signedout';
    FORMS.forEach(function (f) { $('form-' + f).hidden = (f !== which); });
    $('auth-error-only').hidden = which !== 'error';
    const msg = $('auth-msg');
    msg.textContent = message || '';
    msg.className = 'auth-msg' + (which === 'error' ? ' bad' : '');
    if (which === 'error') $('auth-error-only').textContent = message || '';
    const first = which === 'signin' ? $('si-email') : which === 'reset' ? $('rs-email') : which === 'newpass' ? $('np-pass') : null;
    if (first) setTimeout(function () { first.focus(); }, 0);
  }

  function note(text, bad) {
    const msg = $('auth-msg');
    msg.textContent = text;
    msg.className = 'auth-msg' + (bad ? ' bad' : '');
  }

  function init() {
    $('form-signin').addEventListener('submit', function (e) {
      e.preventDefault();
      const form = e.target;
      const email = $('si-email').value.trim();
      const pass = $('si-pass').value;
      if (!email || !pass) { note('Enter your email and password.', true); return; }
      setBusy(form, true);
      note('Signing in…');
      RP.auth.signIn(email, pass).then(function (res) {
        setBusy(form, false);
        if (res.error) note(res.error, true);
        else $('si-pass').value = '';
      });
    });

    $('to-reset').addEventListener('click', function () {
      $('rs-email').value = $('si-email').value;
      show('reset', '');
    });
    $('to-signin').addEventListener('click', function () { show('signin', ''); });

    $('form-reset').addEventListener('submit', function (e) {
      e.preventDefault();
      const form = e.target;
      const email = $('rs-email').value.trim();
      if (!email) { note('Enter the email for your account.', true); return; }
      setBusy(form, true);
      note('Sending…');
      RP.auth.sendReset(email).then(function (res) {
        setBusy(form, false);
        if (res.error) note(res.error, true);
        else note('If that email has an account, a reset link is on its way. Open it on this device.');
      });
    });

    $('form-newpass').addEventListener('submit', function (e) {
      e.preventDefault();
      const form = e.target;
      const a = $('np-pass').value;
      const b = $('np-pass2').value;
      if (a.length < 8) { note('Use at least 8 characters.', true); return; }
      if (a !== b) { note('The two passwords do not match.', true); return; }
      setBusy(form, true);
      note('Saving…');
      RP.auth.setNewPassword(a).then(function (res) {
        setBusy(form, false);
        if (res.error) note(res.error, true);
        else { $('np-pass').value = ''; $('np-pass2').value = ''; }
      });
    });
  }

  RP.authscreen = { init: init, show: show };
})(window.RP = window.RP || {});
