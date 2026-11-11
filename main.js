const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const DATA_FILE = () => path.join(app.getPath('userData'), 'donations.json');
const BACKUP_DIR = () => path.join(app.getPath('userData'), 'auto-backups');
const KEEP_BACKUPS = 30;

let mainWindow;

function readData() {
  const file = DATA_FILE();
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// Write to a temp file first, then rename, so a crash mid-save can't corrupt the data file.
function writeData(data) {
  const file = DATA_FILE();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

// One dated copy per day the app is opened; oldest copies beyond KEEP_BACKUPS are removed.
function autoBackup() {
  const file = DATA_FILE();
  if (!fs.existsSync(file)) return;
  const dir = BACKUP_DIR();
  fs.mkdirSync(dir, { recursive: true });
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const dest = path.join(dir, `donations-${stamp}.json`);
  if (!fs.existsSync(dest)) fs.copyFileSync(file, dest);
  const all = fs.readdirSync(dir).filter(f => /^donations-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  while (all.length > KEEP_BACKUPS) fs.unlinkSync(path.join(dir, all.shift()));
}

function safeName(s) {
  return String(s).replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120) || 'letter';
}

// One hidden window is reused for every letter in an export. Creating and destroying a window per
// letter sometimes made the next page load fail (ERR_FAILED), so loads are also retried.
async function htmlToPdf(html, win) {
  const tmp = path.join(os.tmpdir(), `letter-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);
  fs.writeFileSync(tmp, html, 'utf8');
  try {
    for (let attempt = 1; ; attempt++) {
      try { await win.loadFile(tmp); break; }
      catch (e) { if (attempt >= 3) throw e; await new Promise(r => setTimeout(r, 300 * attempt)); }
    }
    return await win.webContents.printToPDF({
      pageSize: 'Letter',
      printBackground: true,
      margins: { top: 0.9, bottom: 0.9, left: 1, right: 1 }, // inches
    });
  } finally {
    fs.unlink(tmp, () => {});
  }
}

// Letters longer than one page get a small "Name · 2026 giving statement · Page 2 of 3" line at the
// bottom of every page, so loose pages can be matched back up.
async function stampPages(pdfBytes, label) {
  const doc = await PDFDocument.load(pdfBytes);
  const pages = doc.getPages();
  if (pages.length > 1) {
    const font = await doc.embedFont(StandardFonts.TimesRoman);
    const safe = String(label || '').replace(/[^\x20-\x7e\xa0-\xff]/g, '?'); // standard fonts cover Latin-1 only
    pages.forEach((page, i) => {
      const text = `${safe} \u00b7 Page ${i + 1} of ${pages.length}`;
      const size = 8.5;
      const w = font.widthOfTextAtSize(text, size);
      page.drawText(text, { x: (page.getWidth() - w) / 2, y: 36, size, font, color: rgb(0.35, 0.35, 0.35) });
    });
  }
  return doc;
}

async function exportLetters(folder, payload) {
  const written = [];
  const used = new Set();
  const merged = payload.combined ? await PDFDocument.create() : null;
  const win = new BrowserWindow({ show: false, webPreferences: { javascript: false, sandbox: true } });
  try {
  for (const l of payload.letters) {
    const doc = await stampPages(await htmlToPdf(l.html, win), l.stamp);
    const bytes = await doc.save();
    if (payload.each) {
      let base = safeName(l.filename);
      let name = base;
      let n = 2;
      while (used.has(name.toLowerCase())) name = `${base} (${n++})`;
      used.add(name.toLowerCase());
      const out = path.join(folder, name + '.pdf');
      fs.writeFileSync(out, bytes);
      written.push(out);
    }
    if (merged) {
      const src = await PDFDocument.load(bytes);
      for (const p of await merged.copyPages(src, src.getPageIndices())) merged.addPage(p);
    }
  }
  } finally {
    win.destroy();
  }
  if (merged) {
    const out = path.join(folder, safeName(payload.combined.filename) + '.pdf');
    fs.writeFileSync(out, await merged.save());
    written.push(out);
  }
  return written;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    title: 'Church Donations',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

ipcMain.handle('data:load', () => readData());
ipcMain.handle('data:save', (_e, data) => { writeData(data); return true; });
ipcMain.handle('data:location', () => DATA_FILE());

ipcMain.handle('backup:export', async () => {
  const d = new Date().toISOString().slice(0, 10);
  const res = await dialog.showSaveDialog(mainWindow, {
    title: 'Save a backup copy',
    defaultPath: `church-donations-backup-${d}.json`,
    filters: [{ name: 'Backup file', extensions: ['json'] }],
  });
  if (res.canceled || !res.filePath) return null;
  fs.copyFileSync(DATA_FILE(), res.filePath);
  return res.filePath;
});

ipcMain.handle('backup:import', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Restore from a backup copy',
    properties: ['openFile'],
    filters: [{ name: 'Backup file', extensions: ['json'] }],
  });
  if (res.canceled || !res.filePaths[0]) return null;
  const data = JSON.parse(fs.readFileSync(res.filePaths[0], 'utf8'));
  for (const k of ['settings', 'funds', 'households', 'people', 'gifts']) {
    if (!(k in data)) throw new Error('That file is not a Church Donations backup.');
  }
  return data;
});

ipcMain.handle('logo:choose', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose a logo image',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg'] }],
  });
  if (res.canceled || !res.filePaths[0]) return null;
  const file = res.filePaths[0];
  const buf = fs.readFileSync(file);
  if (buf.length > 5 * 1024 * 1024) throw new Error('The image is larger than 5 MB.');
  const isPng = buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isJpg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  if (!isPng && !isJpg) throw new Error('That file is not a PNG or JPG image.');
  return `data:image/${isPng ? 'png' : 'jpeg'};base64,${buf.toString('base64')}`;
});

ipcMain.handle('letters:export', async (_e, payload) => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose a folder for the letters',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (res.canceled || !res.filePaths[0]) return null;
  const folder = res.filePaths[0];
  const written = await exportLetters(folder, payload);
  shell.openPath(folder);
  return { folder, count: written.length };
});

app.whenReady().then(async () => {
  if (process.env.CD_SMOKE) {
    // Test hook: run the scripted check in smoke.js and exit.
    await require(process.env.CD_SMOKE)({ app, BrowserWindow, exportLetters, createWindow, getWindow: () => mainWindow, DATA_FILE });
    return;
  }
  try { autoBackup(); } catch (e) { console.error('auto-backup failed', e); }
  createWindow();
});

app.on('window-all-closed', () => app.quit());
