/* global Logic */
const { esc, parseMoney, fmtMoney, fmtDate, personName, sortName, methodLabel } = Logic;

const main = document.getElementById('main');
const nav = document.getElementById('nav');
const saveState = document.getElementById('saveState');
const toastEl = document.getElementById('toast');

let data = null;
let page = 'gifts';

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const ui = {
  giftYear: String(new Date().getFullYear()),
  giftSearch: '',
  letterSearch: '',
  editGiftId: null,
  lastDate: todayIso(),
  lastType: 'check',
  lastFund: null,
  donorSearch: '',
  letterYear: null,
  letterDate: todayIso(),
  previewKey: null,
  optIndividual: true,
  optCombined: true,
};

// ---------- persistence ----------
let saveTimer = null;
function save() {
  saveState.textContent = 'Saving…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await window.store.save(data);
      saveState.textContent = 'All changes saved';
    } catch (e) {
      saveState.textContent = 'SAVE FAILED';
      toast('Could not save: ' + e.message, true);
    }
  }, 150);
}

function newId() { return data.nextId++; }

let toastTimer = null;
function toast(msg, isErr) {
  toastEl.textContent = msg;
  toastEl.classList.toggle('err', !!isErr);
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, isErr ? 7000 : 3500);
}

// ---------- helpers ----------
const person = id => data.people.find(p => p.id === id);
const household = id => data.households.find(h => h.id === id);
const fund = id => data.funds.find(f => f.id === id);
const peopleSorted = () => [...data.people].sort((a, b) => sortName(a).toLowerCase().localeCompare(sortName(b).toLowerCase()));
const giftsOf = pid => data.gifts.filter(g => g.personId === pid);

function hhAddress(h) {
  const city = [h.city, [h.state, h.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return [h.address1, h.address2, city].filter(Boolean).join(', ');
}

function yearOptions(selected) {
  const set = new Set(Logic.yearsWithGifts(data));
  set.add(String(new Date().getFullYear()));
  if (selected) set.add(String(selected));
  return [...set].sort().reverse().map(y => `<option value="${y}" ${y === String(selected) ? 'selected' : ''}>${y}</option>`).join('');
}

// ---------- dialog ----------
function openDialog(title, bodyHtml, onSubmit, submitLabel) {
  const dlg = document.createElement('dialog');
  dlg.innerHTML = `<form method="dialog"><h2>${esc(title)}</h2>${bodyHtml}<div class="foot"><button type="button" class="btn" data-cancel>Cancel</button><button type="submit" class="btn primary">${esc(submitLabel || 'Save')}</button></div></form>`;
  document.body.appendChild(dlg);
  const form = dlg.querySelector('form');
  dlg.querySelector('[data-cancel]').addEventListener('click', () => dlg.close());
  dlg.addEventListener('close', () => dlg.remove());
  form.addEventListener('submit', e => {
    e.preventDefault();
    const values = Object.fromEntries(new FormData(form).entries());
    const err = onSubmit(values);
    if (err) { toast(err, true); return; }
    dlg.close();
  });
  dlg.showModal();
  const first = dlg.querySelector('input, select, textarea');
  if (first) first.focus();
}

// ---------- donor search (shared) ----------
function donorLabel(p) { return sortName(p); }
function donorHaystack(p) {
  const h = household(p.householdId) || {};
  return [p.firstName, p.lastName, personName(p), sortName(p), h.name, h.address1, h.city, p.email].join(' ').toLowerCase();
}
// Every word typed must appear somewhere in the donor's name, household name, street, city or email.
function findDonors(q, limit) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const all = peopleSorted();
  const hits = words.length ? all.filter(p => { const hay = donorHaystack(p); return words.every(w => hay.includes(w)); }) : all;
  return hits.slice(0, limit || 50);
}

const picker = { results: [], active: -1 };
function pickerEls() {
  return { text: document.getElementById('donorText'), list: document.getElementById('donorList'), hidden: main.querySelector('#giftForm input[name=personId]') };
}
function renderPicker(open) {
  const { text, list } = pickerEls();
  if (!text) return;
  if (!open) { list.hidden = true; text.setAttribute('aria-expanded', 'false'); return; }
  picker.results = findDonors(text.value, 50);
  if (picker.active >= picker.results.length) picker.active = picker.results.length - 1;
  const total = text.value.trim() ? null : data.people.length;
  list.innerHTML = picker.results.length ? picker.results.map((p, i) => {
    const h = household(p.householdId) || {};
    const addr = [h.address1, h.city].filter(Boolean).join(', ');
    return `<div class="opt ${i === picker.active ? 'on' : ''}" role="option" id="dopt${i}" data-pick="${p.id}" aria-selected="${i === picker.active}"><span class="nm">${esc(sortName(p))}</span><span class="ad">${esc(addr)}</span></div>`;
  }).join('') + (total && total > 50 ? `<div class="more">Showing 50 of ${total}. Keep typing to narrow it down.</div>` : '')
    : '<div class="more">No donor matches. Add them on the Donors page.</div>';
  list.hidden = false;
  text.setAttribute('aria-expanded', 'true');
  if (picker.active >= 0) { const el = document.getElementById('dopt' + picker.active); if (el) { el.scrollIntoView({ block: 'nearest' }); text.setAttribute('aria-activedescendant', el.id); } }
  else text.removeAttribute('aria-activedescendant');
}
function choosePicker(p) {
  const { text, hidden } = pickerEls();
  hidden.value = p.id; text.value = donorLabel(p);
  renderPicker(false);
  const next = main.querySelector('#giftForm select[name=type]');
  if (next) next.focus();
}

// ---------- GIFTS ----------
function giftFormHtml() {
  const g = ui.editGiftId ? data.gifts.find(x => x.id === ui.editGiftId) : null;
  const type = g ? g.type : ui.lastType;
  const activeFunds = data.funds.filter(f => f.active || (g && g.fundId === f.id));
  const fundSel = g ? g.fundId : (ui.lastFund && fund(ui.lastFund) && fund(ui.lastFund).active ? ui.lastFund : (activeFunds[0] || {}).id);
  const chosen = g ? person(g.personId) : null;
  const nc = type === 'noncash';
  return `
  <form id="giftForm" class="panel" autocomplete="off">
    <h2>${g ? 'Edit gift' : 'Record a gift'}</h2>
    <div class="row">
      <label class="f">Date<input type="date" name="date" required value="${esc(g ? g.date : ui.lastDate)}"></label>
      <div class="f grow donor-pick"><label for="donorText">Donor</label>
        <input id="donorText" type="text" role="combobox" aria-expanded="false" aria-controls="donorList" aria-autocomplete="list" placeholder="Type a name or street…" value="${esc(chosen ? donorLabel(chosen) : '')}">
        <input type="hidden" name="personId" value="${chosen ? chosen.id : ''}">
        <div id="donorList" class="donor-list" role="listbox" hidden></div></div>
      <label class="f">Type<select name="type" id="giftType">
        <option value="check" ${type === 'check' ? 'selected' : ''}>Check</option>
        <option value="cash" ${type === 'cash' ? 'selected' : ''}>Cash</option>
        <option value="other" ${type === 'other' ? 'selected' : ''}>Other money</option>
        <option value="noncash" ${nc ? 'selected' : ''}>Non-cash item</option>
      </select></label>
      <label class="f ${type === 'check' ? '' : 'hidden'}" id="fCheck">Check #<input name="checkNo" size="8" value="${esc(g ? g.checkNo || '' : '')}"></label>
      <label class="f ${nc ? 'hidden' : ''}" id="fAmount">Amount<input name="amount" size="10" inputmode="decimal" placeholder="0.00" value="${g && g.amount ? esc((g.amount / 100).toFixed(2)) : ''}"></label>
      <label class="f ${nc ? 'hidden' : ''}" id="fFund">Fund<select name="fundId">${activeFunds.map(f => `<option value="${f.id}" ${f.id === fundSel ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select></label>
    </div>
    <div class="row" style="margin-top:10px">
      <label class="f grow ${nc ? '' : 'hidden'}" id="fDesc">Description of the item (no dollar value)<input name="description" value="${esc(g ? g.description || '' : '')}" placeholder="e.g. Yamaha upright piano"></label>
      <label class="f grow">Note (private, not printed on letters)<input name="note" value="${esc(g ? g.note || '' : '')}"></label>
      <button class="btn primary" type="submit">${g ? 'Save changes' : 'Add gift'}</button>
      ${g ? '<button class="btn" type="button" data-action="cancelGiftEdit">Cancel</button>' : ''}
    </div>
  </form>`;
}

function giftListHtml() {
  const q = ui.giftSearch.trim().toLowerCase();
  let rows = data.gifts.filter(g => g.date.slice(0, 4) === ui.giftYear);
  if (q) {
    rows = rows.filter(g => {
      const p = person(g.personId);
      const f = fund(g.fundId);
      return [p ? personName(p) : '', p ? sortName(p) : '', f ? f.name : '', g.checkNo, g.description, g.note, fmtDate(g.date)]
        .some(v => String(v || '').toLowerCase().includes(q));
    });
  }
  rows.sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  const cash = rows.filter(g => g.type !== 'noncash');
  const total = cash.reduce((s, g) => s + g.amount, 0);
  const byFund = new Map();
  for (const g of cash) byFund.set(g.fundId, (byFund.get(g.fundId) || 0) + g.amount);
  const chips = data.funds.filter(f => byFund.has(f.id)).map(f => `<span class="chip">${esc(f.name)}: ${fmtMoney(byFund.get(f.id))}</span>`).join('');
  const body = rows.map(g => {
    const p = person(g.personId);
    const f = fund(g.fundId);
    return `<tr class="${g.id === ui.editGiftId ? 'sel' : ''}">
      <td>${esc(fmtDate(g.date))}</td>
      <td>${esc(p ? sortName(p) : '(missing donor)')}</td>
      <td>${g.type === 'noncash' ? '<span class="muted">—</span>' : esc(f ? f.name : '')}</td>
      <td>${esc(methodLabel(g))}</td>
      <td class="num">${g.type === 'noncash' ? '' : fmtMoney(g.amount)}</td>
      <td>${esc(g.type === 'noncash' ? g.description : '')}${g.note ? `<div class="muted small">${esc(g.note)}</div>` : ''}</td>
      <td class="actions"><button class="link" data-action="editGift" data-id="${g.id}">Edit</button><button class="link danger" data-action="deleteGift" data-id="${g.id}">Delete</button></td>
    </tr>`;
  }).join('');
  return `
    <div class="small muted" style="margin-bottom:8px">${rows.length} gift${rows.length === 1 ? '' : 's'} shown · monetary total <strong>${fmtMoney(total)}</strong></div>
    ${rows.length ? `<table class="grid"><thead><tr><th>Date</th><th>Donor</th><th>Fund</th><th>Method</th><th class="num">Amount</th><th>Item / note</th><th></th></tr></thead><tbody>${body}</tbody></table>` : '<div class="muted">No gifts to show for this year.</div>'}
    ${chips ? `<div class="chips">${chips}</div>` : ''}`;
}

function renderGifts() {
  const noDonors = !data.people.length;
  main.innerHTML = `
    <h1>Gifts</h1>
    ${noDonors ? '<div class="notice">Add at least one donor on the Donors page before recording gifts.</div>' : giftFormHtml()}
    <div class="panel">
      <div class="row" style="margin-bottom:12px">
        <label class="f">Year<select data-change="giftYear">${yearOptions(ui.giftYear)}</select></label>
        <label class="f grow">Search<input data-input="giftSearch" value="${esc(ui.giftSearch)}" placeholder="Donor, fund, check #, description…"></label>
      </div>
      <div id="giftList">${giftListHtml()}</div>
    </div>`;
}

function submitGift(form) {
  const v = Object.fromEntries(new FormData(form).entries());
  const personId = parseInt(v.personId, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date || '')) return toast('Enter a valid date.', true);
  if (!person(personId)) return toast('Choose a donor from the list: type part of a name, then click it or press Enter.', true);
  const g = { personId, date: v.date, type: v.type, note: (v.note || '').trim() };
  if (v.type === 'noncash') {
    g.description = (v.description || '').trim();
    if (!g.description) return toast('Describe the non-cash item.', true);
    g.amount = 0; g.fundId = null; g.checkNo = '';
  } else {
    const cents = parseMoney(v.amount);
    if (cents == null) return toast('Enter an amount greater than zero, like 125 or 125.50.', true);
    const fundId = parseInt(v.fundId, 10);
    if (!fund(fundId)) return toast('Choose a fund.', true);
    g.amount = cents; g.fundId = fundId; g.description = '';
    g.checkNo = v.type === 'check' ? (v.checkNo || '').trim() : '';
  }
  if (ui.editGiftId) {
    Object.assign(data.gifts.find(x => x.id === ui.editGiftId), g);
    ui.editGiftId = null;
    toast('Gift updated.');
  } else {
    g.id = newId();
    data.gifts.push(g);
    ui.lastDate = g.date; ui.lastType = g.type; if (g.fundId) ui.lastFund = g.fundId;
    const p = person(personId);
    toast(g.type === 'noncash' ? `Recorded non-cash gift from ${personName(p)}.` : `Recorded ${fmtMoney(g.amount)} from ${personName(p)}.`);
  }
  ui.giftYear = g.date.slice(0, 4);
  save();
  renderGifts();
  const dt = document.getElementById('donorText');
  if (dt) dt.focus();
}

// ---------- DONORS ----------
function donorListHtml() {
  const q = ui.donorSearch.trim().toLowerCase();
  const year = String(new Date().getFullYear());
  let hhs = [...data.households];
  const members = h => data.people.filter(p => p.householdId === h.id);
  if (q) hhs = hhs.filter(h => [h.name, hhAddress(h), ...members(h).flatMap(p => [personName(p), p.email])].some(v => String(v || '').toLowerCase().includes(q)));
  const key = h => { const m = members(h)[0]; return (m ? sortName(m) : h.name || '').toLowerCase(); };
  hhs.sort((a, b) => key(a).localeCompare(key(b)));
  if (!hhs.length) return `<div class="muted">${data.households.length ? 'No donors match that search.' : 'No donors yet. Add the first one above.'}</div>`;
  return hhs.map(h => {
    const ms = members(h).sort((a, b) => a.id - b.id);
    const rows = ms.map(p => {
      const ytd = giftsOf(p.id).filter(g => g.date.slice(0, 4) === year && g.type !== 'noncash').reduce((s, g) => s + g.amount, 0);
      return `<tr>
        <td>${esc(personName(p))}</td>
        <td class="muted">${esc(p.email || '')}</td>
        <td class="num">${fmtMoney(ytd)}</td>
        <td class="actions"><button class="link" data-action="history" data-id="${p.id}">History</button><button class="link" data-action="editPerson" data-id="${p.id}">Edit</button><button class="link danger" data-action="deletePerson" data-id="${p.id}">Delete</button></td>
      </tr>`;
    }).join('');
    const addr = hhAddress(h);
    return `<div class="hh">
      <div class="hh-head"><span class="t">${esc(h.name || '(unnamed household)')}</span><span class="a">${addr ? esc(addr) : '<em>No mailing address</em>'}</span>
        <span class="actions"><button class="link" data-action="addPerson" data-id="${h.id}">Add person</button><button class="link" data-action="editHousehold" data-id="${h.id}">Edit household</button><button class="link danger" data-action="deleteHousehold" data-id="${h.id}">Delete</button></span></div>
      <div class="hh-body">${ms.length ? `<table class="grid"><thead><tr><th>Person</th><th>Email</th><th class="num">${year} given</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : '<div class="muted" style="padding:8px 0">No people in this household.</div>'}</div>
    </div>`;
  }).join('');
}

function renderDonors() {
  main.innerHTML = `
    <h1>Donors</h1>
    <form id="donorForm" class="panel" autocomplete="off">
      <h2>Add a donor</h2>
      <div class="row">
        <label class="f">First name<input name="firstName" required></label>
        <label class="f">Last name<input name="lastName" required></label>
        <label class="f grow">Email (optional)<input name="email" type="email"></label>
      </div>
      <div class="row" style="margin-top:10px">
        <label class="f grow">Street address<input name="address1"></label>
        <label class="f">Apt / line 2<input name="address2" size="10"></label>
        <label class="f">City<input name="city" size="14"></label>
        <label class="f">State<input name="state" size="3" maxlength="2"></label>
        <label class="f">ZIP<input name="zip" size="8"></label>
        <button class="btn primary" type="submit">Add donor</button>
      </div>
      <p class="help">This creates a new household with one person. To add a spouse or family member at the same address, use "Add person" on the household below. Everyone gets their own year-end letter; people in a household just share the mailing address.</p>
    </form>
    <div class="panel">
      <div class="row" style="margin-bottom:12px"><label class="f grow">Search donors<input data-input="donorSearch" value="${esc(ui.donorSearch)}" placeholder="Name, address, email…"></label></div>
      <div id="donorList">${donorListHtml()}</div>
    </div>`;
}

function submitDonor(form) {
  const v = Object.fromEntries(new FormData(form).entries());
  const first = (v.firstName || '').trim(), last = (v.lastName || '').trim();
  if (!first || !last) return toast('Enter a first and last name.', true);
  const h = { id: newId(), name: `${first} ${last}`, address1: (v.address1 || '').trim(), address2: (v.address2 || '').trim(), city: (v.city || '').trim(), state: (v.state || '').trim().toUpperCase(), zip: (v.zip || '').trim() };
  data.households.push(h);
  data.people.push({ id: newId(), householdId: h.id, firstName: first, lastName: last, email: (v.email || '').trim() });
  save();
  toast(`Added ${first} ${last}.`);
  renderDonors();
  main.querySelector('#donorForm input[name=firstName]').focus();
}

function personDialog(hid, p) {
  const h = household(hid);
  openDialog(p ? 'Edit person' : `Add a person to ${h.name || 'household'}`, `
    <div class="grid2">
      <label class="f">First name<input name="firstName" required value="${esc(p ? p.firstName : '')}"></label>
      <label class="f">Last name<input name="lastName" required value="${esc(p ? p.lastName : '')}"></label>
      <label class="f wide">Email (optional)<input name="email" type="email" value="${esc(p ? p.email || '' : '')}"></label>
    </div>`, v => {
    const first = (v.firstName || '').trim(), last = (v.lastName || '').trim();
    if (!first || !last) return 'Enter a first and last name.';
    const fields = { firstName: first, lastName: last, email: (v.email || '').trim() };
    if (p) Object.assign(p, fields); else data.people.push({ id: newId(), householdId: hid, ...fields });
    save(); renderDonors();
  });
}

function householdDialog(h) {
  openDialog('Edit household', `
    <div class="grid2">
      <label class="f wide">Household name (a label on the Donors page, e.g. "John and Mary Smith")<input name="name" value="${esc(h.name || '')}"></label>
      <label class="f wide">Street address<input name="address1" value="${esc(h.address1 || '')}"></label>
      <label class="f wide">Apt / line 2<input name="address2" value="${esc(h.address2 || '')}"></label>
      <label class="f">City<input name="city" value="${esc(h.city || '')}"></label>
      <label class="f">State<input name="state" maxlength="2" value="${esc(h.state || '')}"></label>
      <label class="f">ZIP<input name="zip" value="${esc(h.zip || '')}"></label>
    </div>`, v => {
    Object.assign(h, { name: (v.name || '').trim(), address1: (v.address1 || '').trim(), address2: (v.address2 || '').trim(), city: (v.city || '').trim(), state: (v.state || '').trim().toUpperCase(), zip: (v.zip || '').trim() });
    save(); renderDonors();
  });
}

function historyDialog(p) {
  const gifts = giftsOf(p.id).sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  const years = [...new Set(gifts.map(g => g.date.slice(0, 4)))];
  const h = household(p.householdId) || {};
  const all = gifts.filter(g => g.type !== 'noncash').reduce((s, g) => s + g.amount, 0);
  const body = years.map(y => {
    const yg = gifts.filter(g => g.date.slice(0, 4) === y);
    const tot = yg.filter(g => g.type !== 'noncash').reduce((s, g) => s + g.amount, 0);
    return `<details ${y === years[0] ? 'open' : ''} class="hist"><summary><strong>${y}</strong><span>${yg.length} gift${yg.length === 1 ? '' : 's'}</span><span class="num">${fmtMoney(tot)}</span></summary>
      <table class="grid"><thead><tr><th>Date</th><th>Fund</th><th>Method</th><th class="num">Amount</th></tr></thead><tbody>${yg.map(g => `<tr><td>${esc(fmtDate(g.date))}</td><td>${g.type === 'noncash' ? '<span class="muted">—</span>' : esc((fund(g.fundId) || {}).name || '')}</td><td>${esc(methodLabel(g))}</td><td class="num">${g.type === 'noncash' ? esc(g.description) : fmtMoney(g.amount)}</td></tr>`).join('')}</tbody></table></details>`;
  }).join('');
  const dlg = document.createElement('dialog');
  dlg.className = 'wide';
  dlg.innerHTML = `<h2>Giving history: ${esc(personName(p))}</h2>
    <div class="muted small" style="margin-bottom:12px">${esc(hhAddress(h) || 'No mailing address')} · ${gifts.length} gift${gifts.length === 1 ? '' : 's'} recorded · ${fmtMoney(all)} monetary in total</div>
    ${body || '<div class="muted">No gifts recorded yet.</div>'}
    <div class="foot"><button type="button" class="btn primary" data-close>Close</button></div>`;
  document.body.appendChild(dlg);
  dlg.querySelector('[data-close]').addEventListener('click', () => dlg.close());
  dlg.addEventListener('close', () => dlg.remove());
  dlg.showModal();
}

// ---------- FUNDS ----------
function renderFunds() {
  const rows = data.funds.map(f => {
    const n = data.gifts.filter(g => g.fundId === f.id).length;
    return `<tr>
      <td>${esc(f.name)}</td>
      <td>${f.active ? 'Active' : '<span class="muted">Retired (hidden from gift entry)</span>'}</td>
      <td class="num">${n}</td>
      <td class="actions"><button class="link" data-action="renameFund" data-id="${f.id}">Rename</button><button class="link" data-action="toggleFund" data-id="${f.id}">${f.active ? 'Retire' : 'Reactivate'}</button>${n ? '' : `<button class="link danger" data-action="deleteFund" data-id="${f.id}">Delete</button>`}</td>
    </tr>`;
  }).join('');
  main.innerHTML = `
    <h1>Funds</h1>
    <form id="fundForm" class="panel" autocomplete="off"><div class="row">
      <label class="f grow">New fund name<input name="name" required placeholder="e.g. Building Fund"></label>
      <button class="btn primary" type="submit">Add fund</button></div>
      <p class="help">Every monetary gift is assigned to one fund. A fund that already has gifts can be retired but not deleted, so past records stay intact.</p>
    </form>
    <div class="panel"><table class="grid"><thead><tr><th>Fund</th><th>Status</th><th class="num">Gifts recorded</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

// ---------- LETTERS ----------
let currentLetters = [];
function letterRowsHtml() {
  const words = ui.letterSearch.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = words.length ? currentLetters.filter(l => { const hay = donorHaystack(l.people[0]); return words.every(w => hay.includes(w)); }) : currentLetters;
  if (!shown.length) return '<div class="muted">No letter matches that search.</div>';
  return `${words.length ? `<div class="small muted" style="margin-bottom:6px">${shown.length} of ${currentLetters.length} letters</div>` : ''}<table class="grid"><thead><tr><th>Addressed to</th><th class="num">Gifts</th><th class="num">Total</th><th></th></tr></thead><tbody>${shown.map(l => `<tr class="${l.key === ui.previewKey ? 'sel' : ''}">
      <td>${esc(l.addressee)}${l.household.address1 ? '' : ' <span class="chip">no address</span>'}</td>
      <td class="num">${l.gifts.length}</td>
      <td class="num">${fmtMoney(l.total)}</td>
      <td class="actions"><button class="link" data-action="previewLetter" data-key="${l.key}">Preview</button></td></tr>`).join('')}</tbody></table>`;
}
function renderLetters() {
  const years = Logic.yearsWithGifts(data);
  if (!ui.letterYear) ui.letterYear = years[0] || String(new Date().getFullYear());
  currentLetters = Logic.buildLetters(data, ui.letterYear, ui.letterDate);
  const s = data.settings;
  const warns = [];
  if (!s.churchName) warns.push('The church name is blank. Fill it in on the Settings page; the IRS requires the organization\'s name on the letter.');
  if (!s.signerName) warns.push('No signer name is set on the Settings page.');
  const noAddr = currentLetters.filter(l => !l.household.address1).length;
  if (noAddr) warns.push(`${noAddr} letter${noAddr === 1 ? ' has' : 's have'} no mailing address (marked below).`);
  if (!currentLetters.some(l => l.key === ui.previewKey)) ui.previewKey = currentLetters[0] ? currentLetters[0].key : null;
  const total = currentLetters.reduce((a, l) => a + l.total, 0);
  const preview = currentLetters.find(l => l.key === ui.previewKey);
  main.innerHTML = `
    <h1>Year-end letters</h1>
    ${warns.map(w => `<div class="notice">${esc(w)}</div>`).join('')}
    <div class="split">
      <div>
        <div class="panel">
          <div class="row">
            <label class="f">Giving year<select data-change="letterYear">${yearOptions(ui.letterYear)}</select></label>
            <label class="f">Date printed on letters<input type="date" data-change="letterDate" value="${esc(ui.letterDate)}"></label>
          </div>
          <div style="margin-top:12px">
            <label><input type="checkbox" data-change="optIndividual" ${ui.optIndividual ? 'checked' : ''}> One PDF per letter</label><br>
            <label><input type="checkbox" data-change="optCombined" ${ui.optCombined ? 'checked' : ''}> One PDF with every letter, for printing in one go</label>
          </div>
          <div style="margin-top:12px"><button class="btn primary" data-action="exportLetters" ${currentLetters.length ? '' : 'disabled'}>Save ${currentLetters.length} letter${currentLetters.length === 1 ? '' : 's'} as PDF…</button></div>
          <p class="help">Only donors with at least one gift in ${esc(ui.letterYear)} get a letter. Each person gets their own letter, even when they share an address.</p>
        </div>
        <div class="panel">
          <div class="small muted" style="margin-bottom:8px">${currentLetters.length} letter${currentLetters.length === 1 ? '' : 's'} · ${fmtMoney(total)} total monetary giving</div>
          ${currentLetters.length ? `<label class="f" style="margin-bottom:10px">Find a letter<input data-input="letterSearch" value="${esc(ui.letterSearch)}" placeholder="Name or street…"></label><div id="letterRows">${letterRowsHtml()}</div>` : '<div class="muted">No gifts recorded for this year.</div>'}
        </div>
      </div>
      <div class="panel"><h2>Preview${preview ? ': ' + esc(preview.addressee) : ''}</h2><iframe class="preview" id="preview" sandbox="" title="Letter preview"></iframe></div>
    </div>`;
  const frame = document.getElementById('preview');
  if (preview) frame.srcdoc = preview.html.replace('<body>', '<body style="padding:0.6in 0.7in">');
}

async function exportLetters() {
  if (!ui.optIndividual && !ui.optCombined) return toast('Tick at least one of the two PDF options.', true);
  const payload = {
    letters: ui.optIndividual ? currentLetters.map(l => ({ filename: l.filename, html: l.html })) : [],
    combined: ui.optCombined ? { filename: `${ui.letterYear} Giving Letters - ALL (for printing)`, html: Logic.wrapLetters(currentLetters.map(l => l.body), `${ui.letterYear} Giving Letters`) } : null,
  };
  toast('Creating PDFs…');
  try {
    const res = await window.store.exportLetters(payload);
    if (res) toast(`Saved ${res.count} PDF file${res.count === 1 ? '' : 's'} to ${res.folder}`);
    else toastEl.hidden = true;
  } catch (e) { toast('Could not create the PDFs: ' + e.message, true); }
}

// ---------- SETTINGS ----------
let dataLocation = '';
function renderSettings() {
  const s = data.settings;
  const f = (label, key, cls) => `<label class="f ${cls || ''}">${label}<input data-setting="${key}" value="${esc(s[key] || '')}"></label>`;
  main.innerHTML = `
    <h1>Settings</h1>
    <div class="panel"><h2>Church information (printed at the top of every letter)</h2>
      <div class="grid2">
        ${f('Church name', 'churchName', 'wide')}
        ${f('Street address', 'address1')}
        ${f('Address line 2', 'address2')}
        ${f('City, State ZIP', 'cityStateZip')}
        ${f('Phone', 'phone')}
        ${f('Federal Tax ID / EIN (optional, printed at the bottom)', 'ein', 'wide')}
        ${f('Signer name', 'signerName')}
        ${f('Signer title', 'signerTitle')}
      </div>
    </div>
    <div class="panel"><h2>Letter header</h2>
      <div class="row" style="align-items:center">
        <div style="border:1px solid var(--line);border-radius:6px;padding:8px;min-width:160px;min-height:70px;display:flex;align-items:center;justify-content:center;background:#fff">${s.logo ? `<img src="${esc(s.logo)}" alt="Letter logo" style="max-height:80px;max-width:240px">` : '<span class="muted small">No logo</span>'}</div>
        <div style="display:flex;flex-direction:column;gap:6px">
          <button class="btn" data-action="chooseLogo">Choose image…</button>
          <button class="btn" data-action="defaultLogo">Use the church drawing</button>
          ${s.logo ? '<button class="btn danger" data-action="removeLogo">Remove logo</button>' : ''}
        </div>
        <label class="f grow">Text beside the logo (one line per row)<textarea data-setting="headerText" style="min-height:76px">${esc(s.headerText || '')}</textarea></label>
      </div>
      <p class="help">PNG or JPG. A larger, sharper image prints better; it is shown about one inch tall. With no logo, the header shows the church name only.</p>
    </div>
    <div class="panel"><h2>Letter wording</h2>
      <label class="f">Opening paragraph<textarea data-setting="intro">${esc(s.intro)}</textarea></label>
      <p class="help">You can use {church}, {year} and {total}; they are filled in on each letter.</p>
      <label class="f" style="margin-top:12px">Goods-and-services statement
        <select data-setting="statementMode">
          <option value="intangible" ${s.statementMode === 'intangible' ? 'selected' : ''}>No goods or services, other than intangible religious benefits</option>
          <option value="none" ${s.statementMode === 'none' ? 'selected' : ''}>No goods or services</option>
          <option value="custom" ${s.statementMode === 'custom' ? 'selected' : ''}>Custom wording (below)</option>
        </select></label>
      <p class="help" id="statementShown">${esc(Logic.statementText(s))}</p>
      <label class="f ${s.statementMode === 'custom' ? '' : 'hidden'}" id="customStatement" style="margin-top:8px">Custom statement<textarea data-setting="statementCustom">${esc(s.statementCustom || '')}</textarea></label>
      <label class="f" style="margin-top:12px">Closing paragraph<textarea data-setting="closing">${esc(s.closing)}</textarea></label>
      <p class="help">IRS Publication 1771 describes what a contribution acknowledgment must contain. Have the church treasurer or accountant approve this wording.</p>
    </div>
    <div class="panel"><h2>Backup</h2>
      <div class="row"><button class="btn" data-action="exportBackup">Save a backup copy…</button><button class="btn danger" data-action="importBackup">Restore from a backup copy…</button></div>
      <p class="help">All records are kept in one file on this computer: <code>${esc(dataLocation)}</code><br>The app also keeps a dated copy for each of the last 30 days it was opened, in the "auto-backups" folder next to that file. Save a backup copy to a USB drive or other location regularly; if this computer fails, that copy is the only way to recover the records.</p>
    </div>`;
}

// ---------- routing & events ----------
const pages = { gifts: renderGifts, donors: renderDonors, funds: renderFunds, letters: renderLetters, settings: renderSettings };
function render() {
  nav.querySelectorAll('button[data-page]').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  pages[page]();
}

nav.addEventListener('click', e => {
  const b = e.target.closest('button[data-page]');
  if (!b) return;
  page = b.dataset.page; ui.editGiftId = null; render(); main.scrollTop = 0;
});

main.addEventListener('submit', e => {
  e.preventDefault();
  if (e.target.id === 'giftForm') submitGift(e.target);
  else if (e.target.id === 'donorForm') submitDonor(e.target);
  else if (e.target.id === 'fundForm') {
    const name = new FormData(e.target).get('name').trim();
    if (!name) return;
    if (data.funds.some(f => f.name.toLowerCase() === name.toLowerCase())) return toast('A fund with that name already exists.', true);
    data.funds.push({ id: newId(), name, active: true }); save(); renderFunds();
  }
});

main.addEventListener('input', e => {
  const t = e.target;
  if (t.id === 'donorText') { pickerEls().hidden.value = ''; picker.active = t.value.trim() ? 0 : -1; renderPicker(true); return; }
  if (t.dataset.input === 'letterSearch') { ui.letterSearch = t.value; document.getElementById('letterRows').innerHTML = letterRowsHtml(); return; }
  if (t.dataset.input === 'giftSearch') { ui.giftSearch = t.value; document.getElementById('giftList').innerHTML = giftListHtml(); }
  else if (t.dataset.input === 'donorSearch') { ui.donorSearch = t.value; document.getElementById('donorList').innerHTML = donorListHtml(); }
  else if (t.dataset.setting && t.tagName !== 'SELECT') { data.settings[t.dataset.setting] = t.value; save(); }
});

main.addEventListener('change', e => {
  const t = e.target;
  if (t.id === 'giftType') {
    const v = t.value;
    document.getElementById('fCheck').classList.toggle('hidden', v !== 'check');
    document.getElementById('fAmount').classList.toggle('hidden', v === 'noncash');
    document.getElementById('fFund').classList.toggle('hidden', v === 'noncash');
    document.getElementById('fDesc').classList.toggle('hidden', v !== 'noncash');
    return;
  }
  const c = t.dataset.change;
  if (c === 'giftYear') { ui.giftYear = t.value; document.getElementById('giftList').innerHTML = giftListHtml(); }
  else if (c === 'letterYear') { ui.letterYear = t.value; ui.previewKey = null; renderLetters(); }
  else if (c === 'letterDate') { if (t.value) { ui.letterDate = t.value; renderLetters(); } }
  else if (c === 'optIndividual') ui.optIndividual = t.checked;
  else if (c === 'optCombined') ui.optCombined = t.checked;
  else if (t.dataset.setting === 'statementMode') {
    data.settings.statementMode = t.value; save();
    document.getElementById('customStatement').classList.toggle('hidden', t.value !== 'custom');
    document.getElementById('statementShown').textContent = Logic.statementText(data.settings);
  }
});

const actions = {
  editGift(id) { ui.editGiftId = id; renderGifts(); main.scrollTop = 0; },
  cancelGiftEdit() { ui.editGiftId = null; renderGifts(); },
  deleteGift(id) {
    const g = data.gifts.find(x => x.id === id); const p = person(g.personId);
    if (!confirm(`Delete this gift?\n\n${fmtDate(g.date)} — ${p ? personName(p) : ''} — ${g.type === 'noncash' ? g.description : fmtMoney(g.amount)}`)) return;
    data.gifts = data.gifts.filter(x => x.id !== id); if (ui.editGiftId === id) ui.editGiftId = null; save(); renderGifts();
  },
  addPerson(id) { personDialog(id, null); },
  history(id) { historyDialog(person(id)); },
  editPerson(id) { const p = person(id); personDialog(p.householdId, p); },
  deletePerson(id) {
    const p = person(id); const n = giftsOf(id).length;
    if (n) return toast(`${personName(p)} has ${n} recorded gift${n === 1 ? '' : 's'} and can't be deleted. Delete or reassign those gifts first.`, true);
    if (!confirm(`Delete ${personName(p)}?`)) return;
    data.people = data.people.filter(x => x.id !== id); save(); renderDonors();
  },
  editHousehold(id) { householdDialog(household(id)); },
  deleteHousehold(id) {
    const h = household(id);
    if (data.people.some(p => p.householdId === id)) return toast('Remove the people in this household first.', true);
    if (!confirm(`Delete the household "${h.name}"?`)) return;
    data.households = data.households.filter(x => x.id !== id); save(); renderDonors();
  },
  renameFund(id) {
    const f = fund(id);
    openDialog('Rename fund', `<label class="f">Fund name<input name="name" required value="${esc(f.name)}"></label><p class="help">The new name will appear on past gifts in this fund too.</p>`, v => {
      const name = (v.name || '').trim();
      if (!name) return 'Enter a name.';
      if (data.funds.some(x => x.id !== id && x.name.toLowerCase() === name.toLowerCase())) return 'A fund with that name already exists.';
      f.name = name; save(); renderFunds();
    });
  },
  toggleFund(id) {
    const f = fund(id);
    if (f.active && data.funds.filter(x => x.active).length === 1) return toast('At least one fund must stay active.', true);
    f.active = !f.active; save(); renderFunds();
  },
  deleteFund(id) {
    if (data.gifts.some(g => g.fundId === id)) return toast('That fund has gifts and can\'t be deleted.', true);
    if (data.funds.length === 1) return toast('At least one fund is required.', true);
    data.funds = data.funds.filter(x => x.id !== id); save(); renderFunds();
  },
  async chooseLogo() {
    try {
      const url = await window.store.chooseLogo();
      if (!url) return;
      data.settings.logo = url; data.settings.logoSet = true; save(); renderSettings(); toast('Logo updated.');
    } catch (e) { toast('Could not use that image: ' + e.message, true); }
  },
  defaultLogo() { data.settings.logo = window.DEFAULT_LOGO; data.settings.logoSet = true; save(); renderSettings(); },
  removeLogo() { data.settings.logo = ''; data.settings.logoSet = true; save(); renderSettings(); },
  previewLetter(_id, el) { ui.previewKey = el.dataset.key; renderLetters(); },
  exportLetters() { exportLetters(); },
  async exportBackup() {
    try { await window.store.save(data); const p = await window.store.exportBackup(); if (p) toast('Backup saved to ' + p); }
    catch (e) { toast('Backup failed: ' + e.message, true); }
  },
  async importBackup() {
    if (!confirm('Restoring replaces ALL current records with the contents of the backup file. Continue?')) return;
    try {
      const d = await window.store.importBackup();
      if (!d) return;
      data = d; await window.store.save(data); ui.editGiftId = null; ui.letterYear = null; toast('Backup restored.'); render();
    } catch (e) { toast('Restore failed: ' + e.message, true); }
  },
};

main.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.action];
  if (fn) fn(el.dataset.id ? parseInt(el.dataset.id, 10) : null, el);
});

(async function init() {
  try {
    data = (await window.store.load()) || Logic.defaultData();
    dataLocation = await window.store.location();
    // A data file made by the first build has blank church details; fill them in once.
    const st = data.settings;
    let changed = false;
    if (!st.churchName && !st.address1 && !st.cityStateZip && !st.phone && !st.ein) { Object.assign(st, Logic.CHURCH_DEFAULTS); changed = true; }
    // Data from before the logo feature: add the header text and the bundled church drawing once.
    if (st.headerText === undefined) { st.headerText = Logic.CHURCH_DEFAULTS.headerText; changed = true; }
    if (st.logo === undefined || (st.logo === '' && !st.logoSet)) { st.logo = window.DEFAULT_LOGO; st.logoSet = true; changed = true; }
    if (changed) await window.store.save(data);
  } catch (e) {
    main.innerHTML = `<div class="notice">The data file could not be read, so the app has stopped rather than risk overwriting it.<br><br>${esc(e.message)}</div>`;
    return;
  }
  saveState.textContent = '';
  render();
})();

// ---------- donor picker events ----------
main.addEventListener('keydown', e => {
  if (e.target.id !== 'donorText') return;
  const { list } = pickerEls();
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (list.hidden) { picker.active = 0; renderPicker(true); return; }
    const n = picker.results.length; if (!n) return;
    picker.active = e.key === 'ArrowDown' ? Math.min(n - 1, picker.active + 1) : Math.max(0, picker.active - 1);
    renderPicker(true);
  } else if (e.key === 'Enter') {
    if (!list.hidden && picker.results[picker.active]) { e.preventDefault(); choosePicker(picker.results[picker.active]); }
    else if (!pickerEls().hidden.value) { e.preventDefault(); picker.active = 0; renderPicker(true); }
  } else if (e.key === 'Escape') { renderPicker(false); }
});
main.addEventListener('mousedown', e => {
  const opt = e.target.closest('[data-pick]');
  if (opt) { e.preventDefault(); choosePicker(person(parseInt(opt.dataset.pick, 10))); }
});
main.addEventListener('focusin', e => { if (e.target.id === 'donorText') { picker.active = -1; renderPicker(true); } });
main.addEventListener('focusout', e => {
  if (e.target.id !== 'donorText') return;
  setTimeout(() => {
    renderPicker(false);
    const { text, hidden } = pickerEls();
    if (text && !hidden.value) {
      // Typed text that matches exactly one donor counts as choosing them.
      const hits = text.value.trim() ? findDonors(text.value, 2) : [];
      if (hits.length === 1) { hidden.value = hits[0].id; text.value = donorLabel(hits[0]); }
    }
  }, 120);
});
