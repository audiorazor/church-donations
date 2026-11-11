// Pure data + letter logic. Shared by the app window and by the automated test.
(function (root) {
  const DEFAULT_INTRO = 'Thank you for your generous support of {church} during {year}. This letter is your record of the contributions we received from you between January 1 and December 31, {year}.';
  const STATEMENT_INTANGIBLE = 'No goods or services were provided to you in exchange for these contributions, other than intangible religious benefits.';
  const STATEMENT_NONE = 'No goods or services were provided to you in exchange for these contributions.';
  const DEFAULT_CLOSING = 'Please keep this letter with your tax records. Thank you again for your faithfulness and generosity.';

  // Prefilled for Yellow Frame Presbyterian Church; all editable on the Settings page.
  const CHURCH_DEFAULTS = {
    churchName: 'Yellow Frame Presbyterian Church',
    address1: '1 Yellow Frame Rd', address2: '',
    cityStateZip: 'Fredon Township, NJ 07860',
    phone: '973-534-6786',
    ein: '22-1860836',
  };

  function defaultData() {
    return {
      version: 1,
      nextId: 2,
      settings: {
        ...CHURCH_DEFAULTS,
        signerName: '', signerTitle: '',
        intro: DEFAULT_INTRO,
        statementMode: 'intangible', // 'intangible' | 'none' | 'custom'
        statementCustom: '',
        closing: DEFAULT_CLOSING,
      },
      funds: [{ id: 1, name: 'General Fund', active: true }],
      households: [],
      people: [],
      gifts: [],
    };
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // "1,234.5" -> 123450 (cents). Returns null when the text is not a valid positive amount.
  function parseMoney(text) {
    const t = String(text == null ? '' : text).replace(/[$,\s]/g, '');
    if (!/^\d+(\.\d{1,2})?$/.test(t) && !/^\.\d{1,2}$/.test(t)) return null;
    const [whole, frac = ''] = t.split('.');
    const cents = parseInt(whole || '0', 10) * 100 + parseInt((frac + '00').slice(0, 2), 10);
    return cents > 0 ? cents : null;
  }

  function fmtMoney(cents) {
    const neg = cents < 0;
    const c = Math.abs(cents);
    const whole = Math.floor(c / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-' : '') + '$' + whole + '.' + String(c % 100).padStart(2, '0');
  }

  function fmtDate(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    return m ? `${parseInt(m[2], 10)}/${parseInt(m[3], 10)}/${m[1]}` : (iso || '');
  }

  function longDate(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!m) return iso || '';
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    return `${months[parseInt(m[2], 10) - 1]} ${parseInt(m[3], 10)}, ${m[1]}`;
  }

  function personName(p) { return `${p.firstName} ${p.lastName}`.trim(); }
  function sortName(p) { return `${p.lastName}, ${p.firstName}`.trim(); }

  function joinNames(list) {
    if (list.length <= 1) return list.join('');
    if (list.length === 2) return list.join(' and ');
    return list.slice(0, -1).join(', ') + ', and ' + list[list.length - 1];
  }

  function methodLabel(g) {
    if (g.type === 'check') return g.checkNo ? `Check #${g.checkNo}` : 'Check';
    if (g.type === 'cash') return 'Cash';
    if (g.type === 'noncash') return 'Non-cash';
    return 'Other';
  }

  function yearsWithGifts(data) {
    const set = new Set(data.gifts.map(g => g.date.slice(0, 4)));
    return [...set].sort().reverse();
  }

  function statementText(settings) {
    if (settings.statementMode === 'none') return STATEMENT_NONE;
    if (settings.statementMode === 'custom') return settings.statementCustom || '';
    return STATEMENT_INTANGIBLE;
  }

  function fill(text, vars) {
    return String(text || '').replace(/\{(church|year|total)\}/g, (_m, k) => vars[k]);
  }

  // Decide who gets which letter for a year.
  // People set to "own letter" each get one. People set to "combined" share one letter per household.
  // Nobody gets a letter unless they (or their combined group) have at least one gift that year.
  function buildLetterGroups(data, year) {
    const y = String(year);
    const giftsByPerson = new Map();
    for (const g of data.gifts) {
      if (g.date.slice(0, 4) !== y) continue;
      if (!giftsByPerson.has(g.personId)) giftsByPerson.set(g.personId, []);
      giftsByPerson.get(g.personId).push(g);
    }
    const groups = [];
    for (const h of data.households) {
      const members = data.people.filter(p => p.householdId === h.id);
      const combined = members.filter(p => p.letterMode === 'household');
      const own = members.filter(p => p.letterMode !== 'household');
      const combinedGifts = combined.flatMap(p => giftsByPerson.get(p.id) || []);
      if (combinedGifts.length) {
        const multi = combined.length > 1;
        groups.push({
          key: 'h' + h.id,
          kind: multi ? 'combined' : 'individual',
          household: h,
          people: combined,
          gifts: combinedGifts,
          addressee: multi ? (h.name || joinNames(combined.map(personName))) : personName(combined[0]),
          salutation: joinNames(combined.map(p => p.firstName)),
          sortKey: multi ? (combined[0].lastName + ' ' + (h.name || '')) : sortName(combined[0]),
          fileLabel: multi ? (h.name || joinNames(combined.map(personName))) : sortName(combined[0]),
        });
      }
      for (const p of own) {
        const gifts = giftsByPerson.get(p.id) || [];
        if (!gifts.length) continue;
        groups.push({
          key: 'p' + p.id,
          kind: 'individual',
          household: h,
          people: [p],
          gifts,
          addressee: personName(p),
          salutation: p.firstName,
          sortKey: sortName(p),
          fileLabel: sortName(p),
        });
      }
    }
    for (const gr of groups) {
      gr.gifts.sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
      gr.cashGifts = gr.gifts.filter(g => g.type !== 'noncash');
      gr.noncashGifts = gr.gifts.filter(g => g.type === 'noncash');
      gr.total = gr.cashGifts.reduce((s, g) => s + g.amount, 0);
      gr.filename = `${y} Giving Letter - ${gr.fileLabel}`;
    }
    groups.sort((a, b) => a.sortKey.toLowerCase().localeCompare(b.sortKey.toLowerCase()));
    return groups;
  }

  const LETTER_CSS = `
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Georgia, 'Times New Roman', serif; font-size: 11.5pt; line-height: 1.45; color: #000; }
    .letter { page-break-after: always; break-after: page; }
    .letter:last-child { page-break-after: auto; break-after: auto; }
    .head { text-align: center; border-bottom: 1.5pt solid #000; padding-bottom: 8pt; margin-bottom: 18pt; }
    .head .name { font-size: 17pt; font-weight: bold; letter-spacing: .3pt; }
    .head .sub { font-size: 10pt; }
    .date { margin-bottom: 14pt; }
    .addr { margin-bottom: 18pt; }
    p { margin: 0 0 10pt 0; }
    h3 { font-size: 11.5pt; margin: 14pt 0 4pt 0; }
    table { width: 100%; border-collapse: collapse; font-size: 10.5pt; margin-bottom: 6pt; }
    th { text-align: left; border-bottom: 1pt solid #000; padding: 3pt 6pt 3pt 0; }
    td { padding: 2.5pt 6pt 2.5pt 0; border-bottom: .5pt solid #bbb; vertical-align: top; }
    tr { page-break-inside: avoid; break-inside: avoid; }
    thead { display: table-header-group; }
    .num { text-align: right; padding-right: 0; white-space: nowrap; }
    .total td { border-bottom: none; border-top: 1pt solid #000; font-weight: bold; }
    .statement { margin-top: 14pt; }
    .sign { margin-top: 22pt; page-break-inside: avoid; break-inside: avoid; }
    .ein { margin-top: 10pt; font-size: 9.5pt; }
  `;

  function letterBody(data, group, year, letterDateIso) {
    const s = data.settings;
    const fundName = id => (data.funds.find(f => f.id === id) || { name: '' }).name;
    const vars = { church: s.churchName || '', year: String(year), total: fmtMoney(group.total) };
    const showDonor = group.people.length > 1;
    const h = group.household;
    const cityLine = [h.city, [h.state, h.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    const addr = [group.addressee, h.address1, h.address2, cityLine].filter(Boolean).map(esc).join('<br>');
    const headSub = [s.address1, s.address2, s.cityStateZip, s.phone].filter(Boolean).map(esc).join(' &nbsp;•&nbsp; ');

    let out = `<section class="letter">`;
    out += `<div class="head"><div class="name">${esc(s.churchName)}</div>${headSub ? `<div class="sub">${headSub}</div>` : ''}</div>`;
    out += `<div class="date">${esc(longDate(letterDateIso))}</div>`;
    out += `<div class="addr">${addr}</div>`;
    out += `<p>Dear ${esc(group.salutation)},</p>`;
    out += `<p>${esc(fill(s.intro, vars))}</p>`;

    if (group.cashGifts.length) {
      out += `<h3>Monetary contributions</h3><table><thead><tr><th>Date</th>${showDonor ? '<th>Donor</th>' : ''}<th>Fund</th><th>Method</th><th class="num">Amount</th></tr></thead><tbody>`;
      for (const g of group.cashGifts) {
        const p = group.people.find(x => x.id === g.personId);
        out += `<tr><td>${esc(fmtDate(g.date))}</td>${showDonor ? `<td>${esc(p ? p.firstName : '')}</td>` : ''}<td>${esc(fundName(g.fundId))}</td><td>${esc(methodLabel(g))}</td><td class="num">${fmtMoney(g.amount)}</td></tr>`;
      }
      out += `<tr class="total"><td colspan="${showDonor ? 4 : 3}">Total monetary contributions for ${esc(String(year))}</td><td class="num">${fmtMoney(group.total)}</td></tr></tbody></table>`;

      const byFund = new Map();
      for (const g of group.cashGifts) byFund.set(g.fundId, (byFund.get(g.fundId) || 0) + g.amount);
      if (byFund.size > 1) {
        out += `<h3>Totals by fund</h3><table><tbody>`;
        for (const f of data.funds) if (byFund.has(f.id)) out += `<tr><td>${esc(f.name)}</td><td class="num">${fmtMoney(byFund.get(f.id))}</td></tr>`;
        out += `</tbody></table>`;
      }
    }

    if (group.noncashGifts.length) {
      out += `<h3>Non-cash contributions</h3><table><thead><tr><th>Date</th>${showDonor ? '<th>Donor</th>' : ''}<th>Description of property received</th></tr></thead><tbody>`;
      for (const g of group.noncashGifts) {
        const p = group.people.find(x => x.id === g.personId);
        out += `<tr><td>${esc(fmtDate(g.date))}</td>${showDonor ? `<td>${esc(p ? p.firstName : '')}</td>` : ''}<td>${esc(g.description)}</td></tr>`;
      }
      out += `</tbody></table>`;
    }

    const st = statementText(s);
    if (st) out += `<p class="statement">${esc(fill(st, vars))}</p>`;
    if (s.closing) out += `<p>${esc(fill(s.closing, vars))}</p>`;
    out += `<div class="sign">Sincerely,<br><br><br>${esc(s.signerName)}${s.signerTitle ? `<br>${esc(s.signerTitle)}` : ''}${s.churchName ? `<br>${esc(s.churchName)}` : ''}${s.ein ? `<div class="ein">Federal Tax ID (EIN): ${esc(s.ein)}</div>` : ''}</div>`;
    out += `</section>`;
    return out;
  }

  function wrapLetters(bodies, title) {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${LETTER_CSS}</style></head><body>${bodies.join('')}</body></html>`;
  }

  function buildLetters(data, year, letterDateIso) {
    const groups = buildLetterGroups(data, year);
    for (const g of groups) {
      g.body = letterBody(data, g, year, letterDateIso);
      g.html = wrapLetters([g.body], g.filename);
    }
    return groups;
  }

  const api = {
    defaultData, esc, parseMoney, fmtMoney, fmtDate, longDate, personName, sortName, joinNames, methodLabel,
    yearsWithGifts, statementText, buildLetterGroups, buildLetters, wrapLetters,
    DEFAULT_INTRO, DEFAULT_CLOSING, STATEMENT_INTANGIBLE, STATEMENT_NONE, CHURCH_DEFAULTS,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Logic = api;
})(typeof window !== 'undefined' ? window : globalThis);
