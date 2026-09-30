// Shared form helpers: a text box that takes a typed length (12' 6", 19 5/8", 381 cm ...).
(function (RP) {
  'use strict';

  let msgTimer = 0;

  // Short message shown in the toolbar; clears itself.
  function message(text) {
    const el = document.getElementById('msg');
    el.textContent = text;
    clearTimeout(msgTimer);
    if (text) msgTimer = setTimeout(function () { el.textContent = ''; }, 6000);
  }

  // opts: { get(): inches, set(inches), min, max, units(): 'imperial'|'metric' }
  // Returns { sync() } which refreshes the box unless the user is typing in it.
  function bindLength(input, opts) {
    const U = RP.units;

    function show() {
      input.value = U.formatLength(opts.get(), opts.units());
    }

    input.addEventListener('change', function () {
      const inches = U.parseLength(input.value, opts.units() === 'metric' ? 'cm' : 'in');
      if (inches === null || inches < opts.min || inches > opts.max) {
        message('Could not use "' + input.value + '". Try 12\' 6", 19 5/8", 150 in, or 381 cm (' +
          U.formatImperial(opts.min) + ' to ' + U.formatImperial(opts.max) + ').');
        input.classList.add('invalid');
        setTimeout(function () { input.classList.remove('invalid'); }, 1500);
      } else {
        message('');
        input.classList.remove('invalid');
        if (Math.abs(inches - opts.get()) > 1e-9) opts.set(inches);
      }
      show();
    });
    input.addEventListener('focus', function () { input.select(); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') input.blur();
      if (e.key === 'Escape') { show(); input.blur(); }
    });

    return {
      sync: function () { if (document.activeElement !== input) show(); },
    };
  }

  RP.fields = { message: message, bindLength: bindLength };
})(window.RP = window.RP || {});
