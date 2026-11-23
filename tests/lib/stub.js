// Заглушка electron, чтобы модули главного процесса можно было проверять обычным node без окна
const Module = require('module');
const os = require('os');
const fs = require('fs');
const path = require('path');

function install(dir) {
	const tmp = dir || fs.mkdtempSync(path.join(os.tmpdir(), 'problet-stub-'));
	const noop = () => {};
	const handler = { get: (t, k) => (k in t ? t[k] : new Proxy(function () {}, handler)), apply: () => new Proxy(function () {}, handler), construct: () => new Proxy({}, handler) };
	const stub = new Proxy({
		app: new Proxy({ isPackaged: false, getPath: () => tmp, getVersion: () => '9.0.0', getLocale: () => 'ru', isReady: () => false, whenReady: () => new Promise(noop), on: noop, getName: () => 'Problet' }, handler),
		ipcMain: { on: noop, handle: noop, removeHandler: noop },
	}, handler);
	const orig = Module._load;
	Module._load = function (req, ...a) {
		return req === 'electron' ? stub : orig.call(this, req, ...a);
	};
	return tmp;
}

// Свежая копия модуля (без кеша require), чтобы каждый сценарий начинался с чистого состояния
function fresh(file) {
	const root = path.join(__dirname, '..', '..');
	for (const k of Object.keys(require.cache)) if (k.startsWith(root) && !k.includes('node_modules') && !k.includes(path.sep + 'tests' + path.sep)) delete require.cache[k];
	return require(path.join(root, file));
}

module.exports = { install, fresh };
