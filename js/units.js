// Length parsing and formatting. Every length in the app is stored in inches.
(function (RP) {
  'use strict';

  const INCH_PER_CM = 1 / 2.54;

  function normalize(text) {
    return text
      .toLowerCase()
      .replace(/[′’‘`]/g, "'")
      .replace(/[″“”]/g, '"')
      .replace(/''/g, '"')
      .trim();
  }

  // "12", "12.5", "5/8", "19 5/8" -> number, or null
  function parseNumber(s) {
    s = s.trim();
    let m = /^(\d+\.?\d*|\.\d+)(?:\s+(\d+)\/(\d+))?$/.exec(s);
    if (m) {
      let v = parseFloat(m[1]);
      if (m[2] !== undefined) {
        const d = Number(m[3]);
        if (!d) return null;
        v += Number(m[2]) / d;
      }
      return v;
    }
    m = /^(\d+)\/(\d+)$/.exec(s);
    if (m) {
      const d = Number(m[2]);
      return d ? Number(m[1]) / d : null;
    }
    return null;
  }

  function stripInchSuffix(s) {
    return s.replace(/\s*(?:"|in(?:ch(?:es)?)?)$/, '').trim();
  }

  // Text -> inches, or null if it can't be read.
  // Understands 12' 6", 12'6, 12.5 ft, 150 in, 19 5/8", 1' 7 5/8", 381 cm, 3.8 m.
  // A bare number uses defaultUnit: 'in' (default), 'ft', or 'cm'.
  function parseLength(text, defaultUnit) {
    if (typeof text !== 'string') return null;
    const s = normalize(text);
    if (!s) return null;

    let m = /^(.+?)\s*(mm|cm|m)$/.exec(s);
    if (m) {
      const n = parseNumber(m[1]);
      if (n === null) return null;
      const cmPer = { mm: 0.1, cm: 1, m: 100 }[m[2]];
      return n * cmPer * INCH_PER_CM;
    }

    m = /^(\d+\.?\d*|\.\d+)\s*(?:'|ft|feet|foot)\s*-?\s*(.*)$/.exec(s);
    if (m) {
      const feet = parseFloat(m[1]);
      const rest = stripInchSuffix(m[2]);
      let inches = 0;
      if (rest) {
        inches = parseNumber(rest);
        if (inches === null) return null;
      }
      return feet * 12 + inches;
    }

    const stripped = stripInchSuffix(s);
    const n = parseNumber(stripped);
    if (n === null) return null;
    if (stripped !== s) return n; // had an inch marker
    if (defaultUnit === 'cm') return n * INCH_PER_CM;
    if (defaultUnit === 'ft') return n * 12;
    return n;
  }

  // Inches -> 12' 6", 19 5/8", 1' 7 5/8" (nearest 1/16")
  function formatImperial(inches) {
    const sixteenths = Math.round(inches * 16);
    const sign = sixteenths < 0 ? '-' : '';
    let t = Math.abs(sixteenths);
    const feet = Math.floor(t / 192);
    t -= feet * 192;
    const whole = Math.floor(t / 16);
    let n = t - whole * 16;
    let d = 16;
    while (n && n % 2 === 0) { n /= 2; d /= 2; }

    let inchStr = '';
    if (whole || n) {
      inchStr = (whole ? String(whole) : '') + (n ? (whole ? ' ' : '') + n + '/' + d : '') + '"';
    }
    if (feet && inchStr) return sign + feet + "' " + inchStr;
    if (feet) return sign + feet + "'";
    return sign + (inchStr || '0"');
  }

  function formatMetric(inches) {
    const cm = inches / INCH_PER_CM;
    if (Math.abs(cm) >= 100) return +(cm / 100).toFixed(2) + ' m';
    return +cm.toFixed(1) + ' cm';
  }

  function formatLength(inches, units) {
    return units === 'metric' ? formatMetric(inches) : formatImperial(inches);
  }

  // Area given in square inches.
  function formatAreaSq(sq, units) {
    if (units === 'metric') return +(sq * 0.00064516).toFixed(2) + ' m²';
    return +(sq / 144).toFixed(1) + ' sq ft';
  }

  function formatArea(widthIn, lengthIn, units) {
    return formatAreaSq(widthIn * lengthIn, units);
  }

  RP.units = { INCH_PER_CM, parseLength, formatLength, formatImperial, formatMetric, formatArea, formatAreaSq };
})(window.RP = window.RP || {});
