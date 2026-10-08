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
