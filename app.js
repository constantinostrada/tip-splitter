/*
 * Tip Splitter — inputs module.
 *
 * Contract for the rest of the app:
 *   TipSplitter.getValues() ->
 *     { bill, people, noTip, tipChoice, tipPercent, tipTenths, roundUp, currency,
 *       valid, errors }
 *     bill       : number | null   (null when the field is invalid or empty)
 *     people     : number | null   (null when the field is invalid or empty)
 *     noTip      : number | null   ("Alguien no toma propina": people who pay only
 *                                   their share of the bill; 0 when empty, null when
 *                                   invalid; always < people when valid)
 *     tipChoice  : '10' | '15' | '20' | 'other'
 *     tipPercent : number | null   (e.g. 15 or 12.5; null when "Otro" is empty/invalid)
 *     tipTenths  : integer | null  (tip in tenths of a percent: 12.5% -> 125).
 *                                   Use this for maths — it never goes through floats.
 *     roundUp    : boolean         ("Redondear por persona"; starts off)
 *     currency   : '$' | '€' | 'US$' ("Moneda"; only changes how amounts are written)
 *     mode       : 'equal' | 'items' ("Partes iguales" / "Cuenta detallada")
 *     detail     : { people: [name], items: [{ name, cents, who: [personIndex] }] } | null
 *                  ("Cuenta detallada"; names already filled in as "Persona 2" when
 *                   left empty; null when the ticket is incomplete or invalid)
 *     valid      : equal mode: bill, people, noTip and the tip are all valid;
 *                  items mode: detail and the tip are valid
 *     errors     : { bill, people, noTip, tip, items }  ('' when the field is fine; an
 *                  empty "Otro" field is invalid but has no message; items is one
 *                  message per ticket row)
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
  var CURRENCIES = ['$', '€', 'US$'];
  var DEFAULT_CURRENCY = '$';

  var EQUAL = 'equal';
  var ITEMS = 'items';
  var MAX_PEOPLE = 20;
  var MAX_ITEMS = 50;

  function validateCurrency(raw) {
    return CURRENCIES.indexOf(raw) !== -1 ? raw : DEFAULT_CURRENCY;
  }

  function defaultDetail() {
    return { people: ['', ''], items: [{ name: '', price: '', who: [] }] };
  }

  function cloneDetail(d) {
    return {
      people: d.people.slice(),
      items: d.items.map(function (it) {
        return { name: it.name, price: it.price, who: it.who.slice() };
      })
    };
  }

  // Item price text -> { cents, error, empty }. "1500", "12,50" or "12.50";
  // "1.500" is rejected (thousands or decimals? too ambiguous to guess).
  function validatePrice(raw) {
    var text = String(raw == null ? '' : raw).trim();
    if (text === '') return { cents: null, error: '', empty: true };
    var m = /^(\d{1,9})(?:[.,](\d{1,2}))?$/.exec(text);
    if (!m) return { cents: null, error: 'Escribí un precio, por ejemplo 1500 o 12,50.', empty: false };
    var frac = (m[2] || '') + '00';
    var cents = Number(m[1]) * 100 + Number(frac.slice(0, 2));
    if (cents <= 0) return { cents: null, error: 'El precio tiene que ser mayor que 0.', empty: false };
    return { cents: cents, error: '', empty: false };
  }

  // Ticket rows (raw text) -> { value, errors }. A row with neither name nor
  // price is ignored; any other row must have a valid price and someone who
  // had it. value is null unless every row is fine and at least one counts.
  function validateDetail(d) {
    var names = d.people.map(function (n, i) {
      var t = String(n == null ? '' : n).trim();
      return t || 'Persona ' + (i + 1);
    });
    var items = [];
    var errors = [];
    var ok = true;
    d.items.forEach(function (it, i) {
      var name = String(it.name == null ? '' : it.name).trim();
      var price = validatePrice(it.price);
      var who = it.who.filter(function (p) { return p >= 0 && p < names.length; });
      var err = '';
      if (price.empty) {
        if (name) err = 'Falta el precio.';
      } else if (price.error) {
        err = price.error;
      } else if (!who.length) {
        err = 'Marcá quién consumió este ítem.';
      } else {
        items.push({ name: name || 'Ítem ' + (i + 1), cents: price.cents, who: who });
      }
      errors.push(err);
      if (err) ok = false;
    });
    if (!items.length) ok = false;
    return { value: ok ? { people: names, items: items } : null, errors: errors };
  }

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

  // People who pay no tip. Empty means 0. Needs at least one person left to
  // pay the tip, so it must be below `people` when that is known.
  function validateNoTip(raw, people) {
    var text = String(raw == null ? '' : raw).trim();
    if (text === '') return { value: 0, error: '' };
    if (!/^\d{1,6}$/.test(text)) return { value: null, error: 'Usá un número entero de personas (0 o más).' };
    var n = Number(text);
    if (typeof people === 'number' && n >= people) {
      return { value: null, error: 'Tiene que quedar al menos una persona que pague la propina.' };
    }
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

  // Sorted, unique person indexes in 0..size-1 (anything else is dropped).
  function indexList(list, size) {
    if (!Array.isArray(list)) return [];
    var seen = {};
    var out = [];
    list.forEach(function (p) {
      if (typeof p === 'number' && Number.isInteger(p) && p >= 0 && p < size && !seen[p]) {
        seen[p] = true;
        out.push(p);
      }
    });
    return out.sort(function (a, b) { return a - b; });
  }

  // Raw control text (what getRaw() returns) -> values, the same shape as
  // getValues(). Pure, so a round that is not on screen is computed with the
  // exact rules of the one that is.
  //   named = true (an outing with 2+ rounds): in equal parts the people are
  //   raw.who (indexes into raw.detail.people, the outing's people) and the
  //   ones who skip the tip are raw.noTipWho; raw.people / raw.noTip are ignored.
  function evaluate(raw, named) {
    raw = raw || {};
    var bill = validateBill(raw.bill);
    var mode = raw.mode === ITEMS ? ITEMS : EQUAL;
    var detailIn = raw.detail && Array.isArray(raw.detail.people) && Array.isArray(raw.detail.items)
      ? raw.detail : defaultDetail();
    var detail = validateDetail(detailIn);
    var tip;
    if (raw.tip === OTHER) {
      var custom = validateTipCustom(raw.custom);
      tip = { choice: OTHER, tenths: custom.tenths, error: custom.error };
    } else {
      var fixed = validateTip(raw.tip);
      tip = { choice: String(fixed), tenths: fixed * 10, error: '' };
    }
    var people, noTip, who = null, noTipWho = null;
    if (named) {
      var size = detailIn.people.length;
      who = indexList(raw.who, size);
      noTipWho = indexList(raw.noTipWho, size).filter(function (p) { return who.indexOf(p) !== -1; });
      people = who.length
        ? { value: who.length, error: '' }
        : { value: null, error: 'Marcá quién estuvo en esta ronda.' };
      noTip = who.length && noTipWho.length >= who.length
        ? { value: null, error: 'Tiene que quedar al menos una persona que pague la propina.' }
        : { value: noTipWho.length, error: '' };
    } else {
      people = validatePeople(raw.people);
      noTip = validateNoTip(raw.noTip, people.value);
    }
    var tipOk = !tip.error && tip.tenths != null;
    var values = {
      mode: mode,
      detail: mode === ITEMS ? snapshotDetail(detail.value) : null,
      bill: bill.value,
      people: people.value,
      noTip: noTip.value,
      tipChoice: tip.choice,
      tipPercent: tip.tenths == null ? null : tip.tenths / 10,
      tipTenths: tip.tenths,
      roundUp: !!raw.roundUp,
      currency: validateCurrency(raw.currency),
      valid: mode === ITEMS
        ? tipOk && detail.value != null
        : !bill.error && !people.error && !noTip.error && noTip.value != null && tipOk,
      errors: {
        bill: bill.error, people: people.error, noTip: noTip.error, tip: tip.error,
        items: detail.errors
      }
    };
    if (named) { values.who = who; values.noTipWho = noTipWho; }
    return values;
  }

  // ---- State ------------------------------------------------------------

  var state = {
    bill: null,
    people: null,
    noTip: 0,
    tipChoice: String(DEFAULT_TIP),
    tipTenths: DEFAULT_TIP * 10,
    roundUp: false,
    currency: DEFAULT_CURRENCY,
    mode: EQUAL,
    detail: null,
    valid: false,
    errors: { bill: '', people: '', noTip: '', tip: '', items: [] }
  };
  var listeners = [];
  // Raw text of "Cuenta detallada" (kept while in equal mode too).
  var detailRaw = defaultDetail();
  // Named mode (an outing with 2+ rounds, see the rounds block): detailRaw.people
  // is the outing's people list; in equal parts whoRaw are the ones at this
  // round and noTipRaw the ones among them who skip the tip.
  var named = false;
  var whoRaw = [];
  var noTipRaw = [];

  function snapshotDetail(d) {
    if (!d) return null;
    return {
      people: d.people.slice(),
      items: d.items.map(function (it) {
        return { name: it.name, cents: it.cents, who: it.who.slice() };
      })
    };
  }

  function snapshot() {
    var values = snapshotState();
    if (named) {
      values.who = (state.who || []).slice();
      values.noTipWho = (state.noTipWho || []).slice();
    }
    return values;
  }

  function snapshotState() {
    return {
      mode: state.mode,
      detail: snapshotDetail(state.detail),
      bill: state.bill,
      people: state.people,
      noTip: state.noTip,
      tipChoice: state.tipChoice,
      tipPercent: state.tipTenths == null ? null : state.tipTenths / 10,
      tipTenths: state.tipTenths,
      roundUp: state.roundUp,
      currency: state.currency,
      valid: state.valid,
      errors: {
        bill: state.errors.bill, people: state.errors.people,
        noTip: state.errors.noTip, tip: state.errors.tip,
        items: state.errors.items.slice()
      }
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
  var customInput, customError, roundUpInput, noTipInput, noTipError, currencyInput;
  var modeRadios, equalFields, detailFields, peopleList, itemsList, addPersonBtn, addItemBtn;
  var peopleField, noTipField, detailPeopleField, roundPeopleField, roundPeopleList, roundPeopleError;

  function readMode() {
    for (var i = 0; i < modeRadios.length; i++) {
      if (modeRadios[i].checked && modeRadios[i].value === ITEMS) return ITEMS;
    }
    return EQUAL;
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
    var raw = getRaw();
    // type=number fields: unparsable text counts as invalid, not as empty.
    raw.bill = rawValue(billInput);
    if (!named) {
      raw.people = rawValue(peopleInput);
      raw.noTip = rawValue(noTipInput);
    }
    var v = evaluate(raw, named);
    state.mode = v.mode;
    state.detail = v.detail;
    state.bill = v.bill;
    state.people = v.people;
    state.noTip = v.noTip;
    state.tipChoice = v.tipChoice;
    state.tipTenths = v.tipTenths;
    state.roundUp = v.roundUp;
    state.currency = v.currency;
    state.errors.bill = v.errors.bill;
    state.errors.people = v.errors.people;
    state.errors.noTip = v.errors.noTip;
    state.errors.tip = v.errors.tip;
    state.errors.items = v.errors.items;
    state.valid = v.valid;
    state.who = v.who || null;
    state.noTipWho = v.noTipWho || null;
    equalFields.hidden = v.mode !== EQUAL;
    detailFields.hidden = v.mode !== ITEMS;
    // With 2+ rounds the people come from the outing's list (named mode).
    peopleField.hidden = named;
    noTipField.hidden = named;
    detailPeopleField.hidden = named;
    roundPeopleField.hidden = !named;
    customInput.disabled = v.tipChoice !== OTHER;
    // The "Otro" field reports its own errors as soon as it is in use.
    showError(customInput, customError, v.errors.tip);
    // Same for "Alguien no toma propina": it is optional, so empty is never an error.
    if (named) showError(noTipInput, noTipError, '');
    else showError(noTipInput, noTipError, v.errors.noTip);
    // And for each ticket row.
    showItemErrors(v.errors.items);
    if (named) {
      var msg = v.errors.people || v.errors.noTip;
      if (roundPeopleError.textContent !== msg) roundPeopleError.textContent = msg;
    } else if (roundPeopleError.textContent) {
      roundPeopleError.textContent = '';
    }
    if (showFieldErrors) {
      showError(billInput, billError, v.errors.bill);
      if (!named) showError(peopleInput, peopleError, v.errors.people);
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

  // ---- "Cuenta detallada" editor -----------------------------------------
  //
  // The rows are rebuilt only when people or items are added/removed; typing
  // just updates detailRaw, so focus and the caret are never lost.

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') node.textContent = attrs[k];
      else if (k === 'className') node.className = attrs[k];
      else node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { node.appendChild(c); });
    return node;
  }

  function personLabel(i) {
    var t = String(detailRaw.people[i] || '').trim();
    return t || 'Persona ' + (i + 1);
  }

  function renderPeople() {
    while (peopleList.firstChild) peopleList.removeChild(peopleList.firstChild);
    var only = detailRaw.people.length <= 1;
    detailRaw.people.forEach(function (name, i) {
      var input = el('input', {
        type: 'text', id: 'person-name-' + i, 'data-person': String(i),
        placeholder: 'Persona ' + (i + 1), maxlength: '32', autocomplete: 'off'
      });
      input.value = name;
      var remove = el('button', {
        type: 'button', className: 'btn-small', 'data-remove-person': String(i),
        'aria-label': 'Quitar a ' + personLabel(i), text: 'Quitar'
      });
      remove.disabled = only;
      peopleList.appendChild(el('li', { className: 'detail-row' }, [
        el('label', { className: 'visually-hidden', for: 'person-name-' + i, text: 'Nombre de la persona ' + (i + 1) }),
        input, remove
      ]));
    });
    addPersonBtn.disabled = detailRaw.people.length >= MAX_PEOPLE;
  }

  function renderItems() {
    while (itemsList.firstChild) itemsList.removeChild(itemsList.firstChild);
    var only = detailRaw.items.length <= 1;
    detailRaw.items.forEach(function (it, i) {
      var n = i + 1;
      var name = el('input', {
        type: 'text', id: 'item-name-' + i, 'data-item': String(i), 'data-field': 'name',
        placeholder: 'Ítem ' + n, maxlength: '32', autocomplete: 'off',
        'aria-label': 'Nombre del ítem ' + n
      });
      name.value = it.name;
      var price = el('input', {
        type: 'text', id: 'item-price-' + i, 'data-item': String(i), 'data-field': 'price',
        inputmode: 'decimal', placeholder: 'Precio', maxlength: '32', autocomplete: 'off',
        'aria-label': 'Precio del ítem ' + n, 'aria-describedby': 'item-error-' + i
      });
      price.value = it.price;
      var remove = el('button', {
        type: 'button', className: 'btn-small', 'data-remove-item': String(i),
        'aria-label': 'Quitar el ítem ' + n, text: 'Quitar'
      });
      remove.disabled = only;
      var chips = detailRaw.people.map(function (p, j) {
        var box = el('input', { type: 'checkbox', 'data-item': String(i), 'data-who': String(j) });
        box.checked = it.who.indexOf(j) !== -1;
        return el('label', { className: 'chip' }, [
          box, el('span', { 'data-chip-name': String(j), text: personLabel(j) })
        ]);
      });
      var who = el('fieldset', { className: 'who' }, [
        el('legend', { className: 'visually-hidden', text: 'Quién consumió el ítem ' + n })
      ].concat(chips));
      itemsList.appendChild(el('li', { className: 'detail-item' }, [
        el('div', { className: 'detail-row item-row' }, [name, price, remove]),
        who,
        el('span', { id: 'item-error-' + i, className: 'error', 'aria-live': 'polite' })
      ]));
    });
    addItemBtn.disabled = detailRaw.items.length >= MAX_ITEMS;
  }

  function renderDetail() {
    renderPeople();
    renderItems();
    renderParticipants();
  }

  // Named mode, equal parts: one row per person of the outing with
  // "Estuvo" (takes part in this round) and "Sin propina".
  function renderParticipants() {
    while (roundPeopleList.firstChild) roundPeopleList.removeChild(roundPeopleList.firstChild);
    if (!named) return;
    detailRaw.people.forEach(function (p, i) {
      var inRound = whoRaw.indexOf(i) !== -1;
      var part = el('input', { type: 'checkbox', id: 'part-' + i, 'data-part': String(i) });
      part.checked = inRound;
      var skip = el('input', { type: 'checkbox', 'data-skip': String(i) });
      skip.checked = inRound && noTipRaw.indexOf(i) !== -1;
      skip.disabled = !inRound;
      roundPeopleList.appendChild(el('li', { className: 'detail-row' }, [
        el('label', { className: 'chip part-chip' }, [
          part, el('span', { 'data-part-name': String(i), text: personLabel(i) })
        ]),
        el('label', { className: 'chip' }, [
          skip, el('span', { text: 'Sin propina' })
        ])
      ]));
    });
  }

  function onParticipantsChange(event) {
    var t = event.target;
    var i;
    if (t.hasAttribute('data-part')) {
      i = Number(t.getAttribute('data-part'));
      whoRaw = whoRaw.filter(function (x) { return x !== i; });
      if (t.checked) whoRaw.push(i);
      else noTipRaw = noTipRaw.filter(function (x) { return x !== i; });
      whoRaw.sort(function (a, b) { return a - b; });
      var skip = roundPeopleList.querySelector('[data-skip="' + i + '"]');
      if (skip) { skip.disabled = !t.checked; if (!t.checked) skip.checked = false; }
    } else if (t.hasAttribute('data-skip')) {
      i = Number(t.getAttribute('data-skip'));
      noTipRaw = noTipRaw.filter(function (x) { return x !== i; });
      if (t.checked && whoRaw.indexOf(i) !== -1) noTipRaw.push(i);
      noTipRaw.sort(function (a, b) { return a - b; });
    } else {
      return;
    }
    update();
  }

  function showItemErrors(errors) {
    errors.forEach(function (msg, i) {
      var span = document.getElementById('item-error-' + i);
      var price = document.getElementById('item-price-' + i);
      if (!span || !price) return;
      if (span.textContent !== msg) span.textContent = msg;
      price.setAttribute('aria-invalid', msg ? 'true' : 'false');
    });
  }

  // A name changed: refresh the chips and button labels that show it.
  function refreshNames(i) {
    var label = personLabel(i);
    var spans = itemsList.querySelectorAll('[data-chip-name="' + i + '"]');
    for (var k = 0; k < spans.length; k++) spans[k].textContent = label;
    var btn = peopleList.querySelector('[data-remove-person="' + i + '"]');
    if (btn) btn.setAttribute('aria-label', 'Quitar a ' + label);
    var part = roundPeopleList.querySelector('[data-part-name="' + i + '"]');
    if (part) part.textContent = label;
  }

  function focusId(id) {
    var node = document.getElementById(id);
    if (node) { try { node.focus(); } catch (err) { /* best-effort */ } }
  }

  function onDetailInput(event) {
    var t = event.target;
    if (t.hasAttribute('data-person')) {
      var p = Number(t.getAttribute('data-person'));
      if (p < detailRaw.people.length) { detailRaw.people[p] = t.value; refreshNames(p); }
    } else if (t.hasAttribute('data-field')) {
      var it = detailRaw.items[Number(t.getAttribute('data-item'))];
      var field = t.getAttribute('data-field');
      if (it && (field === 'name' || field === 'price')) it[field] = t.value;
    } else {
      return;
    }
    update();
  }

  function onDetailChange(event) {
    var t = event.target;
    if (!t.hasAttribute('data-who')) return;
    var it = detailRaw.items[Number(t.getAttribute('data-item'))];
    var j = Number(t.getAttribute('data-who'));
    if (!it) return;
    it.who = it.who.filter(function (x) { return x !== j; });
    if (t.checked) it.who.push(j);
    it.who.sort(function (a, b) { return a - b; });
    update();
  }

  function onDetailClick(event) {
    var t = event.target;
    while (t && t !== detailFields && t.tagName !== 'BUTTON') t = t.parentNode;
    if (!t || t === detailFields || t.disabled) return;
    if (t === addPersonBtn) {
      if (detailRaw.people.length >= MAX_PEOPLE) return;
      detailRaw.people.push('');
      renderDetail();
      update();
      focusId('person-name-' + (detailRaw.people.length - 1));
    } else if (t === addItemBtn) {
      if (detailRaw.items.length >= MAX_ITEMS) return;
      detailRaw.items.push({ name: '', price: '', who: [] });
      renderItems();
      update();
      focusId('item-name-' + (detailRaw.items.length - 1));
    } else if (t.hasAttribute('data-remove-person')) {
      var j = Number(t.getAttribute('data-remove-person'));
      if (detailRaw.people.length <= 1 || j >= detailRaw.people.length) return;
      detailRaw.people.splice(j, 1);
      detailRaw.items.forEach(function (it) {
        it.who = it.who.filter(function (x) { return x !== j; })
          .map(function (x) { return x > j ? x - 1 : x; });
      });
      renderDetail();
      update();
      focusId('person-name-' + Math.min(j, detailRaw.people.length - 1));
    } else if (t.hasAttribute('data-remove-item')) {
      var i = Number(t.getAttribute('data-remove-item'));
      if (detailRaw.items.length <= 1 || i >= detailRaw.items.length) return;
      detailRaw.items.splice(i, 1);
      renderItems();
      update();
      focusId('item-name-' + Math.min(i, detailRaw.items.length - 1));
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
    noTipInput = document.getElementById('no-tip');
    noTipError = document.getElementById('no-tip-error');
    currencyInput = document.getElementById('currency');
    modeRadios = document.querySelectorAll('input[name="mode"]');
    equalFields = document.getElementById('equal-fields');
    detailFields = document.getElementById('detail-fields');
    peopleList = document.getElementById('detail-people');
    itemsList = document.getElementById('detail-items');
    addPersonBtn = document.getElementById('add-person');
    addItemBtn = document.getElementById('add-item');
    peopleField = document.getElementById('people-field');
    noTipField = document.getElementById('no-tip-field');
    detailPeopleField = document.getElementById('detail-people-field');
    roundPeopleField = document.getElementById('round-people-field');
    roundPeopleList = document.getElementById('round-people');
    roundPeopleError = document.getElementById('round-people-error');
    var form = document.getElementById('tip-form');
    if (!billInput || !peopleInput || !billError || !peopleError || !tipRadios.length ||
        !customInput || !customError || !roundUpInput || !noTipInput || !noTipError ||
        !currencyInput || !modeRadios.length || !equalFields || !detailFields ||
        !peopleList || !itemsList || !addPersonBtn || !addItemBtn || !form ||
        !peopleField || !noTipField || !detailPeopleField || !roundPeopleField ||
        !roundPeopleList || !roundPeopleError) {
      console.error('TipSplitter: expected controls are missing from index.html');
      billInput = null;
      return;
    }

    billInput.addEventListener('input', update);
    peopleInput.addEventListener('input', update);
    noTipInput.addEventListener('input', update);
    customInput.addEventListener('input', update);
    roundUpInput.addEventListener('change', update);
    currencyInput.addEventListener('change', update);
    for (var i = 0; i < tipRadios.length; i++) {
      tipRadios[i].addEventListener('change', onTipChange);
    }
    for (var m = 0; m < modeRadios.length; m++) {
      modeRadios[m].addEventListener('change', update);
    }
    detailFields.addEventListener('input', onDetailInput);
    detailFields.addEventListener('change', onDetailChange);
    detailFields.addEventListener('click', onDetailClick);
    roundPeopleList.addEventListener('change', onParticipantsChange);
    // Enter in a text field must never submit (and reload) the page.
    form.addEventListener('submit', function (event) { event.preventDefault(); });

    // Rounding always starts off, even if the browser restored the checkbox.
    roundUpInput.checked = false;
    // Same for the currency and the mode: what is remembered comes from
    // localStorage only.
    currencyInput.value = DEFAULT_CURRENCY;
    setMode(EQUAL);
    renderDetail();
    try {
      readAll(false);
    } catch (err) {
      console.error('TipSplitter init failed', err);
    }
    notify();
  }

  function setMode(mode) {
    for (var i = 0; i < modeRadios.length; i++) {
      modeRadios[i].checked = modeRadios[i].value === mode;
    }
  }

  // Raw text of the controls (what the user typed), for saving and restoring.
  function getRaw() {
    if (!billInput) return null;
    var tip = String(DEFAULT_TIP);
    for (var i = 0; i < tipRadios.length; i++) {
      if (tipRadios[i].checked) tip = tipRadios[i].value;
    }
    var raw = {
      bill: billInput.value,
      people: peopleInput.value,
      noTip: noTipInput.value,
      tip: tip,
      custom: customInput.value,
      roundUp: !!roundUpInput.checked,
      currency: validateCurrency(currencyInput.value),
      mode: readMode(),
      detail: cloneDetail(detailRaw)
    };
    if (named) {
      // Counts are kept in step so the round is also a valid single bill.
      var who = indexList(whoRaw, detailRaw.people.length);
      var skip = indexList(noTipRaw, detailRaw.people.length)
        .filter(function (p) { return who.indexOf(p) !== -1; });
      raw.people = who.length ? String(who.length) : '';
      raw.noTip = skip.length ? String(skip.length) : '';
      raw.who = who;
      raw.noTipWho = skip;
    }
    return raw;
  }

  // Writes raw values into the controls and recalculates as on page load
  // (no messages on bill/people that the user has not touched in this visit).
  function applyRaw(raw, showErrors) {
    billInput.value = raw.bill;
    peopleInput.value = raw.people;
    noTipInput.value = raw.noTip || '';
    customInput.value = raw.custom;
    roundUpInput.checked = !!raw.roundUp;
    currencyInput.value = validateCurrency(raw.currency);
    for (var i = 0; i < tipRadios.length; i++) {
      tipRadios[i].checked = tipRadios[i].value === raw.tip;
    }
    setMode(raw.mode === ITEMS ? ITEMS : EQUAL);
    detailRaw = raw.detail ? cloneDetail(raw.detail) : defaultDetail();
    whoRaw = named ? indexList(raw.who, detailRaw.people.length) : [];
    noTipRaw = named ? indexList(raw.noTipWho, detailRaw.people.length) : [];
    renderDetail();
    showError(billInput, billError, '');
    showError(peopleInput, peopleError, '');
    try {
      readAll(!!showErrors);
    } catch (err) {
      console.error('TipSplitter restore failed', err);
    }
    notify();
  }

  // showErrors: also flag an empty/invalid bill right away (switching to a
  // round the user already worked on).
  function setRaw(raw, showErrors) {
    if (!billInput || !raw) return;
    applyRaw(raw, showErrors);
  }

  // Named mode on/off; takes effect with the next setRaw().
  function setNamed(on) {
    named = !!on;
  }

  // Renames person i of the outing on screen (named mode) and recalculates.
  function renamePerson(i, name) {
    if (!billInput || !named || i < 0 || i >= detailRaw.people.length) return;
    detailRaw.people[i] = String(name == null ? '' : name);
    refreshNames(i);
    update();
  }

  // Back to a freshly opened page: equal parts, empty bill/people/"Otro",
  // 15%, rounding off, an empty ticket.
  function reset() {
    if (!billInput) return;
    applyRaw({ bill: '', people: '', noTip: '', tip: String(DEFAULT_TIP), custom: '', roundUp: false,
      currency: DEFAULT_CURRENCY, mode: EQUAL, detail: defaultDetail() });
  }

  // ---- Public API -------------------------------------------------------

  window.TipSplitter = {
    TIP_OPTIONS: TIP_OPTIONS.slice(),
    getValues: snapshot,
    getRaw: getRaw,
    setRaw: setRaw,
    reset: reset,
    // Rounds (see the rounds block): pure raw -> values, named mode, renames.
    evaluate: evaluate,
    setNamed: setNamed,
    isNamed: function () { return named; },
    renamePerson: renamePerson,
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
    validateNoTip: validateNoTip,
    validateTipCustom: validateTipCustom,
    validatePrice: validatePrice,
    validateDetail: validateDetail,
    MAX_PEOPLE: MAX_PEOPLE,
    MAX_ITEMS: MAX_ITEMS
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
 * With "Alguien no toma propina", those people pay only their share of the
 * bill and the whole tip is split among the rest (two amounts on screen).
 * In "Cuenta detallada" each person pays what they consumed (shared items
 * split among who had them) plus the tip in proportion to it, one row each.
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

  // Returns { billCents, tipCents, totalCents, base, extra, people, payers,
  //           noTip, noTipCents } or null.
  //   tipTenths is the tip in tenths of a percent (12,5% -> 125), 0..1000.
  //   noTip people ("Alguien no toma propina", 0..people-1) pay only their
  //   share of the bill: noTipCents = floor(bill / people), so they never pay
  //   more than their part. The rest (bill + whole tip) is split among the
  //   `payers` = people - noTip: extra of them pay base + 1 cent, the remaining
  //   (payers - extra) pay base. noTip * noTipCents + payers' parts = total.
  function calculate(billCents, people, tipTenths, noTip) {
    if (!isCount(billCents) || billCents <= 0) return null;
    if (!isCount(people) || people < 1) return null;
    if (!isCount(tipTenths) || tipTenths < 0 || tipTenths > 1000) return null;
    var k = noTip == null ? 0 : noTip;
    if (!isCount(k) || k < 0 || k >= people) return null;
    var scaled = billCents * tipTenths;
    if (!isCount(scaled)) return null;
    var tipCents = divRound(scaled, 1000);
    var totalCents = billCents + tipCents;
    if (!isCount(totalCents)) return null;
    var noTipCents = k > 0 ? Math.floor(billCents / people) : 0;
    var payers = people - k;
    var rest = totalCents - k * noTipCents;
    var base = Math.floor(rest / payers);
    var extra = rest - base * payers;
    return {
      billCents: billCents, tipCents: tipCents, totalCents: totalCents,
      base: base, extra: extra, people: people,
      payers: payers, noTip: k, noTipCents: noTipCents
    };
  }

  // "Redondear por persona": everyone who pays the tip pays the next whole
  // amount (never down), and what is added goes to the tip. People with no tip
  // keep paying exactly their share of the bill. Takes and returns
  // calculate()'s shape.
  function roundUpSplit(r) {
    if (!r || !isCount(r.billCents) || !isCount(r.totalCents) || !isCount(r.people)) return null;
    if (r.people < 1) return null;
    var k = isCount(r.noTip) ? r.noTip : 0;
    var noTipCents = k > 0 && isCount(r.noTipCents) ? r.noTipCents : 0;
    var payers = r.people - k;
    if (payers < 1) return null;
    var noTipTotal = k * noTipCents;
    var rest = r.totalCents - noTipTotal;
    var unit = payers * 100;
    if (!isCount(unit) || !isCount(rest + unit)) return null;
    var wholePerPerson = Math.floor((rest + unit - 1) / unit);
    var base = wholePerPerson * 100;
    var totalCents = noTipTotal + base * payers;
    if (!isCount(base) || !isCount(totalCents)) return null;
    return {
      billCents: r.billCents, tipCents: totalCents - r.billCents, totalCents: totalCents,
      base: base, extra: 0, people: r.people,
      payers: payers, noTip: k, noTipCents: noTipCents
    };
  }

  // "Cuenta detallada". detail = { people: [name], items: [{ cents, who }] }.
  // Returns { mode:'items', billCents, tipCents, totalCents,
  //           persons: [{ name, consumed, tip, total }] } or null.
  //   - A shared item is split among who had it; its leftover cents go one
  //     each to those people, starting at a different one per item so the
  //     same person does not always get them.
  //   - The tip (rounded to the cent on the whole bill, as in equal mode) is
  //     split in proportion to what each one consumed, by largest remainder,
  //     so the tips add up exactly to the tip and everyone's total to the total.
  function calculateItems(detail, tipTenths) {
    if (!detail || !Array.isArray(detail.people) || !Array.isArray(detail.items)) return null;
    var n = detail.people.length;
    if (n < 1 || !detail.items.length) return null;
    if (!isCount(tipTenths) || tipTenths < 0 || tipTenths > 1000) return null;
    var consumed = detail.people.map(function () { return 0; });
    var billCents = 0;
    for (var i = 0; i < detail.items.length; i++) {
      var it = detail.items[i];
      if (!it || !isCount(it.cents) || it.cents <= 0 || !Array.isArray(it.who) || !it.who.length) return null;
      var k = it.who.length;
      var share = Math.floor(it.cents / k);
      var left = it.cents - share * k;
      for (var w = 0; w < k; w++) {
        var p = it.who[w];
        if (!isCount(p) || p < 0 || p >= n) return null;
        var gets = ((w - i % k + k) % k) < left ? 1 : 0;
        consumed[p] += share + gets;
      }
      billCents += it.cents;
    }
    if (!isCount(billCents) || billCents <= 0) return null;
    var scaled = billCents * tipTenths;
    if (!isCount(scaled)) return null;
    var tipCents = divRound(scaled, 1000);
    var tips = [];
    var rems = [];
    var given = 0;
    for (var j = 0; j < n; j++) {
      var prod = tipCents * consumed[j];
      if (!isCount(prod)) return null;
      var q = Math.floor(prod / billCents);
      tips.push(q);
      rems.push({ j: j, r: prod - q * billCents });
      given += q;
    }
    rems.sort(function (a, b) { return b.r - a.r || a.j - b.j; });
    for (var x = 0; x < tipCents - given; x++) tips[rems[x].j] += 1;
    var persons = detail.people.map(function (name, idx) {
      return { name: String(name), consumed: consumed[idx], tip: tips[idx], total: consumed[idx] + tips[idx] };
    });
    return {
      mode: 'items', billCents: billCents, tipCents: tipCents,
      totalCents: billCents + tipCents, persons: persons
    };
  }

  // "Redondear por persona" in "Cuenta detallada": everyone who pays something
  // pays the next whole amount; what is added goes to their tip.
  function roundUpItems(r) {
    if (!r || !Array.isArray(r.persons)) return null;
    var total = 0;
    var persons = r.persons.map(function (p) {
      var t = p.total > 0 ? Math.ceil(p.total / 100) * 100 : 0;
      total += t;
      return { name: p.name, consumed: p.consumed, tip: t - p.consumed, total: t };
    });
    if (!isCount(total)) return null;
    return {
      mode: 'items', billCents: r.billCents, tipCents: total - r.billCents,
      totalCents: total, persons: persons
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

  // Currencies of the "Moneda" selector. Same digits for all (dot for
  // thousands, comma for decimals); "$" and "US$" go before the amount and
  // "€" after it with a space, as it is written in Spanish.
  var CURRENCIES = ['$', '€', 'US$'];

  function currencyOf(values) {
    var c = values && values.currency;
    return CURRENCIES.indexOf(c) !== -1 ? c : '$';
  }

  // (125000, '$') -> "$1.250,00", '€' -> "1.250,00 €", 'US$' -> "US$1.250,00".
  // Manual on purpose: Intl's es-* locales differ on grouping 4-digit numbers
  // and on the space after "$".
  function formatCents(cents, currency) {
    if (!isCount(cents) || cents < 0) return DASH;
    var whole = String(Math.floor(cents / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    var frac = String(cents % 100);
    if (frac.length < 2) frac = '0' + frac;
    var cur = CURRENCIES.indexOf(currency) !== -1 ? currency : '$';
    var amount = whole + ',' + frac;
    return cur === '€' ? amount + ' €' : cur + amount;
  }

  // Percent for the copied text: 150 -> "15%", 125 -> "12,5%".
  function formatPercent(tenths) {
    if (!isCount(tenths) || tenths < 0) return DASH;
    var whole = Math.floor(tenths / 10);
    var rest = tenths % 10;
    return (rest === 0 ? String(whole) : whole + ',' + rest) + '%';
  }

  // Same maths as render(), so the copied numbers are the ones on screen.
  // Returns { r, real } or null when the results would show "—".
  function compute(values) {
    var items = !!(values && values.mode === 'items');
    var r = null;
    if (values && values.valid) {
      r = items
        ? calculateItems(values.detail, values.tipTenths)
        : calculate(toCents(values.bill), values.people, values.tipTenths, values.noTip);
    }
    if (r && values.roundUp) r = items ? roundUpItems(r) : roundUpSplit(r);
    if (!r) return null;
    var real = null;
    if (values.roundUp) {
      real = percentTenths(r.tipCents, r.billCents);
      if (real == null) return null;
    }
    return { r: r, real: real };
  }

  // What the tip payers pay: ["2 × $36,67", "1 × $36,66"] or ["3 × $30,00"].
  function payerParts(r, cur) {
    if (r.extra === 0) return [r.payers + ' × ' + formatCents(r.base, cur)];
    return [
      r.extra + ' × ' + formatCents(r.base + 1, cur),
      (r.payers - r.extra) + ' × ' + formatCents(r.base, cur)
    ];
  }

  // "Por persona" part of the summary: "$28,75 c/u", "2 × $36,67 y 1 × $36,66"
  // or "3 × $30,00 con propina · 1 × $25,00 sin propina".
  // In "Cuenta detallada": "Ana $46,00 · Beto $34,50 · Caro $34,50".
  function eachText(r, cur) {
    if (r.mode === 'items') {
      return r.persons.map(function (p) { return p.name + ' ' + formatCents(p.total, cur); }).join(' · ');
    }
    if (r.noTip > 0) {
      return payerParts(r, cur).join(' y ') + ' con propina · ' +
        r.noTip + ' × ' + formatCents(r.noTipCents, cur) + ' sin propina';
    }
    return r.extra === 0 ? formatCents(r.base, cur) + ' c/u' : payerParts(r, cur).join(' y ');
  }

  // Total and per-person text for the history list, or null without results.
  function historyParts(values) {
    var c = compute(values);
    if (!c) return null;
    var cur = currencyOf(values);
    return { total: formatCents(c.r.totalCents, cur), each: eachText(c.r, cur) };
  }

  // Plain text for WhatsApp, e.g.
  // "Cuenta $100,00 + propina 15% = $115,00 · 4 personas · $28,75 c/u".
  // null when there are no valid results.
  function buildSummary(values) {
    var c = compute(values);
    if (!c) return null;
    var r = c.r;
    var cur = currencyOf(values);
    var tip = 'propina ' + formatPercent(values.tipTenths);
    if (values.roundUp) tip += ' → ' + formatPercent(c.real) + ' real';
    var head = 'Cuenta ' + formatCents(r.billCents, cur) + ' + ' + tip + ' = ' +
      formatCents(r.totalCents, cur);
    // "Cuenta detallada" lists everyone by name with what they pay.
    if (r.mode === 'items') return head + ' · ' + eachText(r, cur);
    var people = r.people === 1 ? '1 persona' : r.people + ' personas';
    return head + ' · ' + people + ' · ' + eachText(r, cur);
  }

  var tipEl, tipLabelEl, tipRateEl, totalEl, perPersonEl, noteEl;
  var perPersonLabelEl, noTipRowEl, noTipAmountEl;
  var perPersonRowEl, detailResultsEl, subtotalEl;

  // "Cuenta detallada": one row per person, or none.
  function setPersons(r, cur) {
    while (detailResultsEl.firstChild) detailResultsEl.removeChild(detailResultsEl.firstChild);
    var on = !!(r && r.mode === 'items');
    detailResultsEl.hidden = !on;
    perPersonRowEl.hidden = on;
    subtotalEl.textContent = on ? formatCents(r.billCents, cur) : DASH;
    if (!on) return;
    r.persons.forEach(function (p) {
      var label = document.createElement('span');
      label.className = 'result-label';
      label.textContent = p.name;
      var sub = document.createElement('span');
      sub.className = 'result-sub';
      sub.textContent = 'Consumió ' + formatCents(p.consumed, cur) + ' + propina ' + formatCents(p.tip, cur);
      label.appendChild(sub);
      var value = document.createElement('span');
      value.className = 'result-value';
      value.textContent = formatCents(p.total, cur);
      var li = document.createElement('li');
      li.className = 'result';
      li.appendChild(label);
      li.appendChild(value);
      detailResultsEl.appendChild(li);
    });
  }

  function setNoTip(r, cur) {
    var on = !!(r && r.noTip > 0);
    perPersonLabelEl.textContent = on ? 'Con propina' : 'Por persona';
    noTipRowEl.hidden = !on;
    noTipAmountEl.textContent = on ? r.noTip + ' × ' + formatCents(r.noTipCents, cur) : '';
  }

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
    setNoTip(null);
    setPersons(null);
    noteEl.textContent = '';
    noteEl.hidden = true;
  }

  function render(values) {
    try {
      var c = compute(values);
      if (!c) { showEmpty(values); return; }
      var r = c.r;
      var cur = currencyOf(values);

      if (values.roundUp) {
        setRounding(true, formatTenths(values.tipTenths) + ' elegido → ' + formatTenths(c.real) + ' real');
      } else {
        setRounding(false, '');
      }
      tipEl.textContent = formatCents(r.tipCents, cur);
      totalEl.textContent = formatCents(r.totalCents, cur);
      setPersons(r, cur);
      if (r.mode === 'items') {
        setNoTip(null);
        noteEl.textContent = '';
        noteEl.hidden = true;
        return;
      }
      setNoTip(r, cur);
      if (r.extra === 0) {
        setLines([r.noTip > 0 ? payerParts(r, cur)[0] : formatCents(r.base, cur)]);
        noteEl.textContent = '';
        noteEl.hidden = true;
      } else {
        setLines(payerParts(r, cur));
        noteEl.textContent = r.extra === 1
          ? '1 persona paga ' + formatCents(1, cur) + ' más'
          : r.extra + ' personas pagan ' + formatCents(1, cur) + ' más';
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
    perPersonLabelEl = document.getElementById('per-person-label');
    noTipRowEl = document.getElementById('no-tip-row');
    noTipAmountEl = document.getElementById('no-tip-amount');
    perPersonRowEl = document.getElementById('per-person-row');
    detailResultsEl = document.getElementById('detail-results');
    subtotalEl = document.getElementById('detail-subtotal');
    if (!tipEl || !tipLabelEl || !tipRateEl || !totalEl || !perPersonEl || !noteEl ||
        !perPersonLabelEl || !noTipRowEl || !noTipAmountEl || !perPersonRowEl ||
        !detailResultsEl || !subtotalEl) {
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
    window.TipSplitter.calculateItems = calculateItems;
    window.TipSplitter.roundUpItems = roundUpItems;
    window.TipSplitter.formatCents = formatCents;
    window.TipSplitter.CURRENCIES = CURRENCIES.slice();
    window.TipSplitter.roundUpSplit = roundUpSplit;
    window.TipSplitter.percentTenths = percentTenths;
    window.TipSplitter.formatTenths = formatTenths;
    window.TipSplitter.formatPercent = formatPercent;
    window.TipSplitter.buildSummary = buildSummary;
    window.TipSplitter.historyParts = historyParts;
    window.TipSplitter.compute = compute;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

/*
 * Tip Splitter — rounds ("Rondas"): several bills in one outing.
 *
 * The form always edits one round (the active one). Each round is kept as the
 * raw control values TipSplitter.getRaw() returns, so it has every option a
 * single bill has, and it is computed with the same functions (evaluate +
 * compute), to the cent.
 *   - With exactly one round nothing changes: no tabs, no people list, no
 *     totals panel, plain single-bill raw values (only "Agregar ronda" shows).
 *   - With 2+ rounds the outing has one people list (index = identity, shown
 *     by name); every round's ticket people are that list, and in equal parts
 *     each round ticks who was there (raw.who) and who skips the tip
 *     (raw.noTipWho). The currency is one for the whole outing.
 * Contract:
 *   TipSplitter.outing.count(), .summary() (copied/WhatsApp text or null),
 *   .personTotals() -> [{ name, cents }] (running total per person, complete
 *   rounds only; with one round that bill's split), .grandTotal() -> cents,
 *   .onChange(fn) (after any change to any round), .getData()/.restore(),
 *   .reset(), .loadRaw(raw). document also gets a 'tipsplitter:outing' event.
 */
(function () {
  'use strict';

  var MAX_ROUNDS = 10;
  var MAX_PEOPLE = 20;

  var api = null;
  var rounds = [];   // [{ label, raw }]
  var active = 0;
  var people = [];   // names of the outing's people (2+ rounds only)
  var listeners = [];

  var tabsEl, editEl, labelInput, removeBtn, addBtn, errorEl, statusEl;
  var peopleField, peopleListEl, addPersonBtn, peopleErrorEl;
  var totalsEl, personsEl, grandEl, noteEl;

  function clone(raw) { return JSON.parse(JSON.stringify(raw)); }

  function defaultRaw() {
    return {
      bill: '', people: '', noTip: '', tip: '15', custom: '', roundUp: false, currency: '$',
      mode: 'equal', detail: { people: ['', ''], items: [{ name: '', price: '', who: [] }] }
    };
  }

  function nameOf(name, i) {
    var t = String(name == null ? '' : name).trim();
    return t || 'Persona ' + (i + 1);
  }

  function roundLabel(i) {
    var t = String(rounds[i] && rounds[i].label || '').trim();
    return t || 'Ronda ' + (i + 1);
  }

  function range(n) {
    var out = [];
    for (var i = 0; i < n; i++) out.push(i);
    return out;
  }

  // Keeps the text counts in step with who/noTipWho, so a round is also a
  // valid single bill (used when going back to one round).
  function syncCounts(raw) {
    var who = raw.who || [];
    var skip = (raw.noTipWho || []).filter(function (p) { return who.indexOf(p) !== -1; });
    raw.noTipWho = skip;
    raw.people = who.length ? String(who.length) : '';
    raw.noTip = skip.length ? String(skip.length) : '';
    return raw;
  }

  // A single-bill raw -> a round of the outing with people `list`.
  // Returns { raw, people } (people may have grown) or null when the outing
  // would pass MAX_PEOPLE.
  function toNamed(single, list) {
    var raw = clone(single);
    var names = list.slice();
    var d = raw.detail && Array.isArray(raw.detail.people) && Array.isArray(raw.detail.items)
      ? raw.detail : defaultRaw().detail;
    // The ticket's people become people of the outing, matched by the name shown.
    var used = {};
    var map = d.people.map(function (n, i) {
      var label = nameOf(n, i);
      for (var j = 0; j < names.length; j++) {
        if (!used[j] && nameOf(names[j], j) === label) { used[j] = true; return j; }
      }
      names.push(String(n == null ? '' : n));
      used[names.length - 1] = true;
      return names.length - 1;
    });
    var items = d.items.map(function (it) {
      return {
        name: it.name, price: it.price,
        who: it.who.map(function (p) { return map[p]; })
          .filter(function (p) { return p != null; })
          .sort(function (a, b) { return a - b; })
      };
    });
    // Equal parts: the first N people of the outing, the last k skip the tip.
    var count = api.validatePeople(raw.people).value;
    var who, skip = [];
    if (count != null && count <= MAX_PEOPLE) {
      while (names.length < count) names.push('');
      who = range(count);
      var k = api.validateNoTip(raw.noTip, count).value || 0;
      skip = who.slice(count - k);
    } else if (count != null) {
      return null;
    } else {
      who = range(names.length);
    }
    if (names.length > MAX_PEOPLE) return null;
    raw.detail = { people: names.slice(), items: items };
    raw.who = who;
    raw.noTipWho = skip;
    return { raw: syncCounts(raw), people: names };
  }

  // Round of the outing -> plain single bill (people as counts).
  function toSingle(raw) {
    var out = syncCounts(clone(raw));
    delete out.who;
    delete out.noTipWho;
    return out;
  }

  // People list grew: every round gets the new people (not ticked anywhere).
  function growRounds() {
    rounds.forEach(function (rd) {
      while (rd.raw.detail.people.length < people.length) rd.raw.detail.people.push('');
    });
  }

  function storeActive() {
    var raw = api.getRaw();
    if (raw) rounds[active].raw = raw;
  }

  // ---- Maths --------------------------------------------------------------

  // -> { ok, r, shares: [cents per person of the outing], total } or { ok: false }.
  function roundResult(i) {
    var named = rounds.length > 1;
    var values = i === active ? api.getValues() : api.evaluate(rounds[i].raw, named);
    var c = null;
    try { c = values && values.valid ? api.compute(values) : null; } catch (err) { c = null; }
    if (!c) return { ok: false };
    var r = c.r;
    var n = named ? people.length : 0;
    var shares = range(n).map(function () { return 0; });
    if (named) {
      if (r.mode === 'items') {
        r.persons.forEach(function (p, j) { if (j < n) shares[j] += p.total; });
      } else {
        var skip = values.noTipWho || [];
        var payers = (values.who || []).filter(function (p) { return skip.indexOf(p) === -1; });
        skip.forEach(function (p) { shares[p] += r.noTipCents; });
        payers.forEach(function (p, idx) { shares[p] += r.base + (idx < r.extra ? 1 : 0); });
      }
    }
    return { ok: true, r: r, shares: shares, total: r.totalCents, values: values };
  }

  function totals() {
    var persons = people.map(function () { return 0; });
    var grand = 0;
    var incomplete = [];
    var results = rounds.map(function (rd, i) {
      var res = roundResult(i);
      if (!res.ok) { incomplete.push(i); return res; }
      res.shares.forEach(function (s, j) { persons[j] += s; });
      grand += res.total;
      return res;
    });
    return { persons: persons, grand: grand, incomplete: incomplete, results: results };
  }

  function currency() {
    var c = rounds[active] && rounds[active].raw.currency;
    return api.CURRENCIES.indexOf(c) !== -1 ? c : '$';
  }

  function personTotals() {
    if (rounds.length > 1) {
      var t = totals();
      return people.map(function (n, i) { return { name: nameOf(n, i), cents: t.persons[i] }; });
    }
    // One round: that bill's split.
    var res = roundResult(0);
    if (!res.ok) return [];
    var r = res.r;
    if (r.mode === 'items') return r.persons.map(function (p) { return { name: p.name, cents: p.total }; });
    var out = [];
    var payers = r.people - r.noTip;
    for (var i = 0; i < r.people; i++) {
      var cents = i < payers ? r.base + (i < r.extra ? 1 : 0) : r.noTipCents;
      out.push({ name: 'Persona ' + (i + 1), cents: cents });
    }
    return out;
  }

  function quoteList(idx) {
    var names = idx.map(function (i) { return '«' + roundLabel(i) + '»'; });
    if (names.length === 1) return names[0];
    return names.slice(0, -1).join(', ') + ' y ' + names[names.length - 1];
  }

  function incompleteText(idx) {
    if (!idx.length) return '';
    return idx.length === 1
      ? quoteList(idx) + ' está incompleta: no se incluye en los totales.'
      : quoteList(idx) + ' están incompletas: no se incluyen en los totales.';
  }

  // Copied / WhatsApp text. One round: exactly today's summary. 2+ rounds:
  // one line per round in today's format, then everyone's running total.
  function summary() {
    if (!api) return null;
    if (rounds.length < 2) return api.buildSummary(api.getValues());
    var t = totals();
    if (t.incomplete.length === rounds.length) return null;
    var cur = currency();
    var lines = rounds.map(function (rd, i) {
      var res = t.results[i];
      if (!res.ok) return roundLabel(i) + ': incompleta (no se incluye)';
      return roundLabel(i) + ': ' + api.buildSummary(res.values);
    });
    var each = people.map(function (n, i) {
      return nameOf(n, i) + ' ' + api.formatCents(t.persons[i], cur);
    });
    lines.push('Total de la salida ' + api.formatCents(t.grand, cur) + ' · ' + each.join(' · '));
    return lines.join('\n');
  }

  // ---- Rendering ----------------------------------------------------------

  function el(tag, attrs, text) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'className') node.className = attrs[k];
      else node.setAttribute(k, attrs[k]);
    });
    if (text != null) node.textContent = text;
    return node;
  }

  function renderTabs(t) {
    var many = rounds.length > 1;
    tabsEl.hidden = !many;
    editEl.hidden = !many;
    peopleField.hidden = !many;
    addBtn.disabled = rounds.length >= MAX_ROUNDS;
    if (!many) {
      while (tabsEl.firstChild) tabsEl.removeChild(tabsEl.firstChild);
      return;
    }
    // Reuse the buttons so a focused tab keeps its focus.
    while (tabsEl.children.length > rounds.length) tabsEl.removeChild(tabsEl.lastChild);
    while (tabsEl.children.length < rounds.length) {
      var b = el('button', { type: 'button', className: 'round-tab' });
      b.appendChild(el('span', { className: 'round-name' }));
      b.appendChild(el('span', { className: 'round-flag' }));
      tabsEl.appendChild(b);
    }
    rounds.forEach(function (rd, i) {
      var btn = tabsEl.children[i];
      btn.setAttribute('data-round', String(i));
      btn.setAttribute('aria-current', i === active ? 'true' : 'false');
      var bad = t.incomplete.indexOf(i) !== -1;
      btn.firstChild.textContent = roundLabel(i);
      btn.lastChild.textContent = bad ? ' · incompleta' : '';
    });
    if (document.activeElement !== labelInput) labelInput.value = rounds[active].label;
    labelInput.placeholder = 'Ronda ' + (active + 1);
  }

  function renderPeopleList() {
    while (peopleListEl.firstChild) peopleListEl.removeChild(peopleListEl.firstChild);
    if (rounds.length < 2) return;
    people.forEach(function (name, i) {
      var input = el('input', {
        type: 'text', id: 'outing-person-' + i, 'data-op': String(i),
        placeholder: 'Persona ' + (i + 1), maxlength: '32', autocomplete: 'off',
        'aria-label': 'Nombre de la persona ' + (i + 1)
      });
      input.value = name;
      var remove = el('button', {
        type: 'button', className: 'btn-small', 'data-op-remove': String(i),
        'aria-label': 'Quitar a ' + nameOf(name, i)
      }, 'Quitar');
      remove.disabled = people.length <= 1;
      var li = el('li', { className: 'detail-row' });
      li.appendChild(input);
      li.appendChild(remove);
      peopleListEl.appendChild(li);
    });
    addPersonBtn.disabled = people.length >= MAX_PEOPLE;
  }

  function checkNames() {
    var seen = {};
    var dup = '';
    people.forEach(function (n, i) {
      var key = nameOf(n, i).toLowerCase();
      if (seen[key] && !dup) dup = nameOf(n, i);
      seen[key] = true;
    });
    var msg = dup ? 'Hay dos personas que se llaman «' + dup + '»: cambiá uno de los nombres.' : '';
    if (peopleErrorEl.textContent !== msg) peopleErrorEl.textContent = msg;
  }

  function renderTotals(t) {
    var many = rounds.length > 1;
    totalsEl.hidden = !many;
    while (personsEl.firstChild) personsEl.removeChild(personsEl.firstChild);
    if (!many) return;
    var cur = currency();
    people.forEach(function (n, i) {
      var li = el('li', { className: 'result' });
      li.appendChild(el('span', { className: 'result-label' }, nameOf(n, i)));
      li.appendChild(el('span', { className: 'result-value' }, api.formatCents(t.persons[i], cur)));
      personsEl.appendChild(li);
    });
    grandEl.textContent = api.formatCents(t.grand, cur);
    var note = incompleteText(t.incomplete);
    noteEl.textContent = note;
    noteEl.hidden = !note;
  }

  function fire() {
    var t = totals();
    try {
      renderTabs(t);
      renderTotals(t);
      if (rounds.length > 1) checkNames();
    } catch (err) {
      console.error('TipSplitter rounds render failed', err);
    }
    listeners.forEach(function (fn) {
      try { fn(); } catch (err) { console.error('TipSplitter outing listener failed', err); }
    });
    try {
      document.dispatchEvent(new CustomEvent('tipsplitter:outing', {
        detail: { rounds: rounds.length, people: personTotals(), grandTotal: t.grand, incomplete: t.incomplete.slice() }
      }));
    } catch (err) { console.error('TipSplitter outing event failed', err); }
  }

  // ---- Changes --------------------------------------------------------------

  var applying = false;

  // The form changed (typing, or a round put on screen).
  function onInputsChange() {
    if (!rounds.length) return;
    storeActive();
    if (rounds.length > 1) {
      var raw = rounds[active].raw;
      people = raw.detail.people.slice();
      rounds.forEach(function (rd) { rd.raw.currency = raw.currency; });
    }
    if (!applying) fire();
  }

  // Puts round i on screen and notifies once.
  function show(i, showErrors) {
    active = i;
    applying = true;
    try {
      api.setNamed(rounds.length > 1);
      api.setRaw(rounds[i].raw, showErrors);
    } finally {
      applying = false;
    }
    fire();
  }

  function setError(msg) {
    if (errorEl.textContent !== msg) errorEl.textContent = msg;
  }

  function addRound() {
    if (rounds.length >= MAX_ROUNDS) return;
    storeActive();
    setError('');
    if (rounds.length === 1) {
      var conv = toNamed(rounds[0].raw, []);
      if (!conv) { setError('Para usar rondas pueden ser hasta ' + MAX_PEOPLE + ' personas.'); return; }
      people = conv.people;
      rounds[0] = { label: '', raw: conv.raw };
    }
    var raw = defaultRaw();
    raw.currency = rounds[0].raw.currency;
    raw.detail.people = people.slice();
    raw.who = range(people.length);
    raw.noTipWho = [];
    rounds.push({ label: '', raw: syncCounts(raw) });
    show(rounds.length - 1, false);
    renderPeopleList();
    statusEl.textContent = 'Ronda ' + rounds.length + ' agregada';
    try { labelInput.focus(); } catch (err) { /* best-effort */ }
  }

  function removeRound() {
    if (rounds.length <= 1) return;
    storeActive();
    var gone = roundLabel(active);
    rounds.splice(active, 1);
    var next = Math.min(active, rounds.length - 1);
    if (rounds.length === 1) {
      rounds[0] = { label: '', raw: toSingle(rounds[0].raw) };
      people = [];
    }
    show(next, rounds.length > 1);
    renderPeopleList();
    setError('');
    statusEl.textContent = 'Ronda ' + gone + ' quitada';
    try { (rounds.length > 1 ? tabsEl.children[next] : addBtn).focus(); } catch (err) { /* best-effort */ }
  }

  function onTabsClick(event) {
    var t = event.target;
    while (t && t !== tabsEl && !t.hasAttribute('data-round')) t = t.parentNode;
    if (!t || t === tabsEl) return;
    var i = Number(t.getAttribute('data-round'));
    if (i === active || i < 0 || i >= rounds.length) return;
    storeActive();
    show(i, true);
  }

  function onLabelInput() {
    if (rounds.length < 2) return;
    rounds[active].label = labelInput.value;
    fire();
  }

  function onPeopleInput(event) {
    var t = event.target;
    if (!t.hasAttribute('data-op')) return;
    var i = Number(t.getAttribute('data-op'));
    if (i < 0 || i >= people.length) return;
    people[i] = t.value;
    rounds.forEach(function (rd) { rd.raw.detail.people[i] = t.value; });
    var btn = peopleListEl.querySelector('[data-op-remove="' + i + '"]');
    if (btn) btn.setAttribute('aria-label', 'Quitar a ' + nameOf(t.value, i));
    api.renamePerson(i, t.value); // recalculates -> onInputsChange -> fire
  }

  function reindex(list, j) {
    return (list || []).filter(function (x) { return x !== j; })
      .map(function (x) { return x > j ? x - 1 : x; });
  }

  function onPeopleClick(event) {
    var t = event.target;
    while (t && t !== peopleField && t.tagName !== 'BUTTON') t = t.parentNode;
    if (!t || t === peopleField || t.disabled) return;
    storeActive();
    if (t === addPersonBtn) {
      if (people.length >= MAX_PEOPLE) return;
      people.push('');
      growRounds();
      // Added from this round: they were here.
      var raw = rounds[active].raw;
      raw.who = (raw.who || []).concat([people.length - 1]);
      syncCounts(raw);
      show(active, true);
      renderPeopleList();
      var input = document.getElementById('outing-person-' + (people.length - 1));
      if (input) { try { input.focus(); } catch (err) { /* best-effort */ } }
    } else if (t.hasAttribute('data-op-remove')) {
      var j = Number(t.getAttribute('data-op-remove'));
      if (people.length <= 1 || j < 0 || j >= people.length) return;
      people.splice(j, 1);
      rounds.forEach(function (rd) {
        rd.raw.detail.people.splice(j, 1);
        rd.raw.detail.items.forEach(function (it) { it.who = reindex(it.who, j); });
        rd.raw.who = reindex(rd.raw.who, j);
        rd.raw.noTipWho = reindex(rd.raw.noTipWho, j);
        syncCounts(rd.raw);
      });
      show(active, true);
      renderPeopleList();
      var next = document.getElementById('outing-person-' + Math.min(j, people.length - 1));
      if (next) { try { next.focus(); } catch (err) { /* best-effort */ } }
    }
  }

  // ---- Saving / restoring (used by the actions block) ---------------------

  // 2+ rounds: { active, rounds: [{ label, raw }] }; one round: null.
  function getData() {
    if (rounds.length < 2) return null;
    storeActive();
    return {
      active: active,
      rounds: rounds.map(function (rd) { return { label: rd.label, raw: clone(rd.raw) }; })
    };
  }

  // data was checked by the actions block (same people in every round).
  function restore(data) {
    if (!data || !Array.isArray(data.rounds) || data.rounds.length < 2) return;
    rounds = data.rounds.map(function (rd) { return { label: rd.label, raw: clone(rd.raw) }; });
    people = rounds[0].raw.detail.people.slice();
    var i = data.active >= 0 && data.active < rounds.length ? data.active : 0;
    show(i, false);
    renderPeopleList();
  }

  function reset() {
    rounds = [{ label: '', raw: defaultRaw() }];
    people = [];
    active = 0;
    applying = true;
    try {
      api.setNamed(false);
      api.reset();
    } finally {
      applying = false;
    }
    storeActive();
    renderPeopleList();
    setError('');
    fire();
  }

  // A history entry (single bill) into the active round.
  function loadRaw(raw) {
    if (rounds.length < 2) { api.setRaw(raw); return true; }
    var conv = toNamed(raw, people);
    if (!conv) { setError('Para usar rondas pueden ser hasta ' + MAX_PEOPLE + ' personas.'); return false; }
    people = conv.people;
    growRounds();
    conv.raw.currency = currency();
    rounds[active].raw = conv.raw;
    show(active, true);
    renderPeopleList();
    return true;
  }

  // ---- Init ---------------------------------------------------------------

  function init() {
    api = window.TipSplitter;
    tabsEl = document.getElementById('round-tabs');
    editEl = document.getElementById('round-edit');
    labelInput = document.getElementById('round-label');
    removeBtn = document.getElementById('round-remove');
    addBtn = document.getElementById('round-add');
    errorEl = document.getElementById('round-error');
    statusEl = document.getElementById('round-status');
    peopleField = document.getElementById('outing-people-field');
    peopleListEl = document.getElementById('outing-people');
    addPersonBtn = document.getElementById('outing-add-person');
    peopleErrorEl = document.getElementById('outing-people-error');
    totalsEl = document.getElementById('outing-totals');
    personsEl = document.getElementById('outing-persons');
    grandEl = document.getElementById('outing-grand');
    noteEl = document.getElementById('outing-note');
    if (!tabsEl || !editEl || !labelInput || !removeBtn || !addBtn || !errorEl || !statusEl ||
        !peopleField || !peopleListEl || !addPersonBtn || !peopleErrorEl || !totalsEl ||
        !personsEl || !grandEl || !noteEl) {
      console.error('TipSplitter: round elements are missing from index.html');
      api = null;
      return;
    }
    if (!api || typeof api.evaluate !== 'function' || typeof api.compute !== 'function' ||
        typeof api.getRaw !== 'function' || !api.getRaw()) {
      console.error('TipSplitter: inputs or results module is not available');
      api = null;
      return;
    }
    rounds = [{ label: '', raw: api.getRaw() }];
    api.onChange(onInputsChange);
    addBtn.addEventListener('click', addRound);
    removeBtn.addEventListener('click', removeRound);
    tabsEl.addEventListener('click', onTabsClick);
    labelInput.addEventListener('input', onLabelInput);
    peopleField.addEventListener('input', onPeopleInput);
    peopleField.addEventListener('click', onPeopleClick);
    renderTabs(totals());
  }

  if (window.TipSplitter) {
    window.TipSplitter.outing = {
      MAX_ROUNDS: MAX_ROUNDS,
      count: function () { return rounds.length; },
      active: function () { return active; },
      summary: summary,
      personTotals: personTotals,
      grandTotal: function () { return totals().grand; },
      getData: getData,
      restore: restore,
      reset: reset,
      loadRaw: loadRaw,
      onChange: function (fn) {
        if (typeof fn !== 'function') return function () {};
        listeners.push(fn);
        return function () {
          var i = listeners.indexOf(fn);
          if (i !== -1) listeners.splice(i, 1);
        };
      },
      // Exposed for testing; pure.
      toNamed: function (raw, list) { return api ? toNamed(raw, list) : null; },
      toSingle: toSingle
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

/*
 * Tip Splitter — remember, start over and copy summary.
 *
 * Saves the raw controls (mode, bill, people, tip choice, "Otro" text, rounding,
 * currency and the "Cuenta detallada" ticket) in
 * localStorage on every change and restores them on load (an outing with 2+
 * rounds is saved under its own key instead, see the rounds block). Storage may be
 * unavailable (file:// in some browsers, private mode): every access is
 * guarded and failures are silent — the app just does not remember.
 * "Copiar resumen" copies TipSplitter.buildSummary(); if the clipboard is
 * blocked the text is shown selected for a manual copy.
 * "Compartir por WhatsApp" opens wa.me with that same text (only on click).
 * "Últimas cuentas": the last 5 valid bills (date, total, per person). A bill
 * goes in after the user stops editing for 3 s with valid results, or when it
 * is copied/shared; the same values are never listed twice (they move to the
 * top). Only user edits schedule it — restoring, resetting or loading an entry
 * does not. Tapping an entry loads its values.
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'tipSplitter:v1';
  // An outing with 2+ rounds; with one round only STORAGE_KEY is used, as before.
  var OUTING_KEY = 'tipSplitter:outing:v1';
  var MAX_ROUNDS = 10;
  var TIPS = ['10', '15', '20', 'other'];
  var CURRENCIES = ['$', '€', 'US$'];
  var MAX_TEXT = 32;
  var COPY_LABEL = 'Copiar resumen';
  var COPIED_LABEL = 'Copiado';
  var COPIED_MS = 2000;
  var HISTORY_KEY = 'tipSplitter:history:v1';
  var HISTORY_MAX = 5;
  var HISTORY_IDLE_MS = 3000;
  var MAX_LONG_TEXT = 2000;
  var MAX_PEOPLE = 20;
  var MAX_ITEMS = 50;

  // ---- Storage (never throws, never logs) ---------------------------------

  function storage() {
    try {
      var s = window.localStorage;
      return s && typeof s.getItem === 'function' ? s : null;
    } catch (err) {
      return null;
    }
  }

  function isText(v) {
    return typeof v === 'string' && v.length <= MAX_TEXT;
  }

  // Parsed JSON -> raw values, or null when anything is missing or off.
  function parseSaved(text) {
    if (typeof text !== 'string' || text === '') return null;
    var data;
    try { data = JSON.parse(text); } catch (err) { return null; }
    if (!data || typeof data !== 'object' || data.v !== 1) return null;
    return checkRaw(data);
  }

  // Object -> raw control values, or null when anything is missing or off.
  function checkRaw(data) {
    if (!data || typeof data !== 'object') return null;
    if (!isText(data.bill) || !isText(data.people) || !isText(data.custom)) return null;
    if (TIPS.indexOf(data.tip) === -1 || typeof data.roundUp !== 'boolean') return null;
    // noTip came later: values saved before it existed have none and still load.
    var noTip = data.noTip === undefined ? '' : data.noTip;
    if (!isText(noTip)) return null;
    // Same for currency: missing means the original "$".
    var currency = data.currency === undefined ? '$' : data.currency;
    if (CURRENCIES.indexOf(currency) === -1) return null;
    // "Cuenta detallada" came later too: missing means equal parts, empty ticket.
    var mode = data.mode === undefined ? 'equal' : data.mode;
    if (mode !== 'equal' && mode !== 'items') return null;
    var detail = null;
    if (data.detail !== undefined && data.detail !== null) {
      detail = checkDetail(data.detail);
      if (!detail) return null;
    }
    var out = {
      bill: data.bill, people: data.people, noTip: noTip,
      tip: data.tip, custom: data.custom, roundUp: data.roundUp, currency: currency,
      mode: mode, detail: detail
    };
    // Rounds of an outing: who was there / who skips the tip (person indexes).
    if (data.who !== undefined || data.noTipWho !== undefined) {
      if (!detail) return null;
      var who = checkIndexes(data.who, detail.people.length);
      var skip = checkIndexes(data.noTipWho, detail.people.length);
      if (!who || !skip) return null;
      for (var s = 0; s < skip.length; s++) if (who.indexOf(skip[s]) === -1) return null;
      out.who = who;
      out.noTipWho = skip;
    }
    return out;
  }

  // Unique integer indexes in 0..n-1 (sorted copy), or null.
  function checkIndexes(list, n) {
    if (!Array.isArray(list) || list.length > n) return null;
    var seen = {};
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (typeof p !== 'number' || !Number.isInteger(p) || p < 0 || p >= n || seen[p]) return null;
      seen[p] = true;
    }
    return list.slice().sort(function (a, b) { return a - b; });
  }

  // Saved outing JSON -> { active, rounds: [{ label, raw }] }, or null when
  // anything is missing or off (every round must have the same people).
  function parseOuting(text) {
    if (typeof text !== 'string' || text === '') return null;
    var data;
    try { data = JSON.parse(text); } catch (err) { return null; }
    if (!data || typeof data !== 'object' || data.v !== 1 || !Array.isArray(data.rounds)) return null;
    if (data.rounds.length < 2 || data.rounds.length > MAX_ROUNDS) return null;
    if (typeof data.active !== 'number' || !Number.isInteger(data.active) ||
        data.active < 0 || data.active >= data.rounds.length) return null;
    var rounds = [];
    var people = null;
    for (var i = 0; i < data.rounds.length; i++) {
      var rd = data.rounds[i];
      if (!rd || typeof rd !== 'object' || !isText(rd.label)) return null;
      var raw = checkRaw(rd.raw);
      if (!raw || !raw.detail || !raw.who) return null;
      var names = JSON.stringify(raw.detail.people);
      if (people === null) people = names;
      else if (names !== people) return null;
      rounds.push({ label: rd.label, raw: raw });
    }
    return { active: data.active, rounds: rounds };
  }

  // { people: [name], items: [{ name, price, who: [index] }] } (raw text), or null.
  function checkDetail(d) {
    if (!d || typeof d !== 'object' || !Array.isArray(d.people) || !Array.isArray(d.items)) return null;
    if (d.people.length < 1 || d.people.length > MAX_PEOPLE) return null;
    if (d.items.length < 1 || d.items.length > MAX_ITEMS) return null;
    if (!d.people.every(isText)) return null;
    var n = d.people.length;
    var items = [];
    for (var i = 0; i < d.items.length; i++) {
      var it = d.items[i];
      if (!it || typeof it !== 'object' || !isText(it.name) || !isText(it.price) || !Array.isArray(it.who)) return null;
      var seen = {};
      for (var k = 0; k < it.who.length; k++) {
        var p = it.who[k];
        if (typeof p !== 'number' || !Number.isInteger(p) || p < 0 || p >= n || seen[p]) return null;
        seen[p] = true;
      }
      items.push({ name: it.name, price: it.price, who: it.who.slice().sort(function (a, b) { return a - b; }) });
    }
    return { people: d.people.slice(), items: items };
  }

  // -> { outing } (2+ rounds), { raw } (one bill, saved by any version) or null.
  // Damaged data is removed and the app opens with its defaults.
  function load() {
    var s = storage();
    if (!s) return null;
    var outingText = null, text = null;
    try {
      outingText = s.getItem(OUTING_KEY);
      text = s.getItem(STORAGE_KEY);
    } catch (err) { return null; }
    if (outingText != null) {
      var outing = parseOuting(outingText);
      if (outing) return { outing: outing };
      clear();
      return null;
    }
    if (text == null) return null;
    var raw = parseSaved(text);
    if (!raw) { clear(); return null; }
    return { raw: raw };
  }

  var paused = false;

  function save() {
    if (paused) return;
    var api = window.TipSplitter;
    var s = storage();
    if (!s || !api) return;
    try {
      var data = api.outing ? api.outing.getData() : null;
      if (data) {
        s.setItem(OUTING_KEY, JSON.stringify({ v: 1, active: data.active, rounds: data.rounds }));
        s.removeItem(STORAGE_KEY);
        return;
      }
      s.removeItem(OUTING_KEY);
      var raw = api.getRaw();
      if (!raw) return;
      s.setItem(STORAGE_KEY, JSON.stringify({
        v: 1, bill: raw.bill, people: raw.people, noTip: raw.noTip,
        tip: raw.tip, custom: raw.custom, roundUp: raw.roundUp, currency: raw.currency,
        mode: raw.mode, detail: raw.detail
      }));
    } catch (err) { /* quota or blocked storage: just do not remember */ }
  }

  function clear() {
    var s = storage();
    if (!s) return;
    try { s.removeItem(STORAGE_KEY); } catch (err) { /* nothing to do */ }
    try { s.removeItem(OUTING_KEY); } catch (err) { /* nothing to do */ }
  }

  // ---- Copy ---------------------------------------------------------------

  var copyBtn, shareBtn, resetBtn, statusEl, fallbackEl, fallbackText, copiedTimer = null;

  function hideFallback() {
    fallbackEl.hidden = true;
    fallbackText.value = '';
  }

  function showFallback(text) {
    fallbackText.value = text;
    fallbackEl.hidden = false;
    statusEl.textContent = '';
    try {
      fallbackText.focus();
      fallbackText.select();
    } catch (err) { /* selection is best-effort */ }
  }

  function showCopied() {
    hideFallback();
    copyBtn.textContent = COPIED_LABEL;
    statusEl.textContent = 'Resumen copiado';
    if (copiedTimer) clearTimeout(copiedTimer);
    copiedTimer = setTimeout(function () {
      copiedTimer = null;
      copyBtn.textContent = COPY_LABEL;
      statusEl.textContent = '';
    }, COPIED_MS);
  }

  // Old-style copy for browsers without navigator.clipboard. true on success.
  function legacyCopy(text) {
    var area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '0';
    area.style.left = '0';
    area.style.opacity = '0';
    document.body.appendChild(area);
    var ok = false;
    try {
      area.select();
      ok = document.execCommand('copy') === true;
    } catch (err) {
      ok = false;
    }
    document.body.removeChild(area);
    try { copyBtn.focus(); } catch (err) { /* focus is best-effort */ }
    return ok;
  }

  // The copied / shared text: today's summary with one round, every round
  // and everyone's running total with more (see the rounds block).
  function summaryText() {
    var api = window.TipSplitter;
    if (!api) return null;
    if (api.outing) return api.outing.summary();
    return api.buildSummary ? api.buildSummary(api.getValues()) : null;
  }

  function onCopy() {
    var text = summaryText();
    if (!text) { copyBtn.disabled = true; return; }
    recordNow();
    var clip = null;
    try { clip = navigator.clipboard; } catch (err) { clip = null; }
    if (clip && typeof clip.writeText === 'function') {
      var p;
      try { p = clip.writeText(text); } catch (err) { p = null; }
      if (p && typeof p.then === 'function') {
        p.then(showCopied, function () { showFallback(text); });
      } else {
        showFallback(text);
      }
      return;
    }
    if (legacyCopy(text)) showCopied();
    else showFallback(text);
  }

  // Opens WhatsApp (wa.me) with the same text that "Copiar resumen" copies.
  // Only navigates on click; nothing is loaded from the network on page load.
  function onShare() {
    var text = summaryText();
    if (!text) { shareBtn.disabled = true; return; }
    recordNow();
    var url = 'https://wa.me/?text=' + encodeURIComponent(text);
    var win = null;
    try { win = window.open(url, '_blank'); } catch (err) { win = null; }
    if (win) {
      try { win.opener = null; } catch (err) { /* best-effort */ }
      return;
    }
    // Pop-up blocked: open it in this tab instead (values are saved).
    try { window.location.href = url; } catch (err) { showFallback(text); }
  }

  function onValues() {
    var summary = null;
    try { summary = summaryText(); } catch (err) { summary = null; }
    copyBtn.disabled = !summary;
    shareBtn.disabled = !summary;
    // Never leave an old summary on screen.
    hideFallback();
  }

  function onReset() {
    var api = window.TipSplitter;
    paused = true;
    try {
      if (api.outing) api.outing.reset();
      else api.reset();
    } finally { paused = false; }
    clear();
    hideFallback();
  }

  // ---- History ("Últimas cuentas") -----------------------------------------

  var history = []; // newest first: { t, raw, total, each }
  var historyTimer = null;
  var historyList, historyEmpty, historyClearBtn;

  function sameRaw(a, b) {
    return JSON.stringify(checkRaw(a)) === JSON.stringify(checkRaw(b));
  }

  function checkEntry(e) {
    if (!e || typeof e !== 'object') return null;
    if (typeof e.t !== 'number' || !isFinite(e.t) || e.t <= 0) return null;
    var raw = checkRaw(e.raw);
    if (!raw) return null;
    if (typeof e.total !== 'string' || e.total.length > MAX_LONG_TEXT) return null;
    if (typeof e.each !== 'string' || e.each.length > MAX_LONG_TEXT) return null;
    return { t: e.t, raw: raw, total: e.total, each: e.each };
  }

  // Stored JSON -> list of valid entries (bad ones dropped, at most 5).
  function parseHistory(text) {
    if (typeof text !== 'string' || text === '') return [];
    var data;
    try { data = JSON.parse(text); } catch (err) { return []; }
    if (!data || data.v !== 1 || !Array.isArray(data.items)) return [];
    var out = [];
    for (var i = 0; i < data.items.length && out.length < HISTORY_MAX; i++) {
      var e = checkEntry(data.items[i]);
      if (e) out.push(e);
    }
    return out;
  }

  function loadHistory() {
    var s = storage();
    if (!s) return [];
    try { return parseHistory(s.getItem(HISTORY_KEY)); } catch (err) { return []; }
  }

  function saveHistory() {
    var s = storage();
    if (!s) return;
    try {
      if (history.length) s.setItem(HISTORY_KEY, JSON.stringify({ v: 1, items: history }));
      else s.removeItem(HISTORY_KEY);
    } catch (err) { /* blocked storage: the list lives for this visit only */ }
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  // Manual "10/11 21:45" (day/month hours:minutes), same on every browser.
  function formatDate(t) {
    var d = new Date(t);
    return pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1) + ' ' +
      pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function renderHistory() {
    while (historyList.firstChild) historyList.removeChild(historyList.firstChild);
    history.forEach(function (e, i) {
      var li = document.createElement('li');
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'history-item';
      btn.setAttribute('data-index', String(i));
      var date = document.createElement('span');
      date.className = 'history-date';
      date.textContent = formatDate(e.t);
      var total = document.createElement('span');
      total.className = 'history-total';
      total.textContent = 'Total ' + e.total;
      var each = document.createElement('span');
      each.className = 'history-each';
      each.textContent = e.each;
      btn.appendChild(date);
      btn.appendChild(document.createTextNode(' · '));
      btn.appendChild(total);
      btn.appendChild(document.createTextNode(' · '));
      btn.appendChild(each);
      li.appendChild(btn);
      historyList.appendChild(li);
    });
    historyList.hidden = history.length === 0;
    historyEmpty.hidden = history.length !== 0;
    historyClearBtn.disabled = history.length === 0;
  }

  // Adds the current values if they have valid results.
  function recordNow() {
    if (historyTimer) { clearTimeout(historyTimer); historyTimer = null; }
    var api = window.TipSplitter;
    // The list holds single bills; an outing with rounds is not one.
    if (api.outing && api.outing.count() > 1) return;
    try {
      var values = api.getValues();
      var parts = api.historyParts(values);
      var raw = checkRaw(api.getRaw());
      if (!parts || !raw) return;
      history = history.filter(function (e) { return !sameRaw(e.raw, raw); });
      history.unshift({ t: Date.now(), raw: raw, total: parts.total, each: parts.each });
      if (history.length > HISTORY_MAX) history.length = HISTORY_MAX;
      saveHistory();
      renderHistory();
    } catch (err) {
      console.error('TipSplitter history failed', err);
    }
  }

  // Any edit by the user restarts the 3 s pause.
  function onUserEdit() {
    if (historyTimer) clearTimeout(historyTimer);
    historyTimer = setTimeout(recordNow, HISTORY_IDLE_MS);
  }

  // Closing the tab inside the pause still records the bill.
  function onPageHide() {
    if (historyTimer) recordNow();
  }

  function onHistoryClick(event) {
    var target = event.target;
    while (target && target !== historyList && !target.hasAttribute('data-index')) {
      target = target.parentNode;
    }
    if (!target || target === historyList) return;
    var entry = history[Number(target.getAttribute('data-index'))];
    if (!entry) return;
    if (historyTimer) { clearTimeout(historyTimer); historyTimer = null; }
    var api = window.TipSplitter;
    if (api.outing) api.outing.loadRaw(entry.raw);
    else api.setRaw(entry.raw);
    statusEl.textContent = 'Cuenta cargada: total ' + entry.total;
    try {
      document.getElementById('tip-form').scrollIntoView({ block: 'start' });
    } catch (err) { /* scrolling is best-effort */ }
  }

  function onClearHistory() {
    if (historyTimer) { clearTimeout(historyTimer); historyTimer = null; }
    history = [];
    saveHistory();
    renderHistory();
    statusEl.textContent = 'Historial borrado';
  }

  // ---- Init ---------------------------------------------------------------

  function init() {
    copyBtn = document.getElementById('copy-summary');
    shareBtn = document.getElementById('share-whatsapp');
    resetBtn = document.getElementById('reset');
    statusEl = document.getElementById('copy-status');
    fallbackEl = document.getElementById('copy-fallback');
    fallbackText = document.getElementById('copy-fallback-text');
    var api = window.TipSplitter;
    historyList = document.getElementById('history-list');
    historyEmpty = document.getElementById('history-empty');
    historyClearBtn = document.getElementById('history-clear');
    var form = document.getElementById('tip-form');
    if (!copyBtn || !shareBtn || !resetBtn || !statusEl || !fallbackEl || !fallbackText ||
        !historyList || !historyEmpty || !historyClearBtn || !form) {
      console.error('TipSplitter: action elements are missing from index.html');
      return;
    }
    if (!api || typeof api.onChange !== 'function' || typeof api.buildSummary !== 'function' ||
        typeof api.setRaw !== 'function') {
      console.error('TipSplitter: inputs or results module is not available');
      return;
    }

    var saved = load();
    if (saved && saved.outing && api.outing) api.outing.restore(saved.outing);
    else if (saved && saved.raw) api.setRaw(saved.raw);

    // With the rounds block, its notice comes after the active round is stored.
    var changes = api.outing || api;
    changes.onChange(onValues);
    changes.onChange(save);
    onValues();

    copyBtn.addEventListener('click', onCopy);
    shareBtn.addEventListener('click', onShare);
    resetBtn.addEventListener('click', onReset);

    history = loadHistory();
    renderHistory();
    form.addEventListener('input', onUserEdit);
    form.addEventListener('change', onUserEdit);
    // Adding or removing people/items in "Cuenta detallada" is an edit too.
    form.addEventListener('click', function (event) {
      var t = event.target;
      while (t && t !== form && t.tagName !== 'BUTTON') t = t.parentNode;
      if (t && t !== form) onUserEdit();
    });
    historyList.addEventListener('click', onHistoryClick);
    historyClearBtn.addEventListener('click', onClearHistory);
    window.addEventListener('pagehide', onPageHide);
  }

  if (window.TipSplitter) {
    // Exposed for testing; pure function with no DOM access.
    window.TipSplitter.parseSaved = parseSaved;
    window.TipSplitter.parseOuting = parseOuting;
    window.TipSplitter.parseHistory = parseHistory;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
