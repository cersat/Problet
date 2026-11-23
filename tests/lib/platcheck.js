// Загружает модули главного процесса так, будто Problet запущен на другой системе (process.platform подменён, electron — заглушка).
// node tests/lib/platcheck.js win32|darwin|linux — печатает JSON { mods, errors: [{ mod, error }] }
const path = require('path');
const fs = require('fs');
const plat = process.argv[2];
Object.defineProperty(process, 'platform', { value: plat });
const Module = require('module');
const orig = Module._load;
const noop = () => {};
const handler = { get: (t, k) => (k in t ? t[k] : new Proxy(function () {}, handler)), apply: () => new Proxy(function () {}, handler), construct: () => new Proxy({}, handler) };
const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'platcheck-'));
const stub = new Proxy({
	app: new Proxy({ isPackaged: true, getPath: () => tmp, getVersion: () => '0.0.0', getLocale: () => 'ru', isReady: () => false, whenReady: () => new Promise(noop), on: noop, getName: () => 'Problet' }, handler),
	ipcMain: { on: noop, handle: noop, removeHandler: noop },
}, handler);
Module._load = function (req, ...a) { return req === 'electron' ? stub : orig.call(this, req, ...a); };
const dir = path.join(__dirname, '..', '..');
const skip = new Set(['main.js', 'boot.js', 'eslint.config.js', 'renderer.js', 'popup.js', 'find.js', 'error.js']);
const mods = fs.readdirSync(dir).filter((f) => f.endsWith('.js') && !skip.has(f) && !/^preload/.test(f));
const errors = [];
for (const m of mods) {
	try {
		require(path.join(dir, m));
	} catch (e) {
		errors.push({ mod: m, error: String(e.stack).split('\n').slice(0, 2).join(' | ') });
	}
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(JSON.stringify({ mods: mods.length, errors }));
