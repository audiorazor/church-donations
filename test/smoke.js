const fs = require('fs'); const path = require('path');
const Logic = require('../renderer/logic.js');
module.exports = async ({ app, exportLetters, createWindow, getWindow, DATA_FILE }) => {
  const out = process.env.CD_OUT; fs.mkdirSync(out, { recursive: true });
  const d = Logic.defaultData();
  d.settings = { ...d.settings, churchName: 'Sample Community Church', address1: '100 Main Street', cityStateZip: 'Anytown, NJ 07000', phone: '(555) 010-0100', ein: '00-0000000', signerName: 'Pat Example', signerTitle: 'Treasurer' };
  d.funds.push({ id: 2, name: 'Building Fund', active: true }, { id: 3, name: 'Missions', active: true });
  d.households.push({ id: 10, name: 'John and Mary Sample', address1: '12 Oak Lane', address2: '', city: 'Anytown', state: 'NJ', zip: '07000' },
                    { id: 11, name: 'Alex Tester', address1: '', address2: '', city: '', state: '', zip: '' },
                    { id: 12, name: 'The Split Family', address1: '9 Elm St', address2: 'Apt 2', city: 'Anytown', state: 'NJ', zip: '07000' });
  d.people.push({ id: 20, householdId: 10, firstName: 'John', lastName: 'Sample', email: '', letterMode: 'household' },
                { id: 21, householdId: 10, firstName: 'Mary', lastName: 'Sample', email: '', letterMode: 'household' },
                { id: 22, householdId: 11, firstName: 'Alex', lastName: 'Tester', email: 'a@example.com', letterMode: 'individual' },
                { id: 23, householdId: 12, firstName: 'Sam', lastName: 'Split', email: '', letterMode: 'individual' },
                { id: 24, householdId: 12, firstName: 'Jo', lastName: 'Split', email: '', letterMode: 'individual' },
                { id: 25, householdId: 12, firstName: 'Nogift', lastName: 'Split', email: '', letterMode: 'individual' });
  let id = 100; const g = (personId, date, type, amount, fundId, extra = {}) => d.gifts.push({ id: id++, personId, date, type, amount, fundId, checkNo: '', description: '', note: '', ...extra });
  for (let w = 0; w < 52; w++) { const dt = new Date(Date.UTC(2026, 0, 4 + 7 * w)).toISOString().slice(0, 10); g(20, dt, 'check', 10000, 1, { checkNo: String(2000 + w) }); }
  g(21, '2026-03-15', 'cash', 2550, 3); g(21, '2026-06-01', 'check', 50000, 2, { checkNo: '881' });
  g(21, '2026-09-09', 'noncash', 0, null, { description: 'Yamaha upright piano' });
  g(22, '2026-05-05', 'other', 123456, 1); g(22, '2025-12-28', 'cash', 99900, 1);
  g(23, '2026-02-02', 'cash', 4000, 1); g(24, '2026-02-02', 'cash', 6000, 2);
  d.nextId = 1000;
  fs.mkdirSync(path.dirname(DATA_FILE()), { recursive: true }); fs.writeFileSync(DATA_FILE(), JSON.stringify(d));
  createWindow(); const win = getWindow(); const wc = win.webContents; const errs = [];
  wc.on('console-message', (_e, level, msg) => { if (level >= 2) errs.push(msg); });
  await new Promise(r => wc.once('did-finish-load', r)); const wait = ms => new Promise(r => setTimeout(r, ms)); await wait(600);
  const js = c => wc.executeJavaScript(c, true);
  const shot = async n => fs.writeFileSync(path.join(out, n + '.png'), (await wc.capturePage()).toPNG());
  // add a gift through the real form
  await js(`(()=>{const f=document.getElementById('giftForm');f.date.value='2026-11-08';f.personId.value='24';f.type.value='check';f.checkNo.value='55';f.amount.value='1,250.5';f.fundId.value='3';f.requestSubmit();})()`);
  await wait(400); await shot('gifts');
  // invalid amount must be rejected
  await js(`(()=>{const f=document.getElementById('giftForm');f.personId.value='24';f.amount.value='-5';f.requestSubmit();})()`); await wait(200);
  for (const p of ['donors', 'funds', 'settings', 'letters']) { await js(`document.querySelector('[data-page=${p}]').click()`); await wait(700); await shot(p); }
  const groups = await js(`Logic.buildLetters(data, '2026', '2027-01-15').map(l=>({key:l.key,kind:l.kind,addressee:l.addressee,total:l.total,n:l.gifts.length,filename:l.filename,html:l.html,body:l.body}))`);
  await wait(400);
  const saved = JSON.parse(fs.readFileSync(DATA_FILE(), 'utf8'));
  const summary = { errs, giftCount: saved.gifts.length, newGift: saved.gifts.find(x => x.checkNo === '55'), letters: groups.map(({ html, body, ...r }) => r) };
  const pdfDir = path.join(out, 'pdf'); fs.mkdirSync(pdfDir, { recursive: true });
  const written = await exportLetters(pdfDir, { letters: groups.map(l => ({ filename: l.filename, html: l.html })), combined: { filename: '2026 Giving Letters - ALL (for printing)', html: Logic.wrapLetters(groups.map(l => l.body), 'all') } });
  summary.written = written.map(w => path.basename(w));
  fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2));
  app.exit(0);
};
