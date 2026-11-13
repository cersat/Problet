// Аддоны Problet: свой формат расширений (addon.json), свой API и разрешения.
// Аддон живёт в папке userData/addons/<id>: addon.json и файлы рядом с ним. Страницы аддона открываются по адресам problet-addon://<id>/…
// Фоновый скрипт работает в скрытой странице без доступа к Node, всё опасное делает главный процесс по запросу и только с разрешения.

const { app, net, dialog, Notification, clipboard, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { pathToFileURL } = require('url');
const childProcess = require('child_process');
const extensions = require('./extensions');

const SCHEME = 'problet-addon';
const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const CATALOG = 'https://raw.githubusercontent.com/cersat/ProbletAddons/main/';
const MAX_FILE = 20 * 1024 * 1024;
const MAX_TOTAL = 60 * 1024 * 1024;
const MAX_FILES = 300;
const STORAGE_LIMIT = 5 * 1024 * 1024;

// Разрешения. ask — спрашиваем человека при первом использовании; every — спрашиваем при каждом действии (можно разрешить навсегда)
const PERMS = {
	storage: { label: 'хранить свои данные' },
	notifications: { label: 'показывать уведомления' },
	tabs: { label: 'видеть адреса и названия вкладок, открывать и закрывать вкладки' },
	pages: { label: 'выполнять свой код на любой открытой странице', ask: true },
	network: { label: 'обращаться к любым сайтам в обход ограничений браузера', ask: true },
	bookmarks: { label: 'читать и добавлять закладки', ask: true },
	history: { label: 'читать историю посещений', ask: true },
	clipboard: { label: 'читать и менять буфер обмена', ask: true },
	files: { label: 'читать и записывать файлы на компьютере', ask: true, every: true },
	exec: { label: 'запускать программы и команды на компьютере', ask: true, every: true },
};

let dir = '';
let ctx = null; // функции главного процесса: вкладки, окно, раскладка

// Переводы названия и описания: "locales": { "en": { "name", "description", "buttonTitle" } } в addon.json (и в записи каталога)
function cleanLocales(v) {
	const out = {};
	if (!v || typeof v !== 'object') return out;
	for (const [k, x] of Object.entries(v)) {
		if (!/^[a-z]{2}$/.test(k) || !x || typeof x !== 'object') continue;
		out[k] = { name: str(x.name, 60).trim(), description: str(x.description, 300), buttonTitle: str(x.buttonTitle, 80) };
	}
	return out;
}
const curLang = () => (ctx && ctx.lang ? ctx.lang() : 'ru');
// Поле с учётом языка интерфейса; если перевода нет, остаётся исходный текст аддона
function loc(m, field) {
	const l = curLang() !== 'ru' && m.locales && m.locales[curLang()];
	if (l && l[field]) return l[field];
	return field === 'buttonTitle' ? m.button && m.button.title : m[field];
}
let state = {}; // id -> { granted: { perm: 'always' | 'denied' }, source }
const addons = new Map(); // id -> { id, dir, manifest, error, world, bg }
const storageCache = new Map();
const pendingReplies = new Map();
let nextReq = 1;

// ---------- Проверка addon.json ----------

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const isIconFile = (p) => typeof p === 'string' && /\.(svg|png)$/i.test(p);
const isRel = (p) => typeof p === 'string' && p.length > 0 && p.length < 200 && !p.startsWith('/') && !p.includes('\\') && !p.split('/').includes('..') && !/^[a-z]+:/i.test(p);

function validate(m) {
	if (!m || typeof m !== 'object' || Array.isArray(m)) throw new Error('addon.json: ожидается объект');
	if (!ID_RE.test(m.id || '')) throw new Error('addon.json: id — латинские буквы, цифры и дефис, до 40 символов');
	if (!str(m.name, 60).trim()) throw new Error('addon.json: нет названия (name)');
	const out = {
		id: m.id,
		name: str(m.name, 60).trim(),
		version: str(m.version, 20) || '1.0',
		description: str(m.description, 300),
		locales: cleanLocales(m.locales),
		icon: '',
		permissions: [],
		content: [],
		background: '',
		button: null,
		options: '',
		files: [],
	};
	if (typeof m.icon === 'string') {
		if (isRel(m.icon) && isIconFile(m.icon)) out.icon = m.icon;
		else if ([...m.icon].length <= 4) out.icon = m.icon;
	}
	for (const p of Array.isArray(m.permissions) ? m.permissions : []) {
		if (!Object.hasOwn(PERMS, p)) throw new Error('addon.json: неизвестное разрешение «' + p + '»');
		if (!out.permissions.includes(p)) out.permissions.push(p);
	}
	for (const c of Array.isArray(m.content) ? m.content.slice(0, 20) : []) {
		const matches = (Array.isArray(c.matches) ? c.matches : []).filter((x) => typeof x === 'string' && x.length < 300).slice(0, 50);
		const js = (Array.isArray(c.js) ? c.js : []).filter(isRel);
		const css = (Array.isArray(c.css) ? c.css : []).filter(isRel);
		if (!matches.length || (!js.length && !css.length)) throw new Error('addon.json: в content нужны matches и js или css');
		for (const p of matches) matcher(p); // бросит ошибку на неверном шаблоне
		out.content.push({ matches, js, css, runAt: ['start', 'end', 'idle'].includes(c.runAt) ? c.runAt : 'end' });
	}
	if (m.background !== undefined) {
		if (!isRel(m.background) || !/\.js$/.test(m.background)) throw new Error('addon.json: background — путь к .js файлу');
		out.background = m.background;
	}
	if (m.button && typeof m.button === 'object') {
		out.button = { title: str(m.button.title, 80) || out.name, popup: '' };
		if (m.button.popup !== undefined) {
			if (!isRel(m.button.popup) || !/\.html?$/.test(m.button.popup)) throw new Error('addon.json: button.popup — путь к .html файлу');
			out.button.popup = m.button.popup;
		}
		if (!out.button.popup && !out.background) throw new Error('addon.json: кнопке без popup нужен background, который обработает нажатие');
	}
	if (m.options !== undefined) {
		if (!isRel(m.options) || !/\.html?$/.test(m.options)) throw new Error('addon.json: options — путь к .html файлу');
		out.options = m.options;
	}
	for (const f of Array.isArray(m.files) ? m.files : []) if (isRel(f)) out.files.push(f);
	if (!out.content.length && !out.background && !out.button && !out.options) throw new Error('addon.json: аддон ничего не делает — нужен content, background, button или options');
	return out;
}

// Файлы, которые надо скачать вместе с addon.json
function fileList(m) {
	const set = new Set(m.files);
	for (const c of m.content) [...c.js, ...c.css].forEach((f) => set.add(f));
	if (m.background) set.add(m.background);
	if (m.button && m.button.popup) set.add(m.button.popup);
	if (m.options) set.add(m.options);
	if (isIconFile(m.icon)) set.add(m.icon);
	return [...set];
}

// Шаблон адресов как у расширений Chrome: <all_urls>, *://*.example.com/*, https://site.ru/path*
function matcher(p) {
	if (p === '<all_urls>') return (u) => /^(https?|file):/.test(u.protocol);
	const m = /^(\*|https?|file):\/\/(\*|\*\.[^/*]+|[^/*]*)(\/.*)$/.exec(p);
	if (!m) throw new Error('addon.json: неверный шаблон адреса «' + p + '»');
	const [, scheme, host, rest] = m;
	const esc = (s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
	const pathRe = new RegExp('^' + rest.split('*').map(esc).join('.*') + '$');
	return (u) => {
		const proto = u.protocol.slice(0, -1);
		if (scheme === '*' ? !/^https?$/.test(proto) : proto !== scheme) return false;
		if (host !== '*' && host !== '') {
			if (host.startsWith('*.')) {
				const base = host.slice(2);
				if (u.hostname !== base && !u.hostname.endsWith('.' + base)) return false;
			} else if (u.hostname !== host) return false;
		}
		return pathRe.test(u.pathname + u.search);
	};
}

// ---------- Состояние на диске ----------

const stateFile = () => path.join(dir, 'state.json');
function saveState() {
	try {
		fs.writeFileSync(stateFile(), JSON.stringify(state));
	} catch (e) { /* разрешения спросят ещё раз */ }
}
function stateOf(id) {
	if (!state[id] || typeof state[id] !== 'object') state[id] = {};
	if (!state[id].granted || typeof state[id].granted !== 'object') state[id].granted = {};
	return state[id];
}

function load(id) {
	const d = path.join(dir, id);
	const a = { id, dir: d, manifest: null, error: '', world: 0, bg: null };
	try {
		const m = validate(JSON.parse(fs.readFileSync(path.join(d, 'addon.json'), 'utf8')));
		if (m.id !== id) throw new Error('id в addon.json не совпадает с папкой');
		a.manifest = m;
	} catch (e) {
		a.error = e.message;
	}
	return a;
}

function assignWorlds() {
	let n = 0;
	for (const a of [...addons.values()].sort((x, y) => x.id.localeCompare(y.id))) a.world = 1001 + n++;
}

function init(userData, context) {
	dir = path.join(userData, 'addons');
	ctx = context;
	fs.mkdirSync(dir, { recursive: true });
	fs.mkdirSync(path.join(userData, 'addon-data'), { recursive: true });
	try {
		state = JSON.parse(fs.readFileSync(stateFile(), 'utf8')) || {};
	} catch (e) {
		state = {};
	}
	for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
		if (d.isDirectory() && ID_RE.test(d.name)) addons.set(d.name, load(d.name));
	}
	assignWorlds();
	for (const a of addons.values()) startBackground(a);
}

// ---------- Страницы аддонов: problet-addon://<id>/<путь> ----------

function handler(request) {
	const u = new URL(request.url);
	const a = addons.get(u.hostname);
	if (!a || !a.manifest) return new Response('Аддон не найден', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
	const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '');
	if (rel === '_background.html') {
		const html = '<!doctype html><meta charset="utf-8"><title>' + a.manifest.name.replace(/</g, '&lt;') + '</title><script src="/' + a.manifest.background.split('/').map(encodeURIComponent).join('/') + '"></script>';
		return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
	}
	const file = path.resolve(a.dir, rel);
	if (!file.startsWith(a.dir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return new Response('Нет такого файла', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
	return net.fetch(pathToFileURL(file).toString());
}

function pageUrl(id, kind) {
	const a = addons.get(id);
	if (!a || !a.manifest) return '';
	const p = kind === 'popup' ? a.manifest.button && a.manifest.button.popup : a.manifest.options;
	return p ? SCHEME + '://' + id + '/' + p : '';
}

// ---------- Фоновый скрипт ----------

function startBackground(a) {
	if (!a.manifest || !a.manifest.background || a.bg) return;
	const { WebContentsView } = require('electron');
	const view = new WebContentsView({ webPreferences: { preload: path.join(__dirname, 'preload-page.js'), contextIsolation: true, sandbox: true, backgroundThrottling: false } });
	a.bg = view;
	const wc = view.webContents;
	wc.on('console-message', (e) => {
		if (e.level === 'error' || e.level === 'warning') ctx.log('аддон', a.id, e.level, e.message);
	});
	wc.on('render-process-gone', (_e, d) => {
		ctx.log('фон аддона упал', a.id, d.reason);
		a.bg = null;
	});
	wc.loadURL(SCHEME + '://' + a.id + '/_background.html').catch((e) => ctx.log('фон аддона не загрузился', a.id, e.message));
}

function stopBackground(a) {
	if (!a.bg) return;
	const wc = a.bg.webContents;
	a.bg = null;
	if (wc && !wc.isDestroyed()) wc.close();
}

// Событие в фон всех аддонов (или одного)
function emit(name, data, only) {
	for (const a of addons.values()) {
		if (only && a.id !== only) continue;
		if (!a.bg || a.bg.webContents.isDestroyed()) continue;
		if (name.startsWith('tab') && !a.manifest.permissions.includes('tabs')) continue;
		a.bg.webContents.send('addon:event', name, data, 0);
	}
}

// Сообщение в фон с ожиданием ответа обработчика
function request(a, name, data) {
	if (!a.bg || a.bg.webContents.isDestroyed()) return Promise.resolve(undefined);
	const id = nextReq++;
	return new Promise((resolve) => {
		const timer = setTimeout(() => {
			pendingReplies.delete(id);
			resolve(undefined);
		}, 30000);
		pendingReplies.set(id, (v) => {
			clearTimeout(timer);
			resolve(v);
		});
		a.bg.webContents.send('addon:event', name, data, id);
	});
}
function reply(sender, id, value) {
	const a = byContents(sender);
	const fn = pendingReplies.get(id);
	if (!a || !fn) return;
	pendingReplies.delete(id);
	fn(value);
}

// Кто зовёт API: фон аддона или его страница (окошко кнопки, настройки)
function byContents(wc) {
	for (const a of addons.values()) if (a.bg && a.bg.webContents === wc) return a;
	try {
		const u = new URL(wc.getURL());
		if (u.protocol === SCHEME + ':') {
			const a = addons.get(u.hostname);
			if (a && a.manifest) return a;
		}
	} catch (e) { /* не аддон */ }
	return null;
}

// ---------- Разрешения ----------

const asking = new Map(); // id -> цепочка вопросов, чтобы окна не налезали друг на друга

async function ask(a, title, detail, canAlways) {
	if (process.env.PROBLET_TEST_ADDON_ANSWER) return process.env.PROBLET_TEST_ADDON_ANSWER; // ответ для автотестов: once | always | deny
	const buttons = canAlways ? ['Разрешить один раз', 'Разрешать всегда', 'Запретить'] : ['Разрешить', 'Запретить'];
	const r = await dialog.showMessageBox(ctx.window(), { type: 'warning', title: 'Разрешение для аддона', message: 'Аддон «' + loc(a.manifest, 'name') + '» хочет ' + title, detail, buttons, defaultId: buttons.length - 1, cancelId: buttons.length - 1, noLink: true });
	if (canAlways) return ['once', 'always', 'deny'][r.response];
	return r.response === 0 ? 'always' : 'deny';
}

async function need(a, perm, detail) {
	if (!a.manifest.permissions.includes(perm)) throw new Error('Аддон не заявил разрешение «' + perm + '» в addon.json');
	const p = PERMS[perm];
	if (!p.ask) return;
	const st = stateOf(a.id);
	if (st.granted[perm] === 'always') return;
	if (st.granted[perm] === 'denied') throw new Error('Разрешение «' + perm + '» запрещено. Его можно сбросить в настройках расширений');
	const prev = asking.get(a.id) || Promise.resolve();
	const next = prev.catch(() => {}).then(async () => {
		if (st.granted[perm] === 'always') return;
		const ans = await ask(a, p.label + '.', detail || '', !!p.every);
		if (ans === 'deny') {
			if (!p.every) {
				st.granted[perm] = 'denied';
				saveState();
			}
			throw new Error('Человек не разрешил: ' + p.label);
		}
		if (ans === 'always') {
			st.granted[perm] = 'always';
			saveState();
		}
	});
	asking.set(a.id, next);
	return next;
}

// ---------- Хранилище аддона ----------

const storageFile = (id) => path.join(path.dirname(dir), 'addon-data', id + '.json'); // данные отдельно от папок аддонов: обновление аддона их не стирает
function storageOf(id) {
	if (!storageCache.has(id)) {
		let v = {};
		try {
			v = JSON.parse(fs.readFileSync(storageFile(id), 'utf8')) || {};
		} catch (e) { /* пустое */ }
		storageCache.set(id, v);
	}
	return storageCache.get(id);
}
function storageSave(id) {
	const text = JSON.stringify(storageOf(id));
	if (text.length > STORAGE_LIMIT) throw new Error('Данных аддона больше 5 МБ');
	fs.writeFileSync(storageFile(id), text);
}

// ---------- API ----------

const tabInfo = (t) => ({ id: t.id, url: t.url, title: t.title, active: t.active, incognito: t.incognito });
const userTab = (id) => {
	const t = ctx.tabs().find((x) => x.id === id && !x.incognito);
	if (!t) throw new Error('Нет такой вкладки');
	return t;
};
const webUrl = (url) => {
	const u = new URL(String(url));
	if (!/^(https?|file|data):$/.test(u.protocol) && !(u.protocol === 'problet:') && !(u.protocol === SCHEME + ':')) throw new Error('Неподходящий адрес');
	return u.href;
};

function bytesOf(data, enc) {
	if (enc === 'base64') return Buffer.from(String(data), 'base64');
	return Buffer.from(String(data), 'utf8');
}

const API = {
	info: (a) => ({ id: a.id, name: a.manifest.name, version: a.manifest.version, permissions: a.manifest.permissions, problet: app.getVersion(), platform: process.platform }),

	'storage.get': async (a, key) => {
		await need(a, 'storage');
		const s = storageOf(a.id);
		return key === undefined ? JSON.parse(JSON.stringify(s)) : s[String(key)];
	},
	'storage.set': async (a, key, value) => {
		await need(a, 'storage');
		const s = storageOf(a.id);
		s[String(key)] = value === undefined ? null : JSON.parse(JSON.stringify(value));
		storageSave(a.id);
	},
	'storage.remove': async (a, key) => {
		await need(a, 'storage');
		delete storageOf(a.id)[String(key)];
		storageSave(a.id);
	},

	notify: async (a, title, body) => {
		await need(a, 'notifications');
		if (Notification.isSupported()) new Notification({ title: String(title || a.manifest.name).slice(0, 200), body: String(body || '').slice(0, 1000) }).show();
	},

	'tabs.list': async (a) => {
		await need(a, 'tabs');
		return ctx.tabs().filter((t) => !t.incognito).map(tabInfo);
	},
	'tabs.active': async (a) => {
		await need(a, 'tabs');
		const t = ctx.tabs().find((x) => x.active);
		return t && !t.incognito ? tabInfo(t) : null;
	},
	'tabs.open': async (a, url, opts) => {
		await need(a, 'tabs');
		return ctx.openTab(webUrl(url), !(opts && opts.active === false));
	},
	'tabs.close': async (a, id) => {
		await need(a, 'tabs');
		ctx.closeTab(userTab(id).id);
	},
	'tabs.activate': async (a, id) => {
		await need(a, 'tabs');
		ctx.activateTab(userTab(id).id);
	},
	'tabs.navigate': async (a, id, url) => {
		await need(a, 'tabs');
		ctx.contents(userTab(id).id).loadURL(webUrl(url)).catch(() => {});
	},
	'tabs.reload': async (a, id) => {
		await need(a, 'tabs');
		ctx.contents(userTab(id).id).reload();
	},
	'tabs.eval': async (a, id, code) => {
		await need(a, 'tabs');
		const t = userTab(id);
		if (!/^(https?|file|data):/.test(t.url)) throw new Error('На этой странице выполнять код нельзя');
		await need(a, 'pages', 'Код будет выполнен на странице ' + t.url);
		return ctx.contents(t.id).executeJavaScript(String(code), true);
	},
	'tabs.send': async (a, id, msg) => {
		await need(a, 'tabs');
		const wc = ctx.contents(userTab(id).id);
		wc.send('addon:to-content', a.id, JSON.parse(JSON.stringify(msg === undefined ? null : msg)));
	},

	fetch: async (a, url, opts = {}) => {
		const u = new URL(String(url));
		if (!/^https?:$/.test(u.protocol)) throw new Error('Только http и https');
		await need(a, 'network', 'Адрес: ' + u.origin);
		const res = await net.fetch(u.href, { method: String(opts.method || 'GET'), headers: opts.headers || {}, body: opts.body === undefined ? undefined : String(opts.body), bypassCustomProtocolHandlers: true });
		const buf = Buffer.from(await res.arrayBuffer());
		if (buf.length > MAX_TOTAL) throw new Error('Ответ слишком большой');
		const headers = {};
		res.headers.forEach((v, k) => { headers[k] = v; });
		return { status: res.status, ok: res.ok, url: res.url, headers, text: opts.as === 'base64' ? '' : buf.toString('utf8'), base64: opts.as === 'base64' ? buf.toString('base64') : '' };
	},

	'bookmarks.list': async (a) => {
		await need(a, 'bookmarks');
		const s = ctx.store.bookmarksState();
		return { bookmarks: s.bookmarks.map((b) => ({ id: b.id, title: b.title, url: b.url, folder: b.folder || '' })), folders: s.folders.map((f) => ({ id: f.id, name: f.name })) };
	},
	'bookmarks.add': async (a, b) => {
		await need(a, 'bookmarks');
		const bm = ctx.store.addBookmark({ title: String((b && b.title) || ''), url: String((b && b.url) || '') });
		ctx.changed();
		return bm && bm.id;
	},
	'history.list': async (a, limit) => {
		await need(a, 'history');
		return ctx.store.visitsList().slice(0, Math.min(5000, Number(limit) || 500)).map((v) => ({ url: v.url, title: v.title, time: v.time }));
	},
	'clipboard.read': async (a) => {
		await need(a, 'clipboard');
		return clipboard.readText();
	},
	'clipboard.write': async (a, text) => {
		await need(a, 'clipboard');
		clipboard.writeText(String(text));
	},

	'files.pick': async (a, opts = {}) => {
		if (!a.manifest.permissions.includes('files')) throw new Error('Аддон не заявил разрешение «files» в addon.json');
		if (process.env.PROBLET_TEST_PICK) { // автотесты: вместо окна выбора — файл в заданной папке
			const p = path.join(process.env.PROBLET_TEST_PICK, path.basename(String(opts.name || 'file')));
			picked(a).add(p);
			return p;
		}
		const w = ctx.window();
		const r = opts.save
			? await dialog.showSaveDialog(w, { title: 'Аддон «' + loc(a.manifest, 'name') + '»: куда сохранить', defaultPath: opts.name ? String(opts.name) : undefined })
			: await dialog.showOpenDialog(w, { title: 'Аддон «' + loc(a.manifest, 'name') + '»: выбери файл', properties: [opts.folder ? 'openDirectory' : 'openFile'] });
		const p = opts.save ? r.filePath : r.filePaths && r.filePaths[0];
		if (r.canceled || !p) return null;
		picked(a).add(path.resolve(p)); // выбранный человеком файл не требует отдельного вопроса
		return p;
	},
	'files.read': async (a, p, enc) => {
		p = path.resolve(String(p));
		if (!picked(a).has(p)) await need(a, 'files', 'Чтение: ' + p);
		const st = await fs.promises.stat(p);
		if (st.size > MAX_TOTAL) throw new Error('Файл слишком большой');
		const buf = await fs.promises.readFile(p);
		return enc === 'base64' ? buf.toString('base64') : buf.toString('utf8');
	},
	'files.write': async (a, p, data, enc) => {
		p = path.resolve(String(p));
		if (!picked(a).has(p)) await need(a, 'files', 'Запись: ' + p);
		await fs.promises.writeFile(p, bytesOf(data, enc));
	},
	'files.list': async (a, p) => {
		p = path.resolve(String(p || os.homedir()));
		if (!picked(a).has(p)) await need(a, 'files', 'Список файлов в папке: ' + p);
		const out = [];
		for (const d of await fs.promises.readdir(p, { withFileTypes: true })) out.push({ name: d.name, dir: d.isDirectory(), path: path.join(p, d.name) });
		return out;
	},
	'files.reveal': async (a, p) => {
		p = path.resolve(String(p));
		if (!picked(a).has(p)) await need(a, 'files', 'Показать в файловом менеджере: ' + p);
		shell.showItemInFolder(p);
	},

	exec: async (a, cmd, args, opts = {}) => {
		const line = Array.isArray(args) ? [String(cmd), ...args.map(String)].join(' ') : String(cmd);
		await need(a, 'exec', 'Команда: ' + line + (opts.cwd ? '\nПапка: ' + opts.cwd : ''));
		return new Promise((resolve) => {
			const o = { cwd: opts.cwd ? String(opts.cwd) : os.homedir(), timeout: Math.min(600000, Number(opts.timeout) || 60000), maxBuffer: 10 * 1024 * 1024, windowsHide: true, encoding: 'buffer' };
			const done = (err, stdout, stderr) => resolve({ code: err ? (typeof err.code === 'number' ? err.code : -1) : 0, stdout: decodeOut(stdout), stderr: decodeOut(stderr) + (err && typeof err.code !== 'number' ? err.message : '') });
			if (Array.isArray(args)) childProcess.execFile(String(cmd), args.map(String), o, done);
			else if (process.platform === 'win32') {
				// cmd.exe в канал пишет в кодировке ANSI, и кириллица превращается в «?». С /u его собственные команды (echo, dir) пишут UTF-16, а chcp 65001 просит UTF-8 у остальных программ
				childProcess.execFile(process.env.ComSpec || 'cmd.exe', ['/d', '/u', '/s', '/c', '"chcp 65001 >nul & ' + String(cmd) + '"'], { ...o, windowsVerbatimArguments: true }, done);
			} else childProcess.exec(String(cmd), o, done);
		});
	},

	'button.setTitle': async (a, title) => {
		if (!a.manifest.button) throw new Error('У аддона нет кнопки');
		a.manifest.button.title = String(title || a.manifest.name).slice(0, 80);
		a.manifest.button.custom = true; // название задано самим аддоном: перевод не подменяет его
		ctx.buttonsChanged();
	},
	'options.open': async (a) => {
		const u = pageUrl(a.id, 'options');
		if (!u) throw new Error('У аддона нет страницы настроек');
		ctx.openTab(u, true);
	},
};

// Вывод команды: UTF-16 (так пишет cmd.exe /u) или UTF-8
function decodeOut(buf) {
	if (!buf || !buf.length) return '';
	if (typeof buf === 'string') return buf;
	// В UTF-16 у латиницы и кириллицы старший байт каждого знака — 0…8, в обычном тексте такие байты не встречаются
	let low = 0;
	const n = Math.min(buf.length, 400);
	for (let i = 1; i < n; i += 2) if (buf[i] <= 8) low++;
	if (buf.length % 2 === 0 && low > n / 2 * 0.5) return buf.toString('utf16le');
	return buf.toString('utf8');
}

const pickedPaths = new Map();
const picked = (a) => {
	if (!pickedPaths.has(a.id)) pickedPaths.set(a.id, new Set());
	return pickedPaths.get(a.id);
};

async function call(sender, method, args) {
	const a = byContents(sender);
	if (!a) throw new Error('Доступ запрещён');
	const fn = Object.hasOwn(API, method) ? API[method] : null;
	if (!fn) throw new Error('Нет такого метода: ' + method);
	return fn(a, ...(Array.isArray(args) ? args : []));
}

// ---------- Скрипты на страницах ----------

// Что вставить в страницу по этому адресу (спрашивает прелоад вкладки при каждой загрузке)
function contentFor(url) {
	let u;
	try {
		u = new URL(url);
	} catch (e) {
		return [];
	}
	const out = [];
	for (const a of addons.values()) {
		if (!a.manifest) continue;
		const css = [];
		const at = { start: [], end: [], idle: [] };
		for (const c of a.manifest.content) {
			if (!c.matches.some((p) => matcher(p)(u))) continue;
			for (const f of c.js) {
				try {
					at[c.runAt].push({ code: fs.readFileSync(path.join(a.dir, f), 'utf8') + '\n//# sourceURL=' + SCHEME + '://' + a.id + '/' + f });
				} catch (e) { /* файла нет */ }
			}
			for (const f of c.css) {
				try {
					css.push(fs.readFileSync(path.join(a.dir, f), 'utf8'));
				} catch (e) { /* файла нет */ }
			}
		}
		if (at.start.length || at.end.length || at.idle.length || css.length) out.push({ id: a.id, world: a.world, css, js: at, storage: a.manifest.permissions.includes('storage') });
	}
	return out;
}

// Скрипт на странице пишет своему фону
async function fromContent(sender, id, kind, args, tab) {
	const a = addons.get(id);
	if (!a || !a.manifest || !tab || tab.incognito) throw new Error('Доступ запрещён');
	let u;
	try {
		u = new URL(sender.getURL());
	} catch (e) {
		throw new Error('Доступ запрещён');
	}
	if (!a.manifest.content.some((c) => c.matches.some((p) => matcher(p)(u)))) throw new Error('Доступ запрещён');
	if (kind === 'send') return request(a, 'message', { message: args[0], tab: { id: tab.id, url: tab.url, title: tab.title } });
	if (kind === 'storage.get' || kind === 'storage.set') return API[kind](a, ...args);
	throw new Error('Нет такого метода');
}

// ---------- Кнопки на панели ----------

function iconData(a) {
	const m = a.manifest;
	if (!m.icon) return { icon: '', letter: '' };
	if (!isIconFile(m.icon)) return { icon: '', letter: m.icon };
	try {
		const buf = fs.readFileSync(path.join(a.dir, m.icon));
		return { icon: 'data:' + (/\.svg$/i.test(m.icon) ? 'image/svg+xml' : 'image/png') + ';base64,' + buf.toString('base64'), letter: '' };
	} catch (e) {
		return { icon: '', letter: '' };
	}
}

function actions() {
	const out = [];
	for (const a of addons.values()) {
		if (!a.manifest || !a.manifest.button) continue;
		out.push({ id: '@' + a.id, name: loc(a.manifest, 'name'), title: a.manifest.button.custom ? a.manifest.button.title : loc(a.manifest, 'buttonTitle'), popup: !!a.manifest.button.popup, ...iconData(a) });
	}
	return out;
}

function click(id) {
	const a = addons.get(id);
	if (a && a.manifest && a.manifest.button) emit('buttonClick', {}, a.id);
}

// ---------- Список для настроек ----------

function list() {
	return [...addons.values()].map((a) => {
		const m = a.manifest;
		const granted = Object.entries(stateOf(a.id).granted).map(([perm, v]) => ({ perm, label: PERMS[perm] ? PERMS[perm].label : perm, allowed: v === 'always' }));
		return {
			id: '@' + a.id,
			addon: true,
			name: m ? loc(m, 'name') : a.id,
			version: m ? m.version : '',
			description: m ? loc(m, 'description') : '',
			icon: m ? iconData(a) : { icon: '', letter: '' },
			path: a.dir,
			error: a.error,
			permissions: m ? m.permissions.map((p) => PERMS[p].label) : [],
			granted,
			options: !!(m && m.options),
		};
	});
}

// ---------- Установка ----------

function describe(m, from) {
	const lines = [];
	if (loc(m, 'description')) lines.push(loc(m, 'description'), '');
	if (from) lines.push('Источник: ' + from, '');
	const perms = m.permissions.map((p) => '• ' + PERMS[p].label + (PERMS[p].ask ? ' (спросит отдельно)' : ''));
	const sites = [...new Set(m.content.flatMap((c) => c.matches))].map((s) => (s === '<all_urls>' || s === '*://*/*' ? 'все сайты' : s));
	if (sites.length) perms.unshift('• менять страницы: ' + sites.join(', '));
	lines.push(perms.length ? 'Аддон сможет:\n' + perms.join('\n') : 'Аддону не нужны особые разрешения.');
	return lines.join('\n');
}

async function confirmInstall(m, from) {
	if (process.env.PROBLET_TEST_ADDON_ANSWER) return process.env.PROBLET_TEST_ADDON_ANSWER !== 'deny';
	const old = addons.get(m.id);
	const r = await dialog.showMessageBox(ctx.window(), { type: 'question', title: 'Аддон Problet', message: (old ? 'Обновить' : 'Установить') + ' аддон «' + loc(m, 'name') + '» ' + m.version + '?', detail: describe(m, from), buttons: [old ? 'Обновить' : 'Установить', 'Отмена'], defaultId: 0, cancelId: 1, noLink: true });
	return r.response === 0;
}

// Готовая временная папка с addon.json → userData/addons/<id>
async function finish(tmp, from) {
	const m = validate(JSON.parse(fs.readFileSync(path.join(tmp, 'addon.json'), 'utf8')));
	for (const f of fileList(m)) if (!fs.existsSync(path.join(tmp, f))) throw new Error('В аддоне нет файла ' + f);
	if (!(await confirmInstall(m, from))) {
		fs.rmSync(tmp, { recursive: true, force: true });
		return { canceled: true };
	}
	const old = addons.get(m.id);
	if (old) stopBackground(old);
	const target = path.join(dir, m.id);
	fs.rmSync(target, { recursive: true, force: true });
	fs.renameSync(tmp, target);
	const st = stateOf(m.id);
	st.source = from || '';
	saveState();
	const a = load(m.id);
	addons.set(m.id, a);
	assignWorlds();
	startBackground(a);
	ctx.buttonsChanged();
	return { message: 'Аддон «' + loc(m, 'name') + '» установлен', id: m.id };
}

const tmpDir = () => fs.mkdtempSync(path.join(dir, '.new-'));

async function download(url, max) {
	const res = await net.fetch(url, { bypassCustomProtocolHandlers: true });
	if (!res.ok) throw new Error('Не удалось скачать ' + url + ' (' + res.status + ')');
	const buf = Buffer.from(await res.arrayBuffer());
	if (buf.length > max) throw new Error('Файл слишком большой: ' + url);
	return buf;
}

// Относительные ссылки из html (src, href), css (url(), @import) и js (import … from): путь от корня аддона
function refsOf(file, buf) {
	if (!/\.(html?|css|m?js)$/i.test(file)) return [];
	const text = buf.toString('utf8');
	const found = [];
	const res = /\.html?$/i.test(file)
		? [/\b(?:src|href)\s*=\s*["']([^"'#?]+)/gi, /url\(\s*["']?([^"')#?]+)/gi]
		: /\.css$/i.test(file)
			? [/url\(\s*["']?([^"')#?]+)/gi, /@import\s+["']([^"'#?]+)/gi]
			: [/\bimport\s*(?:[\w{}*\s,]+from\s*)?["']([^"'#?]+)["']/g, /\bimport\(\s*["']([^"'#?]+)["']\s*\)/g];
	for (const re of res) {
		for (const m of text.matchAll(re)) {
			const ref = m[1].trim();
			if (!ref || /^[a-z][a-z0-9+.-]*:/i.test(ref) || ref.startsWith('//')) continue;
			const p = path.posix.normalize(path.posix.join(path.posix.dirname(file), ref.startsWith('/') ? path.posix.relative(path.posix.dirname(file), ref.slice(1)) : ref));
			if (isRel(p)) found.push(p);
		}
	}
	return found;
}

// По ссылке на addon.json: остальные файлы берутся рядом с ним
async function installFromUrl(input) {
	let u;
	try {
		u = new URL(String(input || '').trim());
	} catch (e) {
		throw new Error('Это не ссылка');
	}
	if (!/^https?:$/.test(u.protocol)) throw new Error('Нужна ссылка http или https на addon.json');
	// Ссылку на файл в обычном интерфейсе GitHub превращаем в ссылку на сам файл
	const gh = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/.exec(u.href);
	if (gh) u = new URL('https://raw.githubusercontent.com/' + gh[1] + '/' + gh[2] + '/' + gh[3]);
	if (!/addon\.json$/.test(u.pathname)) u = new URL(u.href.replace(/\/?$/, '/addon.json'));
	const raw = await download(u.href, 1024 * 1024);
	let m;
	try {
		m = validate(JSON.parse(raw.toString('utf8')));
	} catch (e) {
		throw new Error(e instanceof SyntaxError ? 'addon.json не разобрать: ' + e.message : e.message);
	}
	const files = fileList(m);
	if (files.length > MAX_FILES) throw new Error('Слишком много файлов');
	const tmp = tmpDir();
	try {
		fs.writeFileSync(path.join(tmp, 'addon.json'), raw);
		// Файлы из addon.json обязательны. Их страницы, стили и скрипты ссылаются на другие файлы рядом (popup.js, картинки) — их тоже ищем и скачиваем, если они есть
		const queue = files.map((f) => ({ f, need: true }));
		const seen = new Set(files);
		let total = 0;
		while (queue.length) {
			const { f, need } = queue.shift();
			let buf;
			try {
				buf = await download(new URL(f.split('/').map(encodeURIComponent).join('/'), u).href, MAX_FILE);
			} catch (e) {
				if (need) throw e;
				continue;
			}
			total += buf.length;
			if (total > MAX_TOTAL) throw new Error('Аддон слишком большой');
			fs.mkdirSync(path.dirname(path.join(tmp, f)), { recursive: true });
			fs.writeFileSync(path.join(tmp, f), buf);
			for (const ref of refsOf(f, buf)) {
				if (seen.has(ref)) continue;
				seen.add(ref);
				if (seen.size > MAX_FILES) throw new Error('Слишком много файлов');
				queue.push({ f: ref, need: false });
			}
		}
		return await finish(tmp, u.href);
	} catch (e) {
		fs.rmSync(tmp, { recursive: true, force: true });
		throw e;
	}
}

// Из архива .zip: addon.json в корне или в единственной папке внутри
async function installFromZip(file) {
	const st = fs.statSync(file);
	if (st.size > MAX_TOTAL) throw new Error('Архив слишком большой');
	const tmp = tmpDir();
	try {
		extensions.unzip(fs.readFileSync(file), tmp);
		let root = tmp;
		if (!fs.existsSync(path.join(root, 'addon.json'))) {
			const inner = fs.readdirSync(tmp, { withFileTypes: true }).filter((d) => !d.name.startsWith('__MACOSX'));
			if (inner.length === 1 && inner[0].isDirectory() && fs.existsSync(path.join(tmp, inner[0].name, 'addon.json'))) root = path.join(tmp, inner[0].name);
			else throw new Error('В архиве нет addon.json');
		}
		if (root !== tmp) {
			const moved = tmpDir();
			fs.rmSync(moved, { recursive: true, force: true });
			fs.renameSync(root, moved);
			fs.rmSync(tmp, { recursive: true, force: true });
			return await finish(moved, path.basename(file));
		}
		return await finish(tmp, path.basename(file));
	} catch (e) {
		fs.rmSync(tmp, { recursive: true, force: true });
		throw e;
	}
}

function catalogBase() {
	return process.env.PROBLET_ADDONS_CATALOG || CATALOG;
}

// Список аддонов из репозитория ProbletAddons
async function catalog() {
	const base = catalogBase();
	const raw = await download(base + 'index.json?t=' + Date.now(), 1024 * 1024);
	const j = JSON.parse(raw.toString('utf8'));
	const out = [];
	for (const x of Array.isArray(j.addons) ? j.addons : []) {
		if (!x || !ID_RE.test(x.id || '') || !isRel(x.path || '')) continue;
		const a = addons.get(x.id);
		const lo = cleanLocales(x.locales);
		const l = lo[curLang()] || {};
		out.push({ id: x.id, name: l.name || str(x.name, 60) || x.id, description: l.description || str(x.description, 300), version: str(x.version, 20), icon: typeof x.icon === 'string' && [...x.icon].length <= 4 ? x.icon : '', installed: a && a.manifest ? a.manifest.version : '' });
	}
	return out;
}

async function installFromCatalog(id) {
	if (!ID_RE.test(String(id))) throw new Error('Неверный аддон');
	const list = JSON.parse((await download(catalogBase() + 'index.json?t=' + Date.now(), 1024 * 1024)).toString('utf8'));
	const x = (list.addons || []).find((e) => e && e.id === id);
	if (!x || !isRel(x.path || '')) throw new Error('Аддона нет в каталоге');
	return installFromUrl(new URL(x.path.replace(/\/?$/, '/') + 'addon.json', catalogBase()).href);
}

function remove(id) {
	const a = addons.get(id);
	if (!a) throw new Error('Нет такого аддона');
	stopBackground(a);
	addons.delete(id);
	delete state[id];
	saveState();
	storageCache.delete(id);
	pickedPaths.delete(id);
	fs.rmSync(a.dir, { recursive: true, force: true });
	fs.rmSync(storageFile(id), { force: true });
	assignWorlds();
	ctx.buttonsChanged();
}

function resetPermissions(id) {
	if (!addons.has(id)) throw new Error('Нет такого аддона');
	stateOf(id).granted = {};
	saveState();
	pickedPaths.delete(id);
}

function removeAll() {
	for (const id of [...addons.keys()]) remove(id);
}

module.exports = { SCHEME, init, handler, pageUrl, call, reply, emit, contentFor, fromContent, actions, click, list, catalog, installFromCatalog, installFromUrl, installFromZip, remove, removeAll, resetPermissions, validate, matcher, PERMS };
