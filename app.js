/*
 * Tip Splitter — inputs module.
 *
 * Contract for the rest of the app:
 *   TipSplitter.getValues() ->
 *     { bill, people, tipChoice, tipPercent, tipTenths, roundUp, valid, errors }
 *     bill       : number | null   (null when the field is invalid or empty)
 *     people     : number | null   (null when the field is invalid or empty)
 *     tipChoice  : '10' | '15' | '20' | 'other'
 *     tipPercent : number | null   (e.g. 15 or 12.5; null when "Otro" is empty/invalid)
 *     tipTenths  : integer | null  (tip in tenths of a percent: 12.5% -> 125).
 *                                   Use this for maths — it never goes through floats.
 *     roundUp    : boolean         ("Redondear por persona"; starts off)
 *     valid      : true when bill, people and the tip are all valid
 *     errors     : { bill, people, tip }  ('' when the field is fine; an empty
 *                                          "Otro" field is invalid but has no message)
 *   TipSplitter.onChange(fn)  -> subscribe; fn(values) runs on every change.
 *                                Returns an unsubscribe function.
 *   document also receives a 'tipsplitter:change' CustomEvent with the same
 *   values in event.detail.
 */
(function () {
  'use strict';

  var TIP_OPTIONS = [10, 15, 20];
  var DEFAULT_TIP = 15;
  var OTHER = 'other';

  // ---- Pure validation -------------------------------------------------

  function validateBill(raw) {
    var text = String(raw == null ? '' : raw).trim();
    if (text === '') return { value: null, error: 'Enter the bill total.' };
    if (!/^-?\d*(\.\d{0,2})?$/.test(text) || text === '.' || text === '-') {
      return { value: null, error: 'Use a number with up to two decimals.' };
    }
    var n = Number(text);
    if (!isFinite(n) || n <= 0) return { value: null, error: 'The bill must be greater than 0.' };
    return { value: n, error: '' };
  }

  function validatePeople(raw) {
    var text = String(raw == null ? '' : raw).trim();
    if (text === '') return { value: null, error: 'Enter how many people are paying.' };
    if (!/^-?\d+$/.test(text)) return { value: null, error: 'Use a whole number of people.' };
    var n = Number(text);
    if (!isFinite(n) || n < 1) return { value: null, error: 'There must be at least 1 person.' };
    return { value: n, error: '' };
  }

  function validateTip(raw) {
    var n = Number(raw);
    return TIP_OPTIONS.indexOf(n) !== -1 ? n : DEFAULT_TIP;
  }

  // "Otro" text -> { tenths, error }. Accepts "," or "." as decimal separator.
  // tenths is an integer (12,5 -> 125) built from the digits, never via floats.
  // Empty text: tenths null and no message (results just show "—").
  function validateTipCustom(raw) {
    var text = String(raw == null ? '' : raw).trim();
    if (text === '') return { tenths: null, error: '' };
    var m = /^(-?)(\d*)(?:[.,](\d+))?$/.exec(text);
    if (!m || (m[2] === '' && m[3] == null)) {
      return { tenths: null, error: 'Escribí un número, por ejemplo 18 o 12,5.' };
    }
    if (m[3] != null && m[3].length > 1) {
      return { tenths: null, error: 'Usá hasta un decimal.' };
    }
    var whole = m[2].replace(/^0+(?=\d)/, '');
    if (whole.length > 4) return { tenths: null, error: 'El porcentaje debe estar entre 0 y 100.' };
    var tenths = Number(whole || '0') * 10 + Number(m[3] || '0');
    if (m[1] === '-' && tenths !== 0) {
      return { tenths: null, error: 'El porcentaje debe estar entre 0 y 100.' };
    }
    if (tenths > 1000) return { tenths: null, error: 'El porcentaje debe estar entre 0 y 100.' };
    return { tenths: tenths, error: '' };
  }

  // ---- State ------------------------------------------------------------

  var state = {
    bill: null,
    people: null,
    tipChoice: String(DEFAULT_TIP),
    tipTenths: DEFAULT_TIP * 10,
    roundUp: false,
    valid: false,
    errors: { bill: '', people: '', tip: '' }
  };
  var listeners = [];

  function snapshot() {
    return {
      bill: state.bill,
      people: state.people,
      tipChoice: state.tipChoice,
      tipPercent: state.tipTenths == null ? null : state.tipTenths / 10,
      tipTenths: state.tipTenths,
      roundUp: state.roundUp,
      valid: state.valid,
      errors: { bill: state.errors.bill, people: state.errors.people, tip: state.errors.tip }
    };
  }

  function notify() {
    var values = snapshot();
    listeners.forEach(function (fn) {
      try { fn(values); } catch (err) { console.error('TipSplitter listener failed', err); }
    });
    try {
      document.dispatchEvent(new CustomEvent('tipsplitter:change', { detail: values }));
    } catch (err) { console.error('TipSplitter event failed', err); }
  }

  // ---- DOM --------------------------------------------------------------

  var billInput, peopleInput, billError, peopleError, tipRadios;
  var customInput, customError, roundUpInput;

  // -> { choice, tenths, error }
  function readTip() {
    for (var i = 0; i < tipRadios.length; i++) {
      if (!tipRadios[i].checked) continue;
      if (tipRadios[i].value === OTHER) {
        var custom = validateTipCustom(customInput.value);
        return { choice: OTHER, tenths: custom.tenths, error: custom.error };
      }
      var fixed = validateTip(tipRadios[i].value);
      return { choice: String(fixed), tenths: fixed * 10, error: '' };
    }
    return { choice: String(DEFAULT_TIP), tenths: DEFAULT_TIP * 10, error: '' };
  }

  function rawValue(input) {
    // type=number reports '' for text the browser could not parse (e.g. "1.2.3"),
    // so an unparsable entry is treated as empty rather than crashing.
    return input.validity && input.validity.badInput ? 'invalid' : input.value;
  }

  function showError(input, el, message) {
    el.textContent = message;
    input.setAttribute('aria-invalid', message ? 'true' : 'false');
  }

  // Reads every control into state; showFieldErrors=false on first load so
  // untouched empty fields are not flagged.
  function readAll(showFieldErrors) {
    var bill = validateBill(rawValue(billInput));
    var people = validatePeople(rawValue(peopleInput));
    var tip = readTip();
    state.bill = bill.value;
    state.people = people.value;
    state.tipChoice = tip.choice;
    state.tipTenths = tip.tenths;
    state.roundUp = !!roundUpInput.checked;
    state.errors.bill = bill.error;
    state.errors.people = people.error;
    state.errors.tip = tip.error;
    state.valid = !bill.error && !people.error && !tip.error && tip.tenths != null;
    customInput.disabled = tip.choice !== OTHER;
    // The "Otro" field reports its own errors as soon as it is in use.
    showError(customInput, customError, tip.error);
    if (showFieldErrors) {
      showError(billInput, billError, bill.error);
      showError(peopleInput, peopleError, people.error);
    }
  }

  function update() {
    try {
      readAll(true);
    } catch (err) {
      console.error('TipSplitter update failed', err);
    }
    notify();
  }

  function onTipChange(event) {
    update();
    if (event && event.target && event.target.value === OTHER && event.target.checked) {
      try { customInput.focus(); } catch (err) { /* focus is best-effort */ }
    }
  }

  function init() {
    billInput = document.getElementById('bill');
    peopleInput = document.getElementById('people');
    billError = document.getElementById('bill-error');
    peopleError = document.getElementById('people-error');
    tipRadios = document.querySelectorAll('input[name="tip"]');
    customInput = document.getElementById('tip-custom');
    customError = document.getElementById('tip-custom-error');
    roundUpInput = document.getElementById('round-up');
    if (!billInput || !peopleInput || !billError || !peopleError || !tipRadios.length ||
        !customInput || !customError || !roundUpInput) {
      console.error('TipSplitter: expected controls are missing from index.html');
      return;
    }

    billInput.addEventListener('input', update);
    peopleInput.addEventListener('input', update);
    customInput.addEventListener('input', update);
    roundUpInput.addEventListener('change', update);
    for (var i = 0; i < tipRadios.length; i++) {
      tipRadios[i].addEventListener('change', onTipChange);
    }

    // Rounding always starts off, even if the browser restored the checkbox.
    roundUpInput.checked = false;
    try {
      readAll(false);
    } catch (err) {
      console.error('TipSplitter init failed', err);
    }
    notify();
  }

  // ---- Public API -------------------------------------------------------

  window.TipSplitter = {
    TIP_OPTIONS: TIP_OPTIONS.slice(),
    getValues: snapshot,
    onChange: function (fn) {
      if (typeof fn !== 'function') return function () {};
      listeners.push(fn);
      return function () {
        var i = listeners.indexOf(fn);
        if (i !== -1) listeners.splice(i, 1);
      };
    },
    // Exposed for testing; pure functions with no DOM access.
    validateBill: validateBill,
    validatePeople: validatePeople,
    validateTipCustom: validateTipCustom
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

/*
 * Tip Splitter — results module.
 *
 * All money is handled as integer cents so no floating-point artifacts reach
 * the screen. The tip is rounded to the nearest cent before being added to the
 * bill; when the total does not divide evenly, the leftover cents go one each
 * to the first people, so the parts always add up to the exact total.
 * With "Redondear por persona" on, everyone pays the next whole amount and the
 * difference is added to the tip (shown as the real tip and its %).
 */
(function () {
  'use strict';

  var DASH = '—';

  function isCount(n) {
    return typeof n === 'number' && Number.isSafeInteger(n);
  }

  // Bill (already validated to at most 2 decimals) -> integer cents, or null.
  function toCents(bill) {
    if (typeof bill !== 'number' || !isFinite(bill)) return null;
    var cents = Math.round(bill * 100);
    return isCount(cents) && cents > 0 ? cents : null;
  }

  // Integer a / b rounded half up (a >= 0, b > 0), without float division.
  function divRound(a, b) {
    var q = Math.floor(a / b);
    var r = a - q * b;
    if (r < 0) { q -= 1; r += b; }
    if (r >= b) { q += 1; r -= b; }
    return 2 * r >= b ? q + 1 : q;
  }

  // Returns { billCents, tipCents, totalCents, base, extra, people } or null.
  //   tipTenths is the tip in tenths of a percent (12,5% -> 125), 0..1000.
  //   extra people pay base + 1 cent, the remaining (people - extra) pay base.
  function calculate(billCents, people, tipTenths) {
    if (!isCount(billCents) || billCents <= 0) return null;
    if (!isCount(people) || people < 1) return null;
    if (!isCount(tipTenths) || tipTenths < 0 || tipTenths > 1000) return null;
    var scaled = billCents * tipTenths;
    if (!isCount(scaled)) return null;
    var tipCents = divRound(scaled, 1000);
    var totalCents = billCents + tipCents;
    if (!isCount(totalCents)) return null;
    var base = Math.floor(totalCents / people);
    var extra = totalCents - base * people;
    return {
      billCents: billCents, tipCents: tipCents, totalCents: totalCents,
      base: base, extra: extra, people: people
    };
  }

  // "Redondear por persona": everyone pays the next whole amount (never down),
  // and what is added goes to the tip. Takes and returns calculate()'s shape.
  function roundUpSplit(r) {
    if (!r || !isCount(r.billCents) || !isCount(r.totalCents) || !isCount(r.people)) return null;
    if (r.people < 1) return null;
    var unit = r.people * 100;
    if (!isCount(unit) || !isCount(r.totalCents + unit)) return null;
    var wholePerPerson = Math.floor((r.totalCents + unit - 1) / unit);
    var base = wholePerPerson * 100;
    var totalCents = base * r.people;
    if (!isCount(base) || !isCount(totalCents)) return null;
    return {
      billCents: r.billCents, tipCents: totalCents - r.billCents, totalCents: totalCents,
      base: base, extra: 0, people: r.people
    };
  }

  // Share of the bill in tenths of a percent, rounded to the nearest tenth.
  function percentTenths(partCents, billCents) {
    if (!isCount(partCents) || partCents < 0 || !isCount(billCents) || billCents <= 0) return null;
    var scaled = partCents * 1000;
    return isCount(scaled) ? divRound(scaled, billCents) : null;
  }

  // 160 -> "16,0%", 125 -> "12,5%".
  function formatTenths(tenths) {
    if (!isCount(tenths) || tenths < 0) return DASH;
    return Math.floor(tenths / 10) + ',' + (tenths % 10) + '%';
  }

  // 125000 -> "$1.250,00". Manual on purpose: Intl's es-* locales differ on
  // grouping 4-digit numbers and on the space after "$".
  function formatCents(cents) {
    if (!isCount(cents) || cents < 0) return DASH;
    var whole = String(Math.floor(cents / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    var frac = String(cents % 100);
    if (frac.length < 2) frac = '0' + frac;
    return '$' + whole + ',' + frac;
  }

  var tipEl, tipLabelEl, tipRateEl, totalEl, perPersonEl, noteEl;

  function setRounding(on, rateText) {
    tipLabelEl.textContent = on ? 'Propina real' : 'Propina';
    tipRateEl.textContent = on && rateText ? rateText : '';
    tipRateEl.hidden = !(on && rateText);
  }

  function setLines(lines) {
    while (perPersonEl.firstChild) perPersonEl.removeChild(perPersonEl.firstChild);
    lines.forEach(function (text) {
      var span = document.createElement('span');
      span.className = 'line';
      span.textContent = text;
      perPersonEl.appendChild(span);
    });
  }

  function showEmpty(values) {
    setRounding(!!(values && values.roundUp), '');
    tipEl.textContent = DASH;
    totalEl.textContent = DASH;
    setLines([DASH]);
    noteEl.textContent = '';
    noteEl.hidden = true;
  }

  function render(values) {
    try {
      var r = values && values.valid
        ? calculate(toCents(values.bill), values.people, values.tipTenths)
        : null;
      if (r && values.roundUp) r = roundUpSplit(r);
      if (!r) { showEmpty(values); return; }

      if (values.roundUp) {
        var real = percentTenths(r.tipCents, r.billCents);
        if (real == null) { showEmpty(values); return; }
        setRounding(true, formatTenths(values.tipTenths) + ' elegido → ' + formatTenths(real) + ' real');
      } else {
        setRounding(false, '');
      }
      tipEl.textContent = formatCents(r.tipCents);
      totalEl.textContent = formatCents(r.totalCents);
      if (r.extra === 0) {
        setLines([formatCents(r.base)]);
        noteEl.textContent = '';
        noteEl.hidden = true;
      } else {
        setLines([
          r.extra + ' × ' + formatCents(r.base + 1),
          (r.people - r.extra) + ' × ' + formatCents(r.base)
        ]);
        noteEl.textContent = r.extra === 1
          ? '1 persona paga $0,01 más'
          : r.extra + ' personas pagan $0,01 más';
        noteEl.hidden = false;
      }
    } catch (err) {
      console.error('TipSplitter results failed', err);
      showEmpty(values);
    }
  }

  function init() {
    tipEl = document.getElementById('tip-amount');
    tipLabelEl = document.getElementById('tip-label');
    tipRateEl = document.getElementById('tip-rate-note');
    totalEl = document.getElementById('total-amount');
    perPersonEl = document.getElementById('per-person');
    noteEl = document.getElementById('per-person-note');
    if (!tipEl || !tipLabelEl || !tipRateEl || !totalEl || !perPersonEl || !noteEl) {
      console.error('TipSplitter: result elements are missing from index.html');
      return;
    }
    var api = window.TipSplitter;
    if (!api || typeof api.onChange !== 'function' || typeof api.getValues !== 'function') {
      console.error('TipSplitter: inputs module is not available');
      showEmpty(null);
      return;
    }
    api.onChange(render);
    render(api.getValues());
  }

  if (window.TipSplitter) {
    // Exposed for testing; pure functions with no DOM access.
    window.TipSplitter.toCents = toCents;
    window.TipSplitter.calculate = calculate;
    window.TipSplitter.formatCents = formatCents;
    window.TipSplitter.roundUpSplit = roundUpSplit;
    window.TipSplitter.percentTenths = percentTenths;
    window.TipSplitter.formatTenths = formatTenths;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
