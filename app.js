/*
 * Tip Splitter — inputs module.
 *
 * Contract for the rest of the app:
 *   TipSplitter.getValues() -> { bill, people, tipPercent, valid, errors }
 *     bill       : number | null   (null when the field is invalid or empty)
 *     people     : number | null   (null when the field is invalid or empty)
 *     tipPercent : 10 | 15 | 20
 *     valid      : true when both bill and people are valid
 *     errors     : { bill: string, people: string }  ('' when the field is fine)
 *   TipSplitter.onChange(fn)  -> subscribe; fn(values) runs on every change.
 *                                Returns an unsubscribe function.
 *   document also receives a 'tipsplitter:change' CustomEvent with the same
 *   values in event.detail.
 */
(function () {
  'use strict';

  var TIP_OPTIONS = [10, 15, 20];
  var DEFAULT_TIP = 15;

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

  // ---- State ------------------------------------------------------------

  var state = {
    bill: null,
    people: null,
    tipPercent: DEFAULT_TIP,
    valid: false,
    errors: { bill: '', people: '' }
  };
  var listeners = [];

  function snapshot() {
    return {
      bill: state.bill,
      people: state.people,
      tipPercent: state.tipPercent,
      valid: state.valid,
      errors: { bill: state.errors.bill, people: state.errors.people }
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

  function readTip() {
    for (var i = 0; i < tipRadios.length; i++) {
      if (tipRadios[i].checked) return validateTip(tipRadios[i].value);
    }
    return DEFAULT_TIP;
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

  function update() {
    try {
      var bill = validateBill(rawValue(billInput));
      var people = validatePeople(rawValue(peopleInput));
      state.bill = bill.value;
      state.people = people.value;
      state.tipPercent = readTip();
      state.errors.bill = bill.error;
      state.errors.people = people.error;
      state.valid = !bill.error && !people.error;
      showError(billInput, billError, bill.error);
      showError(peopleInput, peopleError, people.error);
    } catch (err) {
      console.error('TipSplitter update failed', err);
    }
    notify();
  }

  function init() {
    billInput = document.getElementById('bill');
    peopleInput = document.getElementById('people');
    billError = document.getElementById('bill-error');
    peopleError = document.getElementById('people-error');
    tipRadios = document.querySelectorAll('input[name="tip"]');
    if (!billInput || !peopleInput || !billError || !peopleError || !tipRadios.length) {
      console.error('TipSplitter: expected controls are missing from index.html');
      return;
    }

    billInput.addEventListener('input', update);
    peopleInput.addEventListener('input', update);
    for (var i = 0; i < tipRadios.length; i++) {
      tipRadios[i].addEventListener('change', update);
    }

    // Initial read, without flagging the untouched empty fields as errors.
    state.tipPercent = readTip();
    var bill = validateBill(rawValue(billInput));
    var people = validatePeople(rawValue(peopleInput));
    state.bill = bill.value;
    state.people = people.value;
    state.errors.bill = bill.error;
    state.errors.people = people.error;
    state.valid = !bill.error && !people.error;
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
    validatePeople: validatePeople
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

  // Returns { tipCents, totalCents, base, extra, people } or null.
  //   extra people pay base + 1 cent, the remaining (people - extra) pay base.
  function calculate(billCents, people, tipPercent) {
    if (!isCount(billCents) || billCents <= 0) return null;
    if (!isCount(people) || people < 1) return null;
    if (!isCount(tipPercent) || tipPercent < 0) return null;
    var scaled = billCents * tipPercent;
    if (!isCount(scaled)) return null;
    var tipCents = Math.round(scaled / 100);
    var totalCents = billCents + tipCents;
    if (!isCount(totalCents)) return null;
    var base = Math.floor(totalCents / people);
    var extra = totalCents - base * people;
    return { tipCents: tipCents, totalCents: totalCents, base: base, extra: extra, people: people };
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

  var tipEl, totalEl, perPersonEl, noteEl;

  function setLines(lines) {
    while (perPersonEl.firstChild) perPersonEl.removeChild(perPersonEl.firstChild);
    lines.forEach(function (text) {
      var span = document.createElement('span');
      span.className = 'line';
      span.textContent = text;
      perPersonEl.appendChild(span);
    });
  }

  function showEmpty() {
    tipEl.textContent = DASH;
    totalEl.textContent = DASH;
    setLines([DASH]);
    noteEl.textContent = '';
    noteEl.hidden = true;
  }

  function render(values) {
    try {
      var r = values && values.valid
        ? calculate(toCents(values.bill), values.people, values.tipPercent)
        : null;
      if (!r) { showEmpty(); return; }

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
      showEmpty();
    }
  }

  function init() {
    tipEl = document.getElementById('tip-amount');
    totalEl = document.getElementById('total-amount');
    perPersonEl = document.getElementById('per-person');
    noteEl = document.getElementById('per-person-note');
    if (!tipEl || !totalEl || !perPersonEl || !noteEl) {
      console.error('TipSplitter: result elements are missing from index.html');
      return;
    }
    var api = window.TipSplitter;
    if (!api || typeof api.onChange !== 'function' || typeof api.getValues !== 'function') {
      console.error('TipSplitter: inputs module is not available');
      showEmpty();
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
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
