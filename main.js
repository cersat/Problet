const { app, BrowserWindow, WebContentsView, ipcMain, protocol, net, dialog, nativeTheme, session, Menu, clipboard, shell, nativeImage, Notification, screen } = require('electron');
const crypto = require('crypto');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { pathToFileURL, fileURLToPath } = require('url');
const store = require('./store');
const cache = require('./cache');
const adblock = require('./adblock');
const identity = require('./identity');
const updater = require('./updater');
const importer = require('./importer');
const extensions = require('./extensions');
const addons = require('./addons');
const accel = require('./pages/accel');
const pageTranslate = require('./pagetranslate');
const vault = require('./vault');
const passcsv = require('./passcsv');
const { tryCalc } = require('./calc');
const { themePayload, accentList, PRESETS, TINTS, CONTRASTS, UI_SCALES, THEME_KEYS, PALETTES } = require('./theme');
const headless = require('./headless');
const parental = require('./parental');
const offline = require('./offline');
const i18nMain = require('./i18n-main');
const vtab = require('./vtab');
const { tr } = i18nMain;

// Память: молодое поколение кучи V8 в каждом процессе ограничено 2 МБ (по умолчанию растёт до 16). Страницы с большим числом
// недолговечных объектов собирают мусор чаще, зато каждая вкладка занимает заметно меньше (в замерах около 20 МБ на 7 вкладок)
app.commandLine.appendSwitch('js-flags', '--max-semi-space-size=2');

// Родительский контроль: с ним нельзя запускаться с параметрами, которые дают обойти его (управление браузером снаружи, отладчик, режим без окна)
parental.init(app.getPath('appData'), 'Problet');
if (parental.isOn()) {
	const bad = parental.badArgs(process.argv.slice(1).concat(process.execArgv));
	for (const sw of parental.BLOCKED_SWITCHES) if (app.commandLine.hasSwitch(sw) && !bad.some((a) => a.replace(/^-+/, '').split('=')[0].toLowerCase() === sw)) bad.push('--' + sw);
	let inspector = false;
	try {
		inspector = !!require('inspector').url();
		if (inspector) require('inspector').close();
	} catch (e) { /* отладчика нет */ }
	if (inspector && !bad.length) bad.push('--inspect');
	if (bad.length) {
		for (const sw of parental.BLOCKED_SWITCHES) app.commandLine.removeSwitch(sw);
		const text = 'Родительский контроль запрещает запуск с параметрами: ' + bad.join(' ');
		console.error(text);
		if (headless.enabled) process.exit(1);
		app.whenReady().then(() => {
			dialog.showErrorBox('Problet', tr(text));
			app.exit(1);
		});
	}
}

// Режим без окна: одноразовый профиль, если папка профиля не задана явно
if (headless.enabled && !process.argv.some((a) => a.startsWith('--user-data-dir='))) {
	const tmpProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'problet-headless-'));
	app.setPath('userData', tmpProfile);
	process.on('exit', () => {
		try {
			fs.rmSync(tmpProfile, { recursive: true, force: true });
		} catch (e) { /* не страшно: папка во временных файлах */ }
	});
}

// Язык: перевод меню и диалогов ставится сразу, язык самого Chromium — до запуска приложения
i18nMain.applyChromiumLang();
// Папка кеша: Electron сам выбирает путь кеша (флаг --disk-cache-dir он не слушает), поэтому подменяем папку «Cache» ссылкой на нужную. Делается до запуска Chromium, настройка берётся прямо из файла
try {
	const raw = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'data.json'), 'utf8'));
	const dir = raw && raw.settings && raw.settings.cacheDir;
	const link = path.join(app.getPath('userData'), 'Cache');
	let st = null;
	try {
		st = fs.lstatSync(link);
	} catch (e) { /* кеша ещё нет */ }
	if (typeof dir === 'string' && dir && path.isAbsolute(dir)) {
		fs.mkdirSync(dir, { recursive: true });
		const same = st && st.isSymbolicLink() && path.resolve(fs.readlinkSync(link)) === path.resolve(dir);
		if (!same) {
			if (st && st.isSymbolicLink()) fs.unlinkSync(link);
			else if (st) fs.rmSync(link, { recursive: true, force: true });
			fs.symlinkSync(dir, link, 'junction');
		}
	} else if (st && st.isSymbolicLink()) {
		fs.unlinkSync(link); // вернули стандартную папку: Chromium создаст кеш заново
	}
} catch (e) { /* профиль ещё пустой или папка недоступна: стандартный кеш */ }
i18nMain.install(() => {
	try {
		return store.getSettings().language;
	} catch (e) {
		return 'auto'; // настройки ещё не загружены
	}
});
const curLang = () => i18nMain.lang();

// ---------- Журнал: /tmp/problet/log (на Windows — в папке временных файлов) ----------

const LOG_DIR = path.join(process.platform === 'win32' ? os.tmpdir() : '/tmp', 'problet');
const LOG_FILE = path.join(LOG_DIR, 'log');

function log(...parts) {
	try {
		const text = parts.map((p) => (p instanceof Error ? p.stack || String(p) : typeof p === 'string' ? p : JSON.stringify(p))).join(' ');
		fs.mkdirSync(LOG_DIR, { recursive: true });
		try {
			if (fs.statSync(LOG_FILE).size > 2 * 1024 * 1024) fs.renameSync(LOG_FILE, LOG_FILE + '.old');
		} catch (e) { /* файла ещё нет */ }
		fs.appendFileSync(LOG_FILE, new Date().toISOString() + ' ' + text + '\n');
	} catch (e) { /* журнал не должен ронять браузер */ }
}

// Неожиданная ошибка в главном процессе не должна ронять браузер: пишем её в журнал и работаем дальше (окно с ошибкой показывает boot.js)
const errorwin = require('./errorwin');
process.on('uncaughtException', (err) => log('uncaughtException', err));
process.on('unhandledRejection', (err) => log('unhandledRejection', err instanceof Error ? err : String(err)));
// На Linux каждое новое окно (инструменты разработчика, окно ошибки) без своей иконки получает шестерёнку — задаём всем нашу
app.on('browser-window-created', (_e, w) => {
	try {
		w.setIcon(path.join(__dirname, 'icon.png'));
	} catch (e) { /* иконка не критична */ }
});

// Окно ошибки (errorwin.js) показывается и для своих ошибок, например из showError('Заголовок', текст)
const showError = (title, text) => errorwin.show(title, text);

log('запуск', app.getVersion(), process.platform, process.arch, 'electron', process.versions.electron);
app.on('render-process-gone', (_e, wc, details) => log('render-process-gone', wc && !wc.isDestroyed() ? wc.getURL() : '', details));
app.on('child-process-gone', (_e, details) => log('child-process-gone', details));

const TABBAR_HEIGHT = 36;
const TITLEBAR_HEIGHT = 28;
const TOOLBAR_HEIGHT = 44;
const BMBAR_HEIGHT = 32;
const XBAR_HEIGHT = 32;
const SIDE_WIDTH = 220; // ширина вертикальной панели вкладок
const ROW_HEIGHT = 34;
const POPUP_PADDING = 4;
const MAX_SUGGESTIONS = 7;
const INTERNAL_PAGES = new Set(['settings', 'bookmarks', 'newtab', 'history', 'downloads', 'passwords', 'version', 'spaces', 'chars', 'insecure', 'blocklist', 'pwsave', 'pwfill', 'files', 'svgedit', 'folder', 'bmstar', 'offline', 'game', 'parental']);
const FIND_WIDTH = 390;
const FIND_HEIGHT = 46;
const NEWTAB = 'problet://newtab/';

// Внутренние страницы живут на адресах problet://settings, problet://bookmarks и problet://newtab
protocol.registerSchemesAsPrivileged([
	{ scheme: 'problet', privileges: { standard: true, secure: true, supportFetchAPI: true } },
	{ scheme: 'problet-addon', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }, // страницы аддонов Problet
]);

let win = null;
let popup = null;
let popupReady = false;
let findView = null;
let findOpen = false;
let findText = '';
const downloads = []; // { id, name, path, url, received, total, state, time, item }
let started = false;
let nextTabId = 1;
let activeId = null;
let sessionTimer = null;
const iconByOrigin = new Map(); // известные иконки сайтов, чтобы показать их сразу при начале загрузки
let currentSpace = store.DEFAULT_SPACE;
let spaces = [{ id: store.DEFAULT_SPACE, name: 'Основное' }];
const spaceActive = {}; // последняя активная вкладка каждого пространства
const tabs = []; // { id, view, title, url, icon, loading, pendingUrl, pinned }

// Состояние выпадающего списка подсказок
const sug = { items: [], selected: -1, original: '', x: 0, width: 0 };

const settings = () => store.getSettings();
const bgColor = () => themePayload(settings()).vars['--bg'];
const themeMsg = () => ({ ...themePayload(settings()), lang: curLang() }); // тема и язык уходят в окна одним сообщением
const surfaceColor = () => themePayload(settings()).vars['--surface'];
// Масштаб интерфейса: панели и окошки браузера рисуются крупнее, их размеры в окне умножаются на него
const uiZ = () => themePayload(settings()).scale;
const uiPx = (n) => Math.round(n * uiZ());
// Положение кнопки, которое прислали панели, — в их единицах; в окне оно больше во столько же раз
const uiRect = (r) => (r && Number.isFinite(r.x) && Number.isFinite(r.y) ? { ...r, x: r.x * uiZ(), y: r.y * uiZ(), width: (Number(r.width) || 0) * uiZ(), height: (Number(r.height) || 0) * uiZ() } : r);
function uiZoom(wc) {
	if (wc && !wc.isDestroyed() && Math.abs(wc.getZoomFactor() - uiZ()) > 0.001) wc.setZoomFactor(uiZ());
}
const activeTab = () => tabs.find((t) => t.id === activeId) || null;
const activeContents = () => {
	const t = activeTab();
	return t ? t.view.webContents : null;
};
const isNewTab = (url) => String(url).startsWith('problet://newtab');

// ---------- Что ввели в адресной строке ----------

// allowRelativeFile — для аргумента командной строки: там `page.html` это файл, а не поиск
function resolveInput(raw, allowRelativeFile) {
	const text = String(raw || '').trim();
	if (!text) return null;
	if (text.startsWith('<')) {
		return { url: 'data:text/html;charset=utf-8,' + encodeURIComponent(text) };
	}
	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text) || /^(data|about|file|view-source):/i.test(text)) {
		return { url: text };
	}
	const looksLikePath = path.isAbsolute(text) || text.startsWith('./') || text.startsWith('../');
	if ((looksLikePath || allowRelativeFile) && fs.existsSync(text)) {
		return { url: pathToFileURL(path.resolve(text)).href };
	}
	if (/^localhost(:\d+)?([/?#]|$)/i.test(text) || /^\d{1,3}(\.\d{1,3}){3}(:\d+)?([/?#]|$)/.test(text)) {
		return { url: 'http://' + text };
	}
	if (/^[^\s/]+\.[a-z]{2,}(:\d+)?([/?#].*)?$/i.test(text)) {
		return { url: 'https://' + text };
	}
	return { url: store.searchUrl(text), search: text };
}

function loadInActive(url) {
	const tab = activeTab();
	if (!tab) return;
	hideSuggest();
	tab.pendingUrl = null;
	tab.view.webContents.loadURL(url).catch(() => {});
	focusWc(tab.view.webContents);
}

// История поисковых запросов не пополняется из вкладок инкогнито
function rememberSearch(text, tab) {
	const t = tab === undefined ? activeTab() : tab;
	if (!t || !t.incognito) store.addSearch(text);
}

function tabOfContents(wc) {
	return tabs.find((t) => t.view.webContents === wc) || {};
}

// ---------- Виртуальные вкладки ----------
// Внутренние страницы problet:// рисуются рамками в окне панели (см. vtab.js), а не отдельными страницами со своим процессом.
// Вкладка инкогнито остаётся настоящей страницей: у неё своя сессия, следов в обычной быть не должно

const PAGE_PRELOAD = path.join(__dirname, 'preload-page.js');
let vtBounds = '';
const vhost = {
	send: (msg) => {
		if (win && !win.isDestroyed()) win.webContents.send('vt', msg);
	},
	toolbar: () => win.webContents,
	focus: (vc) => {
		if (win && win.isDestroyed()) return; // окно уже закрыто, браузер выходит
		focusWc(win.webContents);
		vhost.send({ op: 'focus', id: vc.id });
	},
	external: (vc, url) => {
		const tab = tabs.find((t) => t.view.webContents === vc);
		if (tab) switchView(tab, url, false);
	},
	// Область страницы в единицах окна панели (у него свой масштаб интерфейса)
	rect: () => {
		const b = pageBounds();
		const z = uiZ();
		return { x: b.x / z, y: b.y / z, width: b.width / z, height: b.height / z };
	},
	bounds: () => {
		const r = vhost.rect();
		const key = JSON.stringify(r);
		if (key === vtBounds) return;
		vtBounds = key;
		vhost.send({ op: 'bounds', ...r });
	},
	// Окно панели уже увеличено масштабом интерфейса, а внутренние страницы раньше его не получали: делим обратно
	cssZoom: (level) => Math.pow(1.2, Number(level) || 0) / uiZ(),
	print: (vc, opts, cb) => {
		withGhost(vc, (wc, done) => wc.print(opts, (ok, reason) => {
			done();
			if (cb) cb(ok, reason);
		})).catch((e) => cb && cb(false, String(e.message || e)));
	},
};

// Адрес самой панели (problet://ui/) в обычной странице не открывается никогда: такая вкладка покажет внутреннюю страницу «не найдено»
const isVirtualFor = (tab, url) => (!(tab && tab.incognito) && vtab.isVirtualUrl(url)) || /^problet:\/\/ui([/?#]|$)/i.test(String(url));

// Вкладка внутренней страницы по рамке, из которой пришло событие
function vtabOfFrame(frame) {
	if (!frame || !win || win.isDestroyed()) return null;
	try {
		if (!frame.parent || frame.parent.frameTreeNodeId !== win.webContents.mainFrame.frameTreeNodeId) return null;
		const m = /^vt-(\d+)$/.exec(frame.name);
		if (!m) return null;
		const id = Number(m[1]);
		return tabs.find((t) => t.view.virtual && t.view.webContents.id === id) || null;
	} catch (e) {
		return null;
	}
}

// Вкладка, из которой пришло сообщение: настоящая страница или рамка внутренней
function senderTab(e) {
	return tabs.find((t) => t.view.webContents === e.sender) || (win && e.sender === win.webContents ? vtabOfFrame(e.senderFrame) : null);
}

// Адрес страницы, из которой пришло сообщение, в том виде, в каком его видит человек
function senderPageUrl(e) {
	const f = e.senderFrame;
	if (!f) return '';
	return vtabOfFrame(f) ? vtab.fromFrameUrl(f.url) : f.url;
}

function newRealView(tab) {
	const prefs = { preload: PAGE_PRELOAD, contextIsolation: true, sandbox: true };
	if (tab && tab.incognito) prefs.session = incognitoSession();
	const view = new WebContentsView({ webPreferences: prefs });
	view.setBackgroundColor(bgColor());
	view.setVisible(false);
	if (profile) view.webContents.setUserAgent(profile.userAgent);
	return view;
}

// Слои поверх страниц должны остаться сверху после добавления новой страницы
function raiseLayers() {
	if (findView) win.contentView.addChildView(findView);
	if (popup) win.contentView.addChildView(popup); // подсказки всегда поверх страниц
	if (panel) win.contentView.addChildView(panel);
}

// Меняем страницу вкладки: настоящая ↔ виртуальная (и при выгрузке)
function swapView(tab, view) {
	const old = tab.view;
	tab.view = view;
	view.setBounds(pageBounds());
	if (!old.virtual) win.contentView.removeChildView(old);
	if (!view.virtual) {
		win.contentView.addChildView(view);
		raiseLayers();
	}
	wireTab(tab);
	if (tab.id === activeId) view.setVisible(true);
	const dying = old.webContents;
	// Боковая панель расширения была привязана к старой странице вкладки: переносим её на новую (расширение узнаёт вкладку по номеру в адресе панели)
	if (sideView && dying && dying.id === sideTab && !view.webContents.isDestroyed()) {
		sideTab = view.webContents.id;
		const u = new URL(sideView.webContents.getURL());
		u.searchParams.set('tabId', String(sideTab));
		sideView.webContents.loadURL(u.href).catch(() => {});
	}
	if (dying && !dying.isDestroyed()) dying.close();
	if (sideView) layout();
}

// История вкладки, которая успела побыть и обычной, и внутренней страницей: куски до и после текущего
function snapshotView(tab) {
	const nav = tab.view.webContents.navigationHistory;
	const entries = nav.getAllEntries().filter((e) => e && e.url && e.url !== 'about:blank');
	if (!entries.length) return null;
	return { virtual: !!tab.view.virtual, entries: nav.getAllEntries(), index: nav.getActiveIndex() };
}

function switchView(tab, url, toVirtual) {
	if (!tabs.includes(tab)) return;
	const snap = snapshotView(tab);
	if (snap) tab.backSegs.push(snap);
	tab.fwdSegs = [];
	swapView(tab, toVirtual ? new vtab.VirtualView(vhost) : newRealView(tab));
	tab.view.webContents.loadURL(url).catch(() => {});
	if (tab.id === activeId) focusWc(tab.view.webContents);
}

function restoreSegment(tab, seg) {
	swapView(tab, seg.virtual ? new vtab.VirtualView(vhost) : newRealView(tab));
	tab.view.webContents.navigationHistory.restore({ entries: seg.entries, index: seg.index }).catch(() => {});
	if (tab.id === activeId) focusWc(tab.view.webContents);
}

const canBack = (tab) => !!tab && (tab.view.webContents.navigationHistory.canGoBack() || tab.backSegs.length > 0);
const canForward = (tab) => !!tab && (tab.view.webContents.navigationHistory.canGoForward() || tab.fwdSegs.length > 0);

function tabBack(tab) {
	const nav = tab.view.webContents.navigationHistory;
	if (nav.canGoBack()) return nav.goBack();
	if (!tab.backSegs.length) return;
	const seg = tab.backSegs.pop();
	const snap = snapshotView(tab);
	if (snap) tab.fwdSegs.push(snap);
	restoreSegment(tab, seg);
}

function tabForward(tab) {
	const nav = tab.view.webContents.navigationHistory;
	if (nav.canGoForward()) return nav.goForward();
	if (!tab.fwdSegs.length) return;
	const seg = tab.fwdSegs.pop();
	const snap = snapshotView(tab);
	if (snap) tab.backSegs.push(snap);
	restoreSegment(tab, seg);
}

// Печать и снимок всей страницы нужны настоящей странице: для внутренней на время открываем её копию в скрытом окне
const ghosts = new Set(); // скрытые копии внутренних страниц: им тоже можно звать API страниц
async function withGhost(vc, fn) {
	const b = pageBounds();
	// offscreen: скрытое окно иначе может так и не отрисовать кадр, и снимок ждёт вечно
	const ghost = new BrowserWindow({ show: false, width: Math.max(400, b.width), height: Math.max(300, b.height), webPreferences: { preload: PAGE_PRELOAD, contextIsolation: true, sandbox: true, offscreen: true } });
	const gwc = ghost.webContents;
	ghosts.add(gwc);
	const done = () => {
		ghosts.delete(gwc);
		if (!ghost.isDestroyed()) ghost.destroy();
	};
	try {
		await ghost.loadURL(vc.getURL());
		await new Promise((r) => setTimeout(r, 500)); // страница дорисовывает данные из главного процесса
		return await fn(ghost.webContents, done);
	} catch (e) {
		done();
		throw e;
	}
}

function navigate(raw) {
	const r = resolveInput(raw);
	if (!r) return;
	if (r.search) rememberSearch(r.search);
	loadInActive(r.url);
}

function searchFor(text) {
	rememberSearch(text);
	loadInActive(store.searchUrl(text));
}

// ---------- Состояние тулбара и вкладок ----------

function isBookmarkable(url) {
	return /^(https?|file):\/\//i.test(url);
}

function tabTitle(t) {
	if (t.customTitle) return t.customTitle; // переименованная вкладка держит своё имя до закрытия
	if (t.url.startsWith('data:') && t.title.startsWith('data:')) return tr('HTML-страница');
	return t.title;
}

// Значки внутренних страниц (SVG в виде data-адреса, из общего набора иконок); у новой вкладки — значок браузера
const ICONS = require('./pages/icons');
const fm = require('./filemanager');
const INTERNAL_ICONS = {};
for (const name of ['settings', 'bookmarks', 'history', 'version', 'passwords', 'downloads', 'offline', 'svgedit', 'spaces', 'game', 'blocklist']) INTERNAL_ICONS[name] = ICONS.dataUrl(name);
INTERNAL_ICONS.parental = ICONS.dataUrl('lock');
INTERNAL_ICONS.files = ICONS.dataUrl('folder');
let browserIcon = '';

function internalIcon(url) {
	const m = /^problet:\/\/([\w-]+)/.exec(url);
	if (!m) return '';
	if (m[1] === 'newtab') {
		if (!browserIcon) browserIcon = nativeImage.createFromPath(path.join(__dirname, 'icon.png')).resize({ width: 32 }).toDataURL();
		return browserIcon;
	}
	return INTERNAL_ICONS[m[1]] || '';
}

// Панель вкладок можно растянуть до двойного размера (tabsScale от 1 до 2)
function panelHeight(k) {
	return uiPx(k === 'tabs' ? Math.round(TABBAR_HEIGHT * settings().tabsScale) : k === 'toolbar' ? TOOLBAR_HEIGHT : k === 'extra' ? XBAR_HEIGHT : BMBAR_HEIGHT);
}

function sideWidth() {
	return uiPx(Math.round(SIDE_WIDTH * settings().tabsScale));
}

// Где что стоит: какие панели над страницей, какие под ней, нужна ли узкая полоса заголовка для кнопок окна.
// Тот же план получает окно с панелями (renderer.js), а высоты и ширины заданы и в style.css
function panelPlan() {
	const s = settings();
	const side = s.tabsPos === 'left' || s.tabsPos === 'right' ? s.tabsPos : '';
	const order = s.panelOrder.filter((k) => (k === 'tabs' ? !side : k === 'extra' ? s.btnLayout.extra.length > 0 : k !== 'bmbar' || s.bookmarksBar));
	const at = order.indexOf('page');
	const before = order.slice(0, at);
	const after = order.slice(at + 1);
	// Кнопки окна на панели вкладок живут в самой верхней полосе: если панель вкладок не первая сверху или стоит сбоку, для них есть отдельная узкая полоса
	const strip = s.btnLayout.tabs.includes('winctl') && (!!side || before[0] !== 'tabs');
	return { side, before, after, strip };
}

function panelsHeight(list) {
	return list.reduce((n, k) => n + panelHeight(k), 0);
}

// Верхний край панели инструментов в окне; null, если она под страницей
function toolbarTop() {
	const p = panelPlan();
	const at = p.before.indexOf('toolbar');
	if (at < 0) return null;
	return (p.strip ? uiPx(TITLEBAR_HEIGHT) : 0) + panelsHeight(p.before.slice(0, at));
}

const LAYOUT_KEYS = ['tabsPos', 'bmOnlyIcons', 'bookmarksBar', 'btnLayout', 'btnOptions', 'tabsScale', 'tabsTwoRows', 'tabsAlign'];

function layoutPayload() {
	const s = settings();
	const out = {};
	for (const k of LAYOUT_KEYS) out[k] = s[k];
	out.plan = panelPlan();
	out.tabsTwoRows = s.tabsTwoRows && s.tabsScale >= store.TWO_ROWS_MIN; // выбор сохраняется, а действует, пока панель растянута
	out.arrows = s.arrows;
	out.extButtons = [...extensions.actions(), ...addons.actions()];
	out.customButtons = s.customButtons.map((c) => ({ id: c.id, name: c.name, icon: c.icon, svg: c.svg }));
	out.tabsBase = { row: TABBAR_HEIGHT, side: SIDE_WIDTH };
	out.maximized = !!(win && !win.isDestroyed() && win.isMaximized());
	return out;
}


function sendLayout() {
	if (win && !win.isDestroyed()) win.webContents.send('layout', layoutPayload());
}

ipcMain.on('layout:get', (e) => {
	e.returnValue = layoutPayload();
});

const fromToolbar0 = (e) => !!win && e.sender === win.webContents;
ipcMain.on('newtab-menu', (e) => {
	if (!fromToolbar0(e)) return;
	popupMenu([
		{ label: 'Новая вкладка', click: () => createTab(NEWTAB) },
		{ label: 'Новая вкладка инкогнито', click: () => openIncognito() },
	]);
});
ipcMain.on('win:minimize', (e) => fromToolbar0(e) && win.minimize());
ipcMain.on('win:maximize', (e) => {
	if (!fromToolbar0(e)) return;
	if (win.isMaximized()) win.unmaximize();
	else win.maximize();
});
ipcMain.on('win:close', (e) => fromToolbar0(e) && win.close());

// Панель закладок: папки и закладки целиком, рисует их окно тулбара
function barPayload() {
	const st = store.bookmarksState();
	return { folders: st.folders.map((f) => ({ id: f.id, name: f.name, color: f.color })), bookmarks: st.bookmarks.map((b) => ({ id: b.id, title: b.title, url: b.url, icon: b.icon, iconTone: b.iconTone, customIcon: b.customIcon, folder: b.folder })) };
}

function sendBar() {
	if (win && !win.isDestroyed()) win.webContents.send('bar', barPayload());
}

ipcMain.on('bar:get', (e) => {
	e.returnValue = barPayload();
});
// Закладка открывается в текущей вкладке или в новой (если так выбрано в настройках; пустую новую вкладку занимаем сами)
function openBookmarkUrl(url, forceNew) {
	const tab = activeTab();
	const blank = tab && isNewTab(tab.view.webContents.getURL() || tab.url);
	if ((forceNew || settings().bmNewTab) && !blank) createTab(url, { activate: true });
	else {
		// «Не открывать вторую идентичную вкладку»: закладка, открытая в текущей вкладке, тоже не должна дублировать уже открытую
		if (settings().noDuplicateTabs && url) {
			const same = tabs.find((t) => t !== tab && !t.hidden && !t.incognito === !(tab && tab.incognito) && (settings().spacesMerged || t.space === currentSpace) && sameUrl(t.pendingUrl || t.url, url));
			if (same) {
				activateTab(same.id);
				return;
			}
		}
		loadInActive(url);
	}
}

ipcMain.on('bar:open', (e, id, newTab) => {
	if (!fromToolbar0(e)) return;
	const b = store.bookmarksState().bookmarks.find((x) => x.id === id);
	if (!b) return;
	openBookmarkUrl(b.url, newTab);
});
ipcMain.on('bar:menu', (e, id) => {
	if (!fromToolbar0(e)) return;
	const b = store.bookmarksState().bookmarks.find((x) => x.id === id);
	if (!b) return;
	popupMenu([
		{ label: 'Изменить закладку', click: () => createTab('problet://bookmarks/?edit=' + encodeURIComponent(b.id), { activate: true }) },
		{ label: 'Добавить кастомную иконку', click: () => createTab('problet://svgedit/?bm=' + encodeURIComponent(b.id), { activate: true }) },
		{ type: 'separator' },
		{ label: 'Удалить закладку', click: () => store.removeBookmark(b.id) },
	]);
});
// Папка на панели закладок: нажатие раскрывает её окошко, правая кнопка даёт меню
const folderRect = (rect) => ({ ...(uiRect(rect) || {}), addr: false });
const folderItems = (id) => store.bookmarksState().bookmarks.filter((b) => b.folder === id);
function openFolderAll(id) {
	const items = folderItems(id);
	items.forEach((b, i) => createTab(b.url, { activate: i === 0 }));
}
ipcMain.on('bar:folder', (e, folderId, rect) => {
	if (!fromToolbar0(e) || !store.bookmarksState().folders.some((f) => f.id === folderId)) return;
	openPanel('folder', folderRect(rect), folderId);
});
ipcMain.on('bar:folder-menu', async (e, folderId, rect) => {
	if (!fromToolbar0(e)) return;
	const st = store.bookmarksState();
	const f = st.folders.find((x) => x.id === folderId);
	if (!f) return;
	const count = folderItems(folderId).length;
	popupMenu([
		{ label: 'Открыть', click: () => openPanel('folder', folderRect(rect), folderId) },
		{ label: 'Открыть все в новых вкладках', enabled: count > 0, click: () => openFolderAll(folderId) },
		{ label: 'Открыть в менеджере закладок', click: () => createTab('problet://bookmarks/?folder=' + encodeURIComponent(folderId), { activate: true }) },
		{ type: 'separator' },
		{
			label: 'Цвет',
			submenu: [
				{ label: 'Без цвета', type: 'radio', checked: !f.color, click: () => store.setFolderColor(folderId, '') },
				...st.colors.map((c) => ({ label: c.name, type: 'radio', checked: f.color === c.hex, click: () => store.setFolderColor(folderId, c.hex) })),
			],
		},
		{ type: 'separator' },
		{ label: 'Удалить папку', click: () => removeFolderAsk(folderId) },
	]);
});
// Закладки из удалённой папки остаются, просто без папки
async function removeFolderAsk(id) {
	const f = store.bookmarksState().folders.find((x) => x.id === id);
	if (!f) return;
	const r = await dialog.showMessageBox(win, { type: 'question', message: 'Удалить папку «' + f.name + '»? Закладки из неё останутся без папки.', buttons: ['Удалить', 'Отмена'], defaultId: 1, cancelId: 1 });
	if (r.response !== 0) return;
	store.removeFolder(id);
	closePanel();
}

function sendTabs() {
	if (win && win.isDestroyed()) return; // окно уже закрыто, браузер выходит
	sendTabEvents();
	const s = settings();
	win.webContents.send('tabs', {
		activeId,
		showUrl: s.showUrlInTabs,
		showIcons: s.showTabIcons,
		overflow: s.tabOverflow,
		space: spaces.find((x) => x.id === currentSpace) || spaces[0],
		tabs: visibleTabs().map((t) => ({ id: t.id, title: tabTitle(t), url: t.pendingUrl || t.url, icon: internalIcon(t.pendingUrl || t.url) || t.icon, loading: t.loading, pinned: t.pinned, frozen: !!t.frozen, incognito: !!t.incognito, space: s.spacesMerged ? (spaces.find((x) => x.id === t.space) || {}).name || '' : '' })),
		side: s.tabsPos === 'left' || s.tabsPos === 'right',
	});
}

// navigated — страница действительно сменилась, reset — вкладку переключили и адрес надо заменить в любом случае
function sendState(navigated, reset) {
	if (win && win.isDestroyed()) return; // окно уже закрыто, браузер выходит
	scanIconTones(); // у новых иконок закладок узнаём тон в фоне
	const tab = activeTab();
	if (!tab) return;
	const wc = tab.view.webContents;
	const url = tab.pendingUrl || wc.getURL() || tab.url;
	const bookmarkable = isBookmarkable(url);
	win.webContents.send('state', {
		url: url.startsWith('data:text/html') || isNewTab(url) ? '' : url,
		canGoBack: canBack(tab),
		canGoForward: canForward(tab),
		loading: tab.loading,
		canBookmark: bookmarkable,
		bookmarked: bookmarkable && !!store.findBookmarkByUrl(url),
		navigated: !!navigated,
		reset: !!reset,
		zoom: levelToPercent(wc.getZoomLevel()),
		pwOffer: offerFor(tab),
		translated: !!tab.translated,
		canTranslate: pageTranslate.translatable(url),
		safeMode,
	});
}

function focusAddress() {
	focusWc(win.webContents);
	win.webContents.send('focus-address');
}

const btnOpt = (id) => (settings().btnOptions || {})[id] || {};
function toggleReload() {
	const wc = activeContents();
	if (!wc) return;
	if (wc.isLoading()) wc.stop();
	else if (btnOpt('reload').hard) wc.reloadIgnoringCache(); // настройка кнопки: обновлять без кеша
	else wc.reload();
}

function goBack() {
	const tab = activeTab();
	if (tab) tabBack(tab);
}

function goForward() {
	const tab = activeTab();
	if (tab) tabForward(tab);
}

// ☆ и Ctrl+D: закладка сразу добавляется в папку по умолчанию и открывается окошко, где её можно переименовать, перенести или убрать.
// Если в настройках выбрано «молча», звёздочка просто добавляет или убирает закладку
let bmStarCreated = '';
async function toggleBookmark() {
	const tab = activeTab();
	if (!tab) return;
	const wc = tab.view.webContents;
	const url = wc.getURL();
	if (!isBookmarkable(url)) return;
	const existing = store.findBookmarkByUrl(url);
	if (settings().bmStar === 'toggle') {
		if (existing) store.removeBookmark(existing.id);
		else store.addBookmark({ title: wc.getTitle(), url, icon: tab.icon, folder: store.defaultFolder() });
		sendState();
		return;
	}
	let bm = existing;
	if (!bm) {
		bm = store.addBookmark({ title: wc.getTitle(), url, icon: tab.icon, folder: store.defaultFolder() });
		bmStarCreated = bm.id;
		sendState();
	} else if (!(panelOpen && panelKind === 'bmstar' && panelArg === bm.id)) bmStarCreated = '';
	let rect = null;
	try {
		rect = await win.webContents.executeJavaScript("(() => { const e = document.getElementById('star'); if (!e || !e.offsetParent) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()");
	} catch (e) { /* звёздочки нет на панели */ }
	openPanel('bmstar', rect ? { ...uiRect(rect), addr: false } : { x: contentSize()[0] - 12, y: toolbarY() + 4, width: 0, height: panelHeight('toolbar') - uiPx(8), addr: false }, bm.id);
}

// Окошко закладки
handle('bm:star-get', (id) => {
	const st = store.bookmarksState();
	const b = st.bookmarks.find((x) => x.id === id);
	if (!b) throw new Error('Закладка не найдена');
	return { bookmark: { id: b.id, title: b.title, url: b.url, folder: b.folder || '' }, folders: st.folders.map((f) => ({ id: f.id, name: f.name, color: f.color })), created: bmStarCreated === id };
});
handle('bm:star-save', (id, p) => {
	const patch = p && typeof p === 'object' ? p : {};
	let folder = typeof patch.folder === 'string' ? patch.folder : '';
	if (typeof patch.newFolder === 'string' && patch.newFolder.trim()) folder = store.addFolder(patch.newFolder).id;
	store.updateBookmark(id, { title: String(patch.title || ''), folder: folder || null });
	store.setSettings({ bmLastFolder: folder });
	bmStarCreated = '';
	sendState();
});
handle('bm:star-remove', (id) => {
	store.removeBookmark(id);
	bmStarCreated = '';
	sendState();
});

// ---------- Резервные копии закладок ----------

const backupDir = () => settings().bmBackupDir || path.join(app.getPath('userData'), 'bookmark-backups');
const BACKUP_RE = /^bookmarks-(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})(?:-(\d+))?\.json$/;
function listBackups() {
	let names = [];
	try {
		names = fs.readdirSync(backupDir()).filter((n) => BACKUP_RE.test(n));
	} catch (e) {
		return [];
	}
	const order = (n) => { const m = BACKUP_RE.exec(n); return m.slice(1, 7).join('') + String(m[7] || 1).padStart(4, '0'); };
	return names.sort((a, b) => order(b).localeCompare(order(a))).map((name) => {
		const m = BACKUP_RE.exec(name);
		let count = null;
		let size = 0;
		try {
			const full = path.join(backupDir(), name);
			size = fs.statSync(full).size;
			count = JSON.parse(fs.readFileSync(full, 'utf8')).bookmarks.length;
		} catch (e) { /* повреждённая копия */ }
		return { name, date: m[3] + '.' + m[2] + '.' + m[1] + ' ' + m[4] + ':' + m[5], time: new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime(), count, size };
	});
}
// force — по кнопке: копия делается, даже если ничего не поменялось
function makeBackup(force) {
	const st = store.bookmarksState();
	if (!st.bookmarks.length && !st.folders.length) {
		if (force) throw new Error('Закладок пока нет');
		return null;
	}
	const dir = backupDir();
	fs.mkdirSync(dir, { recursive: true });
	const data = store.bookmarksBackup();
	const list = listBackups();
	if (!force && list[0]) {
		try {
			const last = JSON.parse(fs.readFileSync(path.join(dir, list[0].name), 'utf8'));
			if (JSON.stringify([last.folders, last.bookmarks]) === JSON.stringify([data.folders, data.bookmarks])) return null; // с прошлой копии ничего не поменялось
		} catch (e) { /* прошлая копия повреждена: делаем новую */ }
	}
	const d = new Date();
	const p2 = (n) => String(n).padStart(2, '0');
	const base = 'bookmarks-' + d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + '_' + p2(d.getHours()) + '-' + p2(d.getMinutes()) + '-' + p2(d.getSeconds());
	let name = base + '.json';
	for (let n = 2; fs.existsSync(path.join(dir, name)); n++) name = base + '-' + n + '.json'; // две копии в одну секунду не затирают друг друга
	fs.writeFileSync(path.join(dir, name), JSON.stringify(data, null, '\t'));
	// старые копии сверх заданного числа удаляются
	const keep = Number(settings().bmBackupKeep) || 10;
	for (const old of listBackups().slice(keep)) {
		try {
			fs.rmSync(path.join(dir, old.name), { force: true });
		} catch (e) { /* занято */ }
	}
	log('копия закладок', name);
	return name;
}
function backupIfDue() {
	const every = { day: 864e5, week: 7 * 864e5 }[settings().bmBackup];
	if (!every) return;
	const last = listBackups()[0];
	if (last && Date.now() - last.time < every) return;
	try {
		makeBackup(false);
	} catch (e) {
		log('не удалось сохранить копию закладок', e);
	}
}
handle('bm:backup-list', () => ({ dir: backupDir(), list: listBackups() }));
handle('bm:backup-now', () => {
	const name = makeBackup(true);
	return { message: 'Копия сохранена: ' + name };
});
handle('bm:backup-restore', (name) => {
	if (!BACKUP_RE.test(String(name))) throw new Error('Нет такой копии');
	const raw = JSON.parse(fs.readFileSync(path.join(backupDir(), String(name)), 'utf8'));
	try {
		makeBackup(false); // текущие закладки тоже сохраняются: восстановление можно откатить
	} catch (e) { /* без страховочной копии */ }
	const r = store.restoreBookmarks(raw);
	sendState();
	return { message: 'Восстановлено закладок: ' + r.bookmarks + ', папок: ' + r.folders };
});
handle('bm:backup-dir-pick', async () => {
	const r = await dialog.showOpenDialog(win, { title: 'Папка для копий закладок', defaultPath: backupDir(), properties: ['openDirectory', 'createDirectory'] });
	if (r.canceled || !r.filePaths[0]) return { canceled: true };
	return { path: r.filePaths[0] };
});
handle('bm:backup-open', () => {
	fs.mkdirSync(backupDir(), { recursive: true });
	return shell.openPath(backupDir());
});

// ---------- Проверка закладок: какие адреса больше не открываются ----------

// broken — страницы точно нет (404, 410, сайта нет, файла нет); maybe — сервер ошибся или не ответил, может быть временно
async function checkLink(url) {
	let u;
	try {
		u = new URL(url);
	} catch (e) {
		return { kind: 'broken', reason: 'неверный адрес' };
	}
	if (u.protocol === 'file:') return fs.existsSync(fileURLToPath(u)) ? null : { kind: 'broken', reason: 'файла больше нет' };
	const ask = async (method) => {
		const ctl = new AbortController();
		const timer = setTimeout(() => ctl.abort(), 15000);
		try {
			const res = await net.fetch(u.href, { method, signal: ctl.signal, redirect: 'follow', bypassCustomProtocolHandlers: true });
			if (res.body) res.body.cancel().catch(() => {});
			return res.status;
		} finally {
			clearTimeout(timer);
		}
	};
	try {
		let status = await ask('HEAD');
		if (status === 405 || status === 501 || status === 404 || status === 403) status = await ask('GET'); // некоторые сайты не понимают HEAD
		if (status === 404 || status === 410) return { kind: 'broken', reason: 'страницы нет (' + status + ')' };
		if (status >= 500) return { kind: 'maybe', reason: 'ошибка сервера (' + status + ')' };
		return null;
	} catch (e) {
		if (e && e.name === 'AbortError') return { kind: 'maybe', reason: 'сайт не ответил за 15 секунд' };
		const msg = String((e && e.message) || e);
		if (/NAME_NOT_RESOLVED|ADDRESS_UNREACHABLE|CONNECTION_REFUSED/.test(msg)) return { kind: 'broken', reason: /NAME_NOT_RESOLVED/.test(msg) ? 'сайта больше нет' : 'сайт не принимает соединения' };
		return { kind: 'maybe', reason: 'не удалось открыть: ' + msg.replace(/^net::/, '') };
	}
}
let bmChecking = false;
ipcMain.handle('bm:check', async (e) => {
	guard(e);
	if (bmChecking) throw new Error('Проверка уже идёт');
	bmChecking = true;
	try {
		const st = store.bookmarksState();
		const folderName = new Map(st.folders.map((f) => [f.id, f.name]));
		const list = st.bookmarks.slice();
		const out = [];
		let done = 0;
		let next = 0;
		const worker = async () => {
			while (next < list.length) {
				const b = list[next++];
				const r = await checkLink(b.url);
				if (r) out.push({ id: b.id, title: b.title, url: b.url, folder: folderName.get(b.folder) || '', ...r });
				done++;
				const to = vtabOfFrame(e.senderFrame) ? e.senderFrame : e.sender; // страница-рамка получает ответ в свою рамку
				if (!to.isDestroyed()) to.send('bm-check-progress', done, list.length);
			}
		};
		await Promise.all(Array.from({ length: Math.min(6, list.length) }, worker));
		return out.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'broken' ? -1 : 1));
	} finally {
		bmChecking = false;
	}
});

// ---------- Вкладки ----------

// Размер берём у корневого вида окна: после разворачивания на весь экран getContentSize() в обработчике события может отдавать старое значение
function contentSize() {
	const b = win.contentView.getBounds();
	return [b.width, b.height];
}

// Сколько места вокруг страницы занимают панели. Те же числа заданы в style.css
function insets() {
	const p = panelPlan();
	return {
		top: (p.strip ? uiPx(TITLEBAR_HEIGHT) : 0) + panelsHeight(p.before),
		bottom: panelsHeight(p.after),
		left: p.side === 'left' ? sideWidth() : 0,
		right: p.side === 'right' ? sideWidth() : 0,
	};
}

// Верхний край панели инструментов; если она под страницей — её положение от верха окна
function toolbarY() {
	const top = toolbarTop();
	return top !== null ? top : contentSize()[1] - panelsHeight(panelPlan().after.slice(panelPlan().after.indexOf('toolbar')));
}

// Боковая панель расширения (как chrome.sidePanel): страница расширения справа от открытой страницы
const SIDE_PANEL_W = 400;
let sideView = null;
let sideExt = '';
let sideTab = -1; // номер страницы (webContents.id), к которой привязана панель: как в Chrome, панель видна только на своей вкладке
const sideShown = () => {
	const t = sideView && activeTab();
	return !!t && !t.view.webContents.isDestroyed() && t.view.webContents.id === sideTab;
};
const sidePanelWidth = () => (sideShown() ? uiPx(SIDE_PANEL_W) : 0);
function layoutSide() {
	if (!sideView || !win || win.isDestroyed()) return;
	if (!tabs.some((t) => !t.view.webContents.isDestroyed() && t.view.webContents.id === sideTab)) { // вкладка панели закрыта
		closeSidePanel();
		return;
	}
	sideView.setVisible(sideShown());
	const [w, h] = contentSize();
	const i = insets();
	const sw = uiPx(SIDE_PANEL_W);
	sideView.setBounds({ x: Math.max(0, w - i.right - sw), y: i.top, width: sw, height: Math.max(0, h - i.top - i.bottom) });
}
function closeSidePanel() {
	if (!sideView) return;
	const v = sideView;
	sideView = null;
	sideExt = '';
	sideTab = -1;
	try {
		win.contentView.removeChildView(v);
		v.webContents.close();
	} catch (e) { /* окно уже закрывается */ }
	layout();
}
// true — панель открыта или закрыта этим вызовом, false — у расширения нет боковой панели
function toggleSidePanel(id) {
	const at = activeTab();
	if (sideView && sideExt === id && at && at.view.webContents.id === sideTab) {
		closeSidePanel();
		return true;
	}
	const base = extensions.sidePanelUrl(id);
	if (!base || !win || !at) return false;
	const url = base + (base.includes('?') ? '&' : '?') + 'tabId=' + at.view.webContents.id; // расширение берёт номер вкладки из адреса панели
	closeSidePanel();
	sideTab = at.view.webContents.id;
	sideView = new WebContentsView({ webPreferences: { preload: path.join(__dirname, 'preload-page.js'), contextIsolation: true, sandbox: true, nodeIntegrationInSubFrames: true } });
	sideExt = id;
	sideView.setBackgroundColor(bgColor());
	win.contentView.addChildView(sideView);
	sideView.webContents.setWindowOpenHandler(({ url: u }) => {
		if (/^(https?|file):\/\//i.test(u)) createTab(u);
		return { action: 'deny' };
	});
	sideView.webContents.loadURL(url).catch((e) => log('боковая панель расширения не открылась', e));
	layout();
	return true;
}

// Рамка claude.ai в боковой панели: ответы расширения на её сообщения в Electron до неё не доходят, поэтому сообщения идут через браузер:
// страница-рамка → браузер → страница панели → канал → фоновый процесс расширения → и обратно
ipcMain.handle('ext:external', async (e, extId, msg) => {
	if (!sideView || e.sender !== sideView.webContents || String(extId) !== sideExt || !e.senderFrame || !/^https:\/\/claude\.ai\//.test(e.senderFrame.url)) throw new Error('Доступ запрещён');
	const text = JSON.stringify(msg === undefined ? null : msg);
	if (text.length > 1000000) throw new Error('Сообщение слишком большое');
	const code = '(function(){return new Promise((resolve)=>{const id=String(Math.random());const ch=new BroadcastChannel("problet-ext");const done=(v)=>{try{ch.close()}catch(e){}resolve(v)};ch.onmessage=(m)=>{if(m.data&&m.data.reply===id)done(m.data.value)};ch.postMessage({ext:{id,msg:' + text + ',origin:"https://claude.ai",url:' + JSON.stringify(e.senderFrame.url) + '}});setTimeout(()=>done(undefined),30000)})})()';
	return sideView.webContents.mainFrame.executeJavaScript(code);
});

function pageBounds() {
	const [w, h] = contentSize();
	const i = insets();
	return { x: i.left, y: i.top, width: Math.max(0, w - i.left - i.right - sidePanelWidth()), height: Math.max(0, h - i.top - i.bottom) };
}

function layout() {
	for (const t of tabs) t.view.setBounds(pageBounds());
	layoutSide();
	layoutFind();
	hideSuggest();
}

function originOf(url) {
	try {
		const u = new URL(url);
		return /^https?:$/.test(u.protocol) ? u.origin : '';
	} catch (e) {
		return '';
	}
}

function persistable(url) {
	return url.length <= 2048 && /^(https?|file|problet):\/\//i.test(url);
}

function saveSession() {
	clearTimeout(sessionTimer);
	sessionTimer = null;
	const kept = tabs.filter((t) => !t.hidden && !t.incognito && persistable(t.pendingUrl || t.url));
	store.setSession({
		tabs: kept.map((t) => ({ url: t.pendingUrl || t.url, title: t.title, icon: t.icon, pinned: t.pinned, space: t.space })),
		active: Math.max(0, kept.findIndex((t) => t.id === activeId)),
		spaces,
		space: currentSpace,
	});
}

function scheduleSession() {
	clearTimeout(sessionTimer);
	sessionTimer = setTimeout(saveSession, 1000);
}

function setWindowTitle(tab) {
	win.setTitle((tab && tab.title ? tab.title + ' — Problet' : 'Problet') + (safeMode ? ' (' + tr('безопасный режим') + ')' : ''));
}

function onNavigated(tab) {
	if (!tabs.includes(tab)) return;
	tab.url = tab.view.webContents.getURL();
	sendTabs();
	if (tab.id === activeId) sendState(true);
	scheduleSession();
}

function wireTab(tab) {
	const wc = tab.view.webContents;
	const alive = () => tabs.includes(tab) && tab.view.webContents === wc; // страница заменена при выгрузке: события старой не в счёт

	wc.setWindowOpenHandler(({ url }) => {
		if (/^(https?|file):\/\//i.test(url)) createTab(url, { afterId: tab.id });
		return { action: 'deny' };
	});
	// Страница закрыла себя сама (window.close(), например всплывающее окно входа через Google) — убираем её вкладку
	wc.once('destroyed', () => {
		if (win && !win.isDestroyed() && tabs.includes(tab) && tab.view.webContents === wc) closeTab(tab.id);
	});
	wc.on('before-input-event', hotkeys);
	wc.on('context-menu', (_e, params) => showPageMenu(tab, params));
	wc.on('found-in-page', (_e, result) => {
		if (tab.id === activeId && findOpen && findView) findView.webContents.send('find-result', { active: result.activeMatchOrdinal, total: result.matches });
	});

	wc.on('did-fail-load', (_e, code, desc, failedUrl, isMain) => {
		if (isMain && code !== -3) log('ошибка загрузки', code, desc, failedUrl);
	});
	wc.on('did-start-loading', () => {
		if (!alive()) return;
		tab.loading = true;
		sendTabs();
		if (tab.id === activeId) sendState();
	});
	wc.on('did-stop-loading', () => {
		if (!alive()) return;
		tab.loading = false;
		sendTabs();
		if (tab.id === activeId) sendState();
	});
	wc.on('zoom-changed', (_e, direction) => {
		if (tab.id === activeId) zoomBy(direction === 'in' ? 1 : -1);
	});
	wc.on('did-navigate', () => {
		const offer = pwOffers.get(tab.id);
		if (offer && Date.now() - offer.at > 120000) pwOffers.delete(tab.id); // после входа часто идут редиректы: предложение живёт, пока человек не ответит (но не вечно)
		restoreZoom(wc);
		// Страница без <title> (404, обычный текст): событие названия не придёт, берём то, что подобрал сам Chromium
		if (!tab.title) tab.title = wc.getTitle();
		onNavigated(tab);
		if (tab.id === activeId) closeFind();
		if (!tab.incognito) store.addVisit(wc.getURL(), wc.getTitle());
	});
	wc.on('did-navigate-in-page', () => onNavigated(tab));
	wc.on('did-start-navigation', (details) => {
		if (!details.isMainFrame || details.isSameDocument) return;
		// Если иконка этого сайта уже известна (и кеш иконок включён), показываем её сразу
		tab.icon = (!tab.incognito && settings().cacheIcons && iconByOrigin.get(originOf(details.url))) || '';
		translator.reset(tab);
		tab.title = ''; // старое название не должно переходить на новую страницу, у которой своего может не быть (например, 404)
		sendTabs();
	});
	wc.on('page-title-updated', (_e, title) => {
		if (!alive()) return;
		tab.title = title;
		if (!tab.incognito) store.updateVisitTitle(wc.getURL(), title);
		if (tab.id === activeId) setWindowTitle(tab);
		sendTabs();
		scheduleSession();
	});
	wc.on('page-favicon-updated', (_e, icons) => {
		if (!alive()) return;
		tab.icon = icons[0] || '';
		if (!tab.incognito) icons.forEach(cache.addIcon);
		if (tab.icon && !tab.incognito) {
			if (iconByOrigin.size > 3000) iconByOrigin.clear();
			iconByOrigin.set(originOf(tab.view.webContents.getURL()), tab.icon);
			fillBookmarkIcons(tab.view.webContents.getURL(), tab.icon);
		}
		sendTabs();
		scheduleSession();
	});
	// DevTools предлагают переключиться на язык «Chrome» и при этом пишут именно «Chrome». Выключаем эту плашку у них же в настройках
	wc.on('devtools-opened', () => {
		const dev = wc.devToolsWebContents;
		if (!dev || dev.isDestroyed()) return;
		const off = () => dev.executeJavaScript(LOCALE_BAR_OFF).catch(() => {});
		off();
		dev.once('dom-ready', off);
	});
	// Ссылка из инструментов разработчика («Открыть в новой вкладке»)
	wc.on('devtools-open-url', (_e, url) => {
		if (/^(https?|file):\/\//i.test(url)) createTab(url, { afterId: tab.id });
	});
	// Страница новой вкладки при загрузке забирает фокус себе: возвращаем его в адресную строку, чтобы можно было сразу печатать
	wc.on('did-finish-load', () => {
		if (settings().pageTranslate && !tab.translated && !tab.translateOff) translator.start(tab, translateTarget());
		if (!tab.incognito) addons.emit('tabUpdated', { id: tab.id, url: wc.getURL(), title: wc.getTitle() });
		if (tab.id === activeId && isNewTab(wc.getURL()) && !parental.check(wc.getURL()) && Date.now() - tab.created < 5000 && win && win.isFocused()) focusAddress();
	});
	// Фон вида — как у страницы (см. syncPageBg); пока новая страница грузится — снова фон темы, чтобы не мигать белым
	wc.on('did-start-navigation', (e) => {
		if (!e.isMainFrame || e.isSameDocument || tab.view.virtual) return;
		tab.pageBg = '';
		tab.view.setBackgroundColor(bgColor());
	});
	wc.on('dom-ready', () => syncPageBg(tab));
	wc.on('did-finish-load', () => syncPageBg(tab));
	wc.on('dom-ready', () => reapplyDark(tab));
	// Включённый блокировщик прячет остатки рекламы на самой странице
	wc.on('dom-ready', () => {
		if (!/^(https?|file):/i.test(wc.getURL())) return;
		if (settings().adblock && (settings().adblockYoutube || !adblock.isYoutubeHost(new URL(wc.getURL()).hostname))) wc.insertCSS(adblock.COSMETIC_CSS).catch(() => {});
		if (settings().hideCookieBanners) wc.insertCSS(adblock.COOKIE_CSS).catch(() => {});
	});
	// Страницы расширений в Chrome Web Store: добавляем свою кнопку «Установить в Problet»
	const STORE_RE = /^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)\//i;
	const injectStoreButton = () => {
		if (safeMode || !STORE_RE.test(wc.getURL())) return;
		wc.executeJavaScript(extensions.storeButton(curLang(), extensions.storeIds())).catch(() => {});
	};
	wc.on('did-finish-load', injectStoreButton);
	// Страница уже показана, но одна из её картинок или скриптов висит и не даёт загрузке закончиться: через 6 секунд после
	// готовности перестаём крутить индикатор и ставим кнопку магазина (сама загрузка продолжается в фоне)
	wc.on('dom-ready', () => {
		const url = wc.getURL();
		setTimeout(() => {
			if (!alive() || wc.getURL() !== url) return;
			injectStoreButton();
			if (tab.loading) {
				tab.loading = false;
				sendTabs();
				if (tab.id === activeId) sendState();
			}
		}, 6000);
	});
	wc.on('did-navigate-in-page', injectStoreButton);
	wc.on('console-message', (e) => {
		const msg = String(e.message || '');
		if (!msg.startsWith('__problet_install__') || !STORE_RE.test(wc.getURL())) return;
		const id = msg.slice(19);
		if (!/^[a-p]{32}$/.test(id)) return;
		extensions.installFromStore(id, process.versions.chrome, log).then((ext) => {
			sendExtActions();
			log('магазин: установлено «' + ext.name + '»');
			wc.executeJavaScript('window.__probletStore&&window.__probletStore.done(' + JSON.stringify(id) + ',true)').catch(() => {});
		}).catch((err) => {
			log('магазин: ошибка установки', err);
			wc.executeJavaScript('window.__probletStore&&window.__probletStore.done(' + JSON.stringify(id) + ',false,' + JSON.stringify(String(err.message || err).slice(0, 80)) + ')').catch(() => {});
		});
	});
	// Вход через сайт расширения Chrome заканчивается переходом на chrome-extension://…/oauth_callback.html: отдаём адрес его фоновому процессу
	const handOver = (url) => {
		const page = extensions.callbackPage(url);
		if (!page) return false;
		log('расширение: передаю адрес входа фоновому процессу');
		wc.loadURL(page).catch(() => {});
		setTimeout(() => { if (alive() && tabs.includes(tab)) closeTab(tab.id); }, 1500);
		return true;
	};
	// Обычная страница уходит на внутреннюю (адрес в строке, переход назад, предупреждение о небезопасном сайте): вкладка становится виртуальной
	if (!wc.virtual) {
		const toVirtual = (url) => {
			setImmediate(() => {
				if (alive()) switchView(tab, url, true);
			});
		};
		// Страница, к которой привязана боковая панель расширения, или вкладка, заведённая расширением, остаётся настоящей:
		// иначе у неё сменился бы номер и расширение её потеряло бы
		const keepReal = () => (!!sideView && wc.id === sideTab) || !!tab.extOwned;
		wc.on('did-start-navigation', (d) => {
			if (d.isMainFrame && !d.isSameDocument && isVirtualFor(tab, d.url) && !(keepReal() && vtab.isVirtualUrl(d.url))) toVirtual(d.url);
		});
		wc.on('will-redirect', (e, url) => {
			if (e.isMainFrame === false || !isVirtualFor(tab, url) || (keepReal() && vtab.isVirtualUrl(url))) return;
			e.preventDefault();
			toVirtual(url);
		});
	}
	wc.on('will-redirect', (e, url) => { if (handOver(url)) e.preventDefault(); });
	wc.on('will-navigate', (e, url) => { if (handOver(url)) e.preventDefault(); });
	wc.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
		if (!isMainFrame || code === -3) return;
		if (handOver(url)) return; 
		wc.loadURL(errorPage(code, description, url)).catch(() => {});
	});
}

// opts: activate (по умолчанию да), lazy (загрузить при первом открытии), afterId, title, icon
function visibleTabs() {
	return tabs.filter((t) => (settings().spacesMerged || t.space === currentSpace) && !t.hidden);
}

function spaceOf(opts) {
	if (opts.space && spaces.some((x) => x.id === opts.space)) return opts.space;
	const from = !settings().spacesMerged && opts.afterId && tabs.find((t) => t.id === opts.afterId);
	return from ? from.space : currentSpace;
}

const sameUrl = (a, b) => a === b || a.replace(/\/$/, '') === b.replace(/\/$/, '');

function createTab(url, opts = {}) {
	// Вкладка, открытая из вкладки инкогнито, тоже инкогнито
	if (opts.incognito === undefined && opts.afterId) {
		const from = tabs.find((t) => t.id === opts.afterId);
		if (from && from.incognito) opts = { ...opts, incognito: true };
	}
	// Свитч «Не открывать вторую идентичную вкладку»: вместо новой переходим в уже открытую с тем же адресом в текущем пространстве (при общем списке — среди всех)
	if (settings().noDuplicateTabs && url && !opts.lazy && !opts.hidden && !opts.duplicate && !startingUp) {
		const same = tabs.find((t) => !t.hidden && (settings().spacesMerged || t.space === currentSpace) && !!t.incognito === !!opts.incognito && sameUrl(t.pendingUrl || t.url, url));
		if (same) {
			activateTab(same.id);
			return same;
		}
	}
	const view = !opts.incognito && !opts.real && vtab.isVirtualUrl(url || '') ? new vtab.VirtualView(vhost) : newRealView({ incognito: !!opts.incognito });
	const tab = { id: nextTabId++, view, title: opts.title || '', url: url || '', icon: opts.icon || '', loading: false, pendingUrl: null, pinned: !!opts.pinned, incognito: !!opts.incognito, space: spaceOf(opts), hidden: !!opts.hidden, created: Date.now(), lastActive: Date.now(), frozen: false, backSegs: [], fwdSegs: [], extOwned: !!opts.extOwned };

	let index = tabs.length;
	if (opts.afterId) {
		const i = tabs.findIndex((t) => t.id === opts.afterId);
		if (i >= 0) index = i + 1;
	}
	// Закреплённые вкладки всегда идут первыми
	index = tab.pinned ? Math.min(index, pinnedCount()) : Math.max(index, pinnedCount());
	tabs.splice(index, 0, tab);
	if (!view.virtual) {
		win.contentView.addChildView(view);
		raiseLayers();
	}
	view.setBounds(pageBounds());
	wireTab(tab);

	if (!tab.incognito && tab.icon && originOf(tab.url)) iconByOrigin.set(originOf(tab.url), tab.icon);
	if (opts.lazy) {
		tab.pendingUrl = url;
		tab.frozen = 'discarded';
	}
	else if (url) view.webContents.loadURL(url).catch(() => {});

	log('новая вкладка', tab.id, url, tab.hidden ? 'без панели' : '', 'пространство', tab.space);
	if (!tab.incognito) addons.emit('tabCreated', { id: tab.id, url: url || '' });
	if (opts.activate !== false) {
		activateTab(tab.id);
	} else {
		sendTabs();
		scheduleSession();
	}
	return tab;
}

function activateTab(id) {
	const tab = tabs.find((t) => t.id === id);
	if (!tab) return;
	if (!tab.view.webContents || tab.view.webContents.isDestroyed()) {
		log('вкладка с уничтоженной страницей убрана', id);
		closeTab(id);
		return;
	}
	hideSuggest();
	if (tab.id !== activeId) { closeFind(); closePanel(); }
	if (!settings().spacesMerged) currentSpace = tab.space;
	if (!tab.hidden) spaceActive[tab.space] = tab.id;
	const prev = activeTab();
	if (prev && prev !== tab) {
		prev.view.setVisible(false);
		prev.lastActive = Date.now();
	}
	tab.lastActive = Date.now();
	if (tab.id !== activeId && !tab.incognito) addons.emit('tabActivated', { id: tab.id });
	if (tab.frozen === 'cdp') thawTab(tab);
	activeId = tab.id;
	for (const h of tabs.filter((t) => t.hidden && t !== tab)) closeTab(h.id); // страница без вкладки живёт, пока на неё смотрят
	tab.view.setVisible(true);
	if (sideView) layout(); // боковая панель расширения видна только на своей вкладке
	if (tab.pendingUrl) {
		const url = tab.pendingUrl;
		tab.pendingUrl = null;
		tab.frozen = false;
		if (!restoreFrozen(tab)) tab.view.webContents.loadURL(url).catch(() => {});
	}
	applySpaceFreeze();
	setWindowTitle(tab);
	if (isNewTab(tab.view.webContents.getURL() || tab.url) && !parental.check(tab.view.webContents.getURL() || tab.url)) focusAddress(); // на заблокированной новой вкладке фокус нужен полю пароля
	else focusWc(tab.view.webContents);
	sendTabs();
	sendState(true, true);
	scheduleSession();
}

// ---------- Заморозка вкладок ----------
// Замороженная вкладка либо приостановлена средствами Chromium (память занята, но скрипты не работают),
// либо, если включена выгрузка, закрывает страницу и загружает её заново при открытии

async function thawTab(tab) {
	if (tab.frozen !== 'cdp') return;
	tab.frozen = false;
	tab.frozenBy = '';
	const wc = tab.view.webContents;
	try {
		await wc.debugger.sendCommand('Page.setWebLifecycleState', { state: 'active' });
	} catch (e) { /* страница уже ушла */ }
	try {
		wc.debugger.detach();
	} catch (e) { /* не была подключена */ }
	sendTabs();
}

function canFreeze(tab) {
	const wc = tab.view.webContents;
	return tab.id !== activeId && !tab.hidden && !tab.frozen && !!wc && !wc.isDestroyed() && /^(https?|file):/i.test(wc.getURL()) && !wc.isCurrentlyAudible() && !wc.isLoading() && !wc.debugger.isAttached();
}

async function freezeTab(tab, by) {
	if (!canFreeze(tab)) return;
	const wc = tab.view.webContents;
	if (settings().freezeDiscard) {
		discardTab(tab);
		return;
	}
	try {
		wc.debugger.attach('1.3');
		await wc.debugger.sendCommand('Page.setWebLifecycleState', { state: 'frozen' });
		tab.frozen = 'cdp';
		tab.frozenBy = by;
		log('вкладка заморожена', tab.id, by);
		if (tab.id === activeId) await thawTab(tab); // пока шла команда, вкладку успели открыть
	} catch (e) {
		try {
			wc.debugger.detach();
		} catch (e2) { /* не подключалась */ }
	}
	sendTabs();
}

// Выгрузка: на месте страницы остаётся пустая, которая загрузит адрес при открытии вкладки (как у вкладок прошлой сессии)
function discardTab(tab) {
	const old = tab.view;
	const url = old.webContents.getURL() || tab.url;
	if (!/^(https?|file):/i.test(url)) return; // внутренние страницы дёшевы, их не трогаем
	// Состояние страницы (история, прокрутка, введённое в поля) уходит на диск и возвращается при открытии вкладки.
	// У инкогнито следов на диске быть не должно: такая вкладка при открытии просто загрузится заново
	tab.frozenFile = '';
	if (!tab.incognito) {
		try {
			const nav = old.webContents.navigationHistory;
			const dir = path.join(app.getPath('userData'), 'frozen');
			fs.mkdirSync(dir, { recursive: true });
			tab.frozenFile = path.join(dir, tab.id + '.json');
			fs.writeFileSync(tab.frozenFile, JSON.stringify({ entries: nav.getAllEntries(), index: nav.getActiveIndex() }));
		} catch (e) {
			log('не удалось сохранить состояние вкладки', tab.id, e);
			tab.frozenFile = '';
		}
	}
	tab.pendingUrl = url;
	tab.frozen = 'discarded';
	tab.loading = false;
	swapView(tab, newRealView(tab));
	log('вкладка выгружена', tab.id, url);
	sendTabs();
}

function dropFrozenFile(tab) {
	if (tab.frozenFile) fs.rm(tab.frozenFile, { force: true }, () => {});
	tab.frozenFile = '';
}

// Возвращаем выгруженную страницу из файла: история и состояние страницы восстанавливаются, а не грузятся с нуля
function restoreFrozen(tab) {
	if (!tab.frozenFile) return false;
	try {
		const saved = JSON.parse(fs.readFileSync(tab.frozenFile, 'utf8'));
		dropFrozenFile(tab);
		if (!Array.isArray(saved.entries) || !saved.entries.length) return false;
		tab.view.webContents.navigationHistory.restore({ entries: saved.entries, index: saved.index }).catch(() => {});
		return true;
	} catch (e) {
		log('не удалось вернуть вкладку', tab.id, e);
		dropFrozenFile(tab);
		return false;
	}
}

// Заморозка по пространствам: вкладки пространств, которые не открыты, замораживаются; у открытого размораживаются
function applySpaceFreeze() {
	const s = settings();
	for (const t of tabs) {
		if (s.freezeSpaces && !s.spacesMerged && t.space !== currentSpace) freezeTab(t, 'space');
		else if (t.frozen === 'cdp' && t.frozenBy === 'space' && (!s.freezeSpaces || s.spacesMerged || t.space === currentSpace)) thawTab(t);
	}
}

// Заморозка по времени: вкладку, которую давно не открывали
function freezeIdle() {
	const min = Number(settings().freezeAfter);
	if (!min || !win || win.isDestroyed()) return;
	const limit = Date.now() - min * 60000;
	for (const t of tabs) if (t.lastActive < limit) freezeTab(t, 'idle');
}
setInterval(freezeIdle, 20000);

function pinnedCount() {
	return tabs.filter((t) => t.pinned).length;
}

function setPinned(id, pinned) {
	const i = tabs.findIndex((t) => t.id === id);
	if (i < 0 || tabs[i].pinned === pinned) return;
	const [tab] = tabs.splice(i, 1);
	tab.pinned = pinned;
	tabs.splice(pinnedCount(), 0, tab); // конец блока закреплённых или начало обычных
	sendTabs();
	scheduleSession();
}

// to — позиция среди остальных вкладок (без перетаскиваемой)
function moveTab(id, to) {
	const i = tabs.findIndex((t) => t.id === id);
	if (i < 0 || !Number.isInteger(to)) return;
	const [tab] = tabs.splice(i, 1);
	// to считается среди видимых вкладок: переводим в позицию общего списка
	const vis = tabs.filter((t) => (settings().spacesMerged || t.space === tab.space) && !t.hidden);
	const at = Math.min(Math.max(0, to), vis.length);
	const target = vis[at];
	if (target) tabs.splice(tabs.indexOf(target), 0, tab);
	else tabs.splice(vis.length ? tabs.indexOf(vis[vis.length - 1]) + 1 : tabs.length, 0, tab);
	const pinned = tabs.filter((t) => t.pinned);
	const rest = tabs.filter((t) => !t.pinned);
	tabs.splice(0, tabs.length, ...pinned, ...rest);
	sendTabs();
	scheduleSession();
}

const closedTabs = []; // недавно закрытые вкладки, последняя в конце
const CLOSED_LIMIT = 15;

function rememberClosed(tab) {
	const url = tab.pendingUrl || tab.view.webContents.getURL() || tab.url;
	if (!url || url === NEWTAB || url.startsWith('view-source:')) return;
	closedTabs.push({ url, title: tab.title, icon: tab.icon, pinned: tab.pinned });
	if (closedTabs.length > CLOSED_LIMIT) closedTabs.shift();
}

function reopenTab(index) {
	const i = Number.isInteger(index) ? index : closedTabs.length - 1;
	const [item] = closedTabs.splice(i, 1);
	if (item) createTab(item.url, { title: item.title, icon: item.icon, pinned: item.pinned });
}

function closeTab(id) {
	const index = tabs.findIndex((t) => t.id === id);
	if (index < 0) return;
	log('закрыта вкладка', id, tabs[index].url, tabs[index].view.webContents ? '' : '(страница уже уничтожена)');
	if (tabs.length > 1 && !tabs[index].incognito && !tabs[index].hidden && tabs[index].view.webContents && !tabs[index].view.webContents.isDestroyed()) rememberClosed(tabs[index]); // адреса из инкогнито не запоминаем
	const vIndex = tabs.filter((t) => (settings().spacesMerged || t.space === tabs[index].space) && !t.hidden).indexOf(tabs[index]);
	const [tab] = tabs.splice(index, 1);
	if (!tab.incognito) addons.emit('tabClosed', { id: tab.id });
	dropFrozenFile(tab);
	pwOffers.delete(tab.id);
	const lastIncognito = tab.incognito && !tabs.some((t) => t.incognito);
	if (!tab.view.virtual) win.contentView.removeChildView(tab.view);
	const dying = tab.view.webContents;
	if (dying && !dying.isDestroyed()) dying.close();
	if (lastIncognito) wipeIncognito();
	if (!tabs.length) {
		win.close();
		return;
	}
	if (tab.id === activeId) {
		activeId = null;
		const same = tabs.filter((t) => (settings().spacesMerged || t.space === tab.space) && !t.hidden);
		const back = tab.hidden ? same.find((t) => t.id === spaceActive[tab.space]) || (settings().spacesMerged ? tabs.find((t) => t.id === spaceActive[tab.space]) : null) : null;
		if (same.length) activateTab((back || same[Math.min(Math.max(0, vIndex), same.length - 1)]).id);
		else createTab(NEWTAB, { space: tab.space }); // пространство опустело — открываем в нём пустую вкладку
	} else if (!visibleTabs().length) {
		createTab(NEWTAB);
	} else {
		sendTabs();
		scheduleSession();
	}
}

function switchTab(delta) {
	const vis = visibleTabs();
	if (vis.length < 2) return;
	const index = vis.findIndex((t) => t.id === activeId);
	activateTab(vis[(index + delta + vis.length) % vis.length].id);
}

// Внутренние страницы открываются отдельной вкладкой (настройки — если включено в них): если она уже есть, переключаемся на неё
function openInternal(name) {
	if (!INTERNAL_PAGES.has(name)) return;
	const url = 'problet://' + name;
	if (name !== 'settings' || settings().settingsAsTab) {
		const existing = tabs.find((t) => (settings().spacesMerged || t.space === currentSpace) && (t.pendingUrl || t.url).startsWith(url));
		if (existing) activateTab(existing.id);
		else createTab(url);
		return;
	}
	navigate(url);
}

let startingUp = false;
function openStartupTabs() {
	fs.rmSync(path.join(app.getPath('userData'), 'frozen'), { recursive: true, force: true }); // файлы выгруженных вкладок живут только до перезапуска
	const s = settings();
	const arg = process.argv.slice(app.isPackaged ? 1 : 2).find((a) => !a.startsWith('-'));
	const saved = store.getSession();
	let list = [];
	let active = 0;
	spaces = saved.spaces;

	if (s.startup === 'session') {
		currentSpace = saved.space;
		list = saved.tabs.map((t) => ({ ...t, restored: true }));
		active = saved.active;
	} else {
		// Закреплённые вкладки возвращаются при любом режиме запуска
		list = saved.tabs.filter((t) => t.pinned).map((t) => ({ ...t, restored: true }));
		active = list.length;
		if (s.startup === 'url' && s.startupUrl) {
			const r = resolveInput(s.startupUrl);
			if (r) list.push({ url: r.url });
		}
	}
	if (arg) {
		const r = resolveInput(arg, true);
		if (r) {
			if (r.search) store.addSearch(r.search);
			list.push({ url: r.url });
			active = list.length - 1;
		}
	}
	if (active >= list.length) list.push({ url: NEWTAB });
	active = Math.min(Math.max(0, active), list.length - 1);

	// Вкладки прошлой сессии, кроме открытой, подгружаются только когда на них перейдут
	startingUp = true;
	list.forEach((item, i) => createTab(item.url, {
		activate: i === active,
		lazy: !!item.restored && i !== active && s.freezeStart,
		title: item.title,
		icon: item.icon,
		pinned: !!item.pinned,
		space: item.space,
	}));
	startingUp = false;
}

// ---------- Обновление открытых страниц браузера при изменении данных ----------

const changedKinds = new Set();
let changeTimer = null;

store.onChange((kind) => {
	if (kind === 'bookmarks' || kind === 'all') sendBar();
	changedKinds.add(kind);
	if (changeTimer) return;
	changeTimer = setTimeout(() => {
		changeTimer = null;
		const kinds = [...changedKinds];
		changedKinds.clear();
		for (const t of tabs) {
			const wc = t.view.webContents;
			if (wc && !wc.isDestroyed() && wc.getURL().startsWith('problet://')) wc.send('data-changed', kinds);
		}
		if (panel && panelOpen) panel.webContents.send('data-changed', kinds);
	}, 250);
});

// Скрипт для DevTools: запоминает «больше не показывать» и закрывает плашку, если она уже успела появиться (при самом первом открытии)
const LOCALE_BAR_OFF = '(' + function () {
	InspectorFrontendHost.setPreference('disable-locale-info-bar', 'true');
	const buttons = (root, out) => {
		if (root.shadowRoot) buttons(root.shadowRoot, out);
		for (const c of root.children || []) {
			if (c.tagName === 'DEVTOOLS-BUTTON') out.push(c);
			buttons(c, out);
		}
		return out;
	};
	const closeBar = () => {
		const all = buttons(document.body, []);
		const match = all.find((b) => /Always match|Switch DevTools/i.test(b.textContent));
		if (!match) return false;
		// Ищем кнопку «Don't show again» в той же плашке, поднимаясь вверх от найденной кнопки
		let node = match;
		for (let i = 0; i < 8 && node; i++) {
			const root = node.getRootNode();
			node = node.parentNode || (root && root.host);
			if (!node || !node.querySelectorAll) continue;
			const hit = buttons(node, []).find((b) => /Don.t show again/i.test(b.textContent));
			if (hit) {
				hit.click();
				return true;
			}
		}
		return false;
	};
	let tries = 0;
	const timer = setInterval(() => {
		if (closeBar() || ++tries > 40) clearInterval(timer);
	}, 250);
}.toString() + ')()';

// ---------- Менеджер паролей ----------

// Пароль, который страница только что отправила и который можно сохранить: { tabId -> { origin, username, password, update } }
const pwOffers = new Map();

function frameOrigin(e) {
	const frame = e.senderFrame;
	if (!frame || frame !== e.sender.mainFrame) return '';
	try {
		const u = new URL(frame.url);
		return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : '';
	} catch (err) {
		return '';
	}
}

function frameOriginOfUrl(url) {
	try {
		return new URL(url).origin;
	} catch (err) {
		return '';
	}
}

const tabOfSender = (e) => tabs.find((t) => t.view.webContents === e.sender) || null;

function offerFor(tab) {
	const o = tab && pwOffers.get(tab.id);
	return o ? { username: o.username, origin: o.origin, update: o.update, unlocked: vault.isUnlocked() } : null;
}

// Страница отправила форму с паролем
ipcMain.on('pw:submit', (e, data) => {
	const tab = tabOfSender(e);
	const origin = frameOrigin(e);
	if (!tab || tab.incognito || !origin || !settings().pwOffer || !data || typeof data !== 'object') return;
	const username = String(data.username || '').slice(0, 300);
	const password = String(data.password || '').slice(0, 1000);
	if (!password) return;
	if (vault.isUnlocked() && vault.has(origin, username, password)) {
		pwOffers.delete(tab.id);
	} else {
		const update = vault.isUnlocked() && vault.hasLogin(origin, username);
		pwOffers.set(tab.id, { origin, username, password, update, at: Date.now() });
	}
	if (tab.id === activeId) {
		sendState();
		if (!panelOpen) openPanel('pwsave', { x: contentSize()[0] - 12, y: toolbarY() + 4, width: 0, height: panelHeight('toolbar') - uiPx(8) });
	}
});

handle('pw:offer-current', () => {
	const tab = activeTab();
	const o = offerFor(tab);
	return o ? { ...o, tabId: tab.id, exists: vault.exists(), min: vault.MIN_MASTER } : null;
});

// Человек нажал на поле входа: показываем окно подстановки (с вводом мастер-пароля, если хранилище закрыто), раз на страницу
const fillAsked = new Set();
let fillCtx = null; // { tabId, origin }: для какой страницы открыто окно подстановки
ipcMain.on('pw:need-fill', (e, hasPass, signup) => {
	const tab = tabOfSender(e);
	const origin = frameOrigin(e);
	if (!tab || !origin || tab.id !== activeId || panelOpen) return;
	// При создании аккаунта предлагаем заготовленные логины (хранилище не нужно), а старые пароли не подставляем
	const templates = !!signup && settings().loginTemplates.length > 0;
	if (!templates) {
		if (!settings().pwFill || !vault.exists()) return;
		if (vault.isUnlocked() && !vault.forOrigin(origin).length) return;
	}
	const key = tab.id + '|' + e.senderFrame.url + '|' + !!hasPass + '|' + templates; // на странице входа в два шага спросим ещё раз, когда появится пароль
	if (fillAsked.has(key)) return;
	if (fillAsked.size > 2000) fillAsked.clear();
	fillAsked.add(key);
	fillCtx = { tabId: tab.id, origin, templates, key };
	openPanel('pwfill', { x: contentSize()[0] - 12, y: toolbarY() + 4, width: 0, height: panelHeight('toolbar') - uiPx(8) });
});
handle('pw:fill-options', () => {
	if (!fillCtx) return null;
	// Сохранённых записей для сайта нет, а шаблонные логины есть — предлагаем их (скорее всего, это новый аккаунт)
	if (!fillCtx.templates && vault.isUnlocked() && !vault.forOrigin(fillCtx.origin).length && settings().loginTemplates.length) fillCtx.templates = true;
	if (fillCtx.templates) return { host: new URL(fillCtx.origin).hostname, templates: true, unlocked: true, items: settings().loginTemplates.map((username, i) => ({ i, username })) };
	const items = vault.isUnlocked() ? vault.forOrigin(fillCtx.origin).map((x, i) => ({ i, username: x.username })) : [];
	// Окно закроется пустым: не считаем, что мы уже спрашивали, иначе на следующем поле (например, почте) ничего не предложим
	if (vault.isUnlocked() && !items.length) fillAsked.delete(fillCtx.key);
	return { host: new URL(fillCtx.origin).hostname, unlocked: vault.isUnlocked(), items };
});
handle('pw:fill-pick', (i) => {
	const tab = fillCtx && tabs.find((t) => t.id === fillCtx.tabId);
	if (!tab || tab.view.webContents.isDestroyed() || frameOriginOfUrl(tab.view.webContents.getURL()) !== fillCtx.origin) throw new Error('Страница уже другая');
	if (fillCtx.templates) {
		const login = settings().loginTemplates[Number(i)];
		if (!login) throw new Error('Логин не найден');
		tab.view.webContents.send('pw:fill', { username: login, password: '' });
		return;
	}
	const entry = vault.forOrigin(fillCtx.origin)[Number(i)];
	if (!entry) throw new Error('Запись не найдена');
	tab.view.webContents.send('pw:fill', { username: entry.username, password: entry.password });
});


function acceptOffer(tabId) {
	const o = pwOffers.get(tabId);
	if (!o) return false;
	if (!vault.isUnlocked()) return false;
	vault.add({ origin: o.origin, username: o.username, password: o.password });
	pwOffers.delete(tabId);
	if (tabId === activeId) sendState();
	return true;
}

// Кнопка-ключ в адресной строке: сохранить сразу, а если хранилище закрыто — открыть менеджер паролей
ipcMain.on('pw-offer-accept', (e) => {
	if (!fromToolbar(e) || !activeId) return;
	if (!acceptOffer(activeId)) openInternal('passwords');
});

const pendingList = () => [...pwOffers.entries()].map(([tabId, o]) => ({ tabId, origin: o.origin, username: o.username, update: o.update }));

function checkMasterArg(v) {
	if (typeof v !== 'string') throw new Error('Некорректный пароль');
	return v;
}

handle('pw:status', () => ({ exists: vault.exists(), unlocked: vault.isUnlocked(), pending: pendingList(), min: vault.MIN_MASTER }));
handle('pw:create', (master) => {
	vault.create(checkMasterArg(master));
	vault.setAutoLock(settings().pwLock);
	sendState();
});
handle('pw:unlock', (master) => {
	vault.unlock(checkMasterArg(master));
	vault.setAutoLock(settings().pwLock);
	sendState();
});
handle('pw:lock', () => {
	vault.lock();
});
handle('pw:list', () => vault.list());
handle('pw:add', (item) => {
	const o = item && typeof item === 'object' ? item : {};
	let origin = '';
	try {
		const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(String(o.origin)) ? String(o.origin) : 'https://' + String(o.origin));
		if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('x');
		origin = u.origin;
	} catch (err) {
		throw new Error('Некорректный адрес сайта');
	}
	return vault.add({ origin, username: o.username, password: o.password });
});
handle('pw:update', (id, patch) => vault.update(String(id), patch && typeof patch === 'object' ? { username: patch.username, password: patch.password } : {}));
handle('pw:remove', (id) => vault.remove(String(id)));
handle('pw:reveal', (id) => vault.reveal(String(id)));
handle('pw:change-master', (oldMaster, newMaster) => vault.changeMaster(checkMasterArg(oldMaster), checkMasterArg(newMaster)));
// Для выгрузки и загрузки паролей мастер-пароль нужен всегда, даже если хранилище уже открыто
function confirmMaster(master) {
	checkMasterArg(master);
	if (!vault.exists()) throw new Error('Хранилища паролей ещё нет');
	if (vault.isUnlocked()) vault.verify(master);
	else vault.unlock(master);
	vault.setAutoLock(settings().pwLock);
}

handle('pw:export', async (master) => {
	confirmMaster(master);
	const entries = vault.all();
	if (!entries.length) throw new Error('В хранилище пока нет паролей');
	const name = 'problet-passwords-' + dateStamp() + '.csv';
	let target;
	if (process.env.PROBLET_TEST_SAVE_DIR) {
		target = path.join(process.env.PROBLET_TEST_SAVE_DIR, name);
	} else {
		const r = await dialog.showSaveDialog(win, { title: 'Экспорт паролей', defaultPath: path.join(app.getPath('documents'), name), filters: [{ name: 'CSV', extensions: ['csv'] }] });
		if (r.canceled || !r.filePath) return { canceled: true };
		target = r.filePath;
	}
	await fs.promises.writeFile(target, passcsv.toCsv(entries), { encoding: 'utf8', mode: 0o600 });
	return { message: 'Паролей выгружено: ' + entries.length + '. Файл не зашифрован, не оставляй его лежать: ' + target };
});

handle('pw:import', async (master) => {
	confirmMaster(master);
	let file = process.env.PROBLET_TEST_IMPORT_FILE;
	if (!file) {
		const r = await dialog.showOpenDialog(win, { title: 'Импорт паролей', properties: ['openFile'], filters: [{ name: 'CSV', extensions: ['csv'] }] });
		if (r.canceled || !r.filePaths[0]) return { canceled: true };
		file = r.filePaths[0];
	}
	const stat = await fs.promises.stat(file);
	if (stat.size > 20 * 1024 * 1024) throw new Error('Файл слишком большой');
	const rows = passcsv.parse(await fs.promises.readFile(file, 'utf8'));
	let added = 0;
	let updated = 0;
	let skipped = 0;
	for (const row of rows) {
		let origin = '';
		try {
			const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(row.url) ? row.url : 'https://' + row.url);
			if (u.protocol === 'http:' || u.protocol === 'https:') origin = u.origin;
		} catch (err) { /* адрес не разобрался */ }
		if (!origin || !row.password) {
			skipped++;
			continue;
		}
		const existed = vault.hasLogin(origin, row.username);
		if (existed && vault.has(origin, row.username, row.password)) {
			skipped++;
			continue;
		}
		vault.add({ origin, username: row.username, password: row.password });
		if (existed) updated++;
		else added++;
	}
	return { message: 'Добавлено: ' + added + ', обновлено: ' + updated + (skipped ? ', пропущено (повторы и неверные адреса): ' + skipped : '') };
});

handle('pw:pending-save', (tabId) => {
	if (!acceptOffer(Number(tabId))) throw new Error('Сначала открой хранилище');
});
handle('pw:pending-drop', (tabId) => {
	pwOffers.delete(Number(tabId));
	sendState();
});

// ---------- Горячие клавиши (назначаются в настройках, см. pages/accel.js) ----------

let capturingHotkey = false; // пока на странице настроек записывают сочетание, команды не выполняем

// Перевод страниц: целевой язык — из настроек, «авто» берёт язык интерфейса
const translator = pageTranslate.create({ onChange: (tab) => { if (tab.id === activeId) sendState(); }, log });
const translateTarget = () => (settings().translateTo && settings().translateTo !== 'auto' ? settings().translateTo : i18nMain.lang());

// Тёмная тема любой страницы: инверсия цветов, повторный вызов возвращает как было
// Фон вида вкладки = фон самой страницы. Ещё не отрисованные при быстрой прокрутке куски Chromium заливает фоном вида:
// с фоном темы на светлых страницах это чёрные полосы. Цвет считается в отдельном мире, страница его не видит и не подменит.
// Учитываем и «тёмную страницу» (фильтр invert + hue-rotate на <html>)
const PAGE_BG_JS = `(() => {
	const parse = (c) => { const m = /rgba?\\(([^)]+)\\)/.exec(c || ''); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
	const html = document.documentElement;
	let c = parse(getComputedStyle(html).backgroundColor);
	if (!c || c.a === 0) c = document.body ? parse(getComputedStyle(document.body).backgroundColor) : null;
	const darkCanvas = /dark/.test(getComputedStyle(html).colorScheme) && matchMedia('(prefers-color-scheme: dark)').matches;
	const base = darkCanvas ? { r: 18, g: 18, b: 18 } : { r: 255, g: 255, b: 255 };
	if (!c || c.a === 0) c = { ...base, a: 1 };
	let r = c.r * c.a + base.r * (1 - c.a), g = c.g * c.a + base.g * (1 - c.a), b = c.b * c.a + base.b * (1 - c.a);
	if (/invert/.test(html.style.filter)) {
		r = 255 - r; g = 255 - g; b = 255 - b;
		const m = [[-0.574, 1.43, 0.144], [0.426, 0.43, 0.144], [0.426, 1.43, -0.856]]; // hue-rotate(180deg)
		[r, g, b] = m.map((row) => row[0] * r + row[1] * g + row[2] * b);
	}
	const hex = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
	return '#' + hex(r) + hex(g) + hex(b);
})()`;
function syncPageBg(tab) {
	if (!tab || !tab.view || tab.view.virtual) return;
	const wc = tab.view.webContents;
	if (wc.isDestroyed()) return;
	// мир 990: ниже миров аддонов (1001 и дальше) и не 999 (мир предзагрузки)
	wc.executeJavaScriptInIsolatedWorld(990, [{ code: PAGE_BG_JS }]).then((hex) => {
		if (!/^#[0-9a-f]{6}$/.test(hex) || !tab.view || tab.view.virtual) return;
		tab.pageBg = hex;
		tab.view.setBackgroundColor(hex);
	}).catch(() => {});
}

// Возвращает true, если тёмная тема страницы теперь включена
const DARK_PAGE_JS = "(document.documentElement.style.filter = document.documentElement.style.filter ? '' : 'invert(1) hue-rotate(180deg)') !== ''";
const DARK_PAGE_ON_JS = "document.documentElement.style.filter = 'invert(1) hue-rotate(180deg)'";
const hostOf = (url) => {
	try {
		return /^https?:$/.test(new URL(url).protocol) ? new URL(url).hostname.toLowerCase() : '';
	} catch (e) {
		return '';
	}
};
// Настройка кнопки «Тёмная тема страницы»: сайт, где её включили, получает её снова после перезагрузки
function rememberDark(url, on) {
	const host = hostOf(url);
	if (!host || !btnOpt('darkpage').remember) return;
	const list = (settings().darkSites || []).filter((h) => h !== host);
	if (on) list.push(host);
	store.setSettings({ darkSites: list });
}
function reapplyDark(tab) {
	const wc = tab.view.webContents;
	const host = hostOf(wc.getURL());
	if (host && btnOpt('darkpage').remember && (settings().darkSites || []).includes(host)) wc.executeJavaScript(DARK_PAGE_ON_JS, true).then(() => syncPageBg(tab)).catch(() => {});
}
// Системный календарь (настройка кнопки «Дата»)
function openSystemCalendar() {
	const { spawn } = require('child_process');
	const fail = () => {
		if (Notification.isSupported()) new Notification({ title: tr('Не нашёл приложение календаря'), silent: true }).show();
	};
	const tryRun = (list) => {
		const [cmd, ...args] = list.shift();
		const p = spawn(cmd, args, { detached: true, stdio: 'ignore' });
		p.on('error', () => (list.length ? tryRun(list) : fail()));
		p.unref();
	};
	if (process.platform === 'win32') shell.openExternal('outlookcal:').catch(fail);
	else if (process.platform === 'darwin') tryRun([['open', '-a', 'Calendar']]);
	else tryRun([['gnome-calendar'], ['merkuro-calendar'], ['kalendar'], ['korganizer'], ['evolution', '-c', 'calendar'], ['thunderbird', '-calendar']]);
}
const ACTION_RUN = {
	darkPage: () => {
		const wc = activeContents();
		if (wc && !wc.getURL().startsWith('problet://')) wc.executeJavaScript(DARK_PAGE_JS, true).then((on) => {
			syncPageBg(activeTab());
			rememberDark(wc.getURL(), !!on);
		}).catch(() => {});
	},
	translate: () => {
		const tab = activeTab();
		if (tab) translator.toggle(tab, translateTarget());
	},
	address: () => focusAddress(),
	newTab: () => createTab(NEWTAB),
	closeTab: () => {
		const tab = activeTab();
		if (tab) closeTab(tab.id);
	},
	nextTab: () => switchTab(1),
	prevTab: () => switchTab(-1),
	nextTab2: () => switchTab(1),
	prevTab2: () => switchTab(-1),
	pin: () => {
		const tab = activeTab();
		if (tab) setPinned(tab.id, !tab.pinned);
	},
	back: () => goBack(),
	forward: () => goForward(),
	reload: () => toggleReload(),
	reload2: () => toggleReload(),
	find: () => openFind(),
	bookmark: () => toggleBookmark().catch((e) => log('закладка', e)),
	bookmarks: () => openInternal('bookmarks'),
	history: () => openInternal('history'),
	downloads: () => openInternal('downloads'),
	offlinePage: () => openInternal('offline'),
	saveOffline: () => {
		const tab = activeTab();
		if (tab) saveOfflineNotify(tab);
	},
	passwords: () => openInternal('passwords'),
	settings: () => openInternal('settings'),
	zoomIn: () => zoomBy(1),
	zoomOut: () => zoomBy(-1),
	zoomReset: () => zoomReset(),
	screenshot: () => screenshotPage(),
	incognito: () => openIncognito(),
	print: () => printPage(),
	pdf: () => pdfPage(),
	reopenTab: () => reopenTab(),
	tabsMenu: () => showTabsMenu(),
	source: () => viewSource(),
	devtools: () => toggleDevTools(),
};

function hotkeyMap() {
	const custom = settings().hotkeys || {};
	const map = new Map();
	for (const a of [...accel.ACTIONS, ...settings().customButtons.map((c) => ({ id: c.id, key: '' }))]) {
		const key = Object.hasOwn(custom, a.id) ? custom[a.id] : a.key;
		if (key) map.set(key, a.id);
	}
	return map;
}

function hotkeys(event, input) {
	if (input.type !== 'keyDown') return;
	if (capturingHotkey) {
		const cur = activeContents();
		if (cur && cur.getURL().startsWith('problet://settings')) return;
		capturingHotkey = false; // страницу настроек уже закрыли
	}
	const combo = accel.fromEvent({ key: input.key, ctrl: input.control, meta: input.meta, alt: input.alt, shift: input.shift });
	if (!combo) return;
	const ctrl = input.control || input.meta;
	let handled = true;
	const id = hotkeyMap().get(combo);
	if (id) {
		if (id.startsWith('cb:')) runCustom(id);
		else ACTION_RUN[id]();
	} else if (ctrl && !input.alt && !input.shift && /^[1-9]$/.test(input.key)) {
		// Ctrl+1…9 — переход к вкладке по номеру, не настраивается
		const vis = visibleTabs();
		const target = vis[input.key === '9' ? vis.length - 1 : Number(input.key) - 1];
		if (target) activateTab(target.id);
	} else {
		handled = false;
	}
	if (handled) event.preventDefault();
}

// ---------- Масштаб ----------

const ZOOM_STEPS = [25, 33, 50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400, 500];
const levelToPercent = (level) => Math.round(Math.pow(1.2, level) * 100);
const percentToLevel = (percent) => Math.log(percent / 100) / Math.log(1.2);

// Масштаб запоминается по сайту (http/https); у внутренних страниц и файлов — только на время работы
function zoomKey(url) {
	try {
		const u = new URL(url);
		return u.protocol === 'http:' || u.protocol === 'https:' ? u.hostname : '';
	} catch (e) {
		return '';
	}
}

function setZoomPercent(wc, percent) {
	const level = percent === 100 ? 0 : percentToLevel(percent);
	wc.setZoomLevel(level);
	const key = zoomKey(wc.getURL());
	if (key && !tabOfContents(wc).incognito) store.setZoom(key, level);
	sendState();
}

function zoomBy(dir) {
	const wc = activeContents();
	if (!wc) return;
	const cur = levelToPercent(wc.getZoomLevel());
	const next = dir > 0 ? ZOOM_STEPS.find((s) => s > cur) : [...ZOOM_STEPS].reverse().find((s) => s < cur);
	if (next) setZoomPercent(wc, next);
}

function zoomReset() {
	const wc = activeContents();
	if (wc) setZoomPercent(wc, 100);
}

// После перехода на сайт возвращаем запомненный для него масштаб
function restoreZoom(wc) {
	const key = zoomKey(wc.getURL());
	if (!key) return;
	const level = store.getZoom(key);
	if (wc.getZoomLevel() !== level) wc.setZoomLevel(level);
}

// ---------- Скриншот, код страницы, инструменты разработчика ----------

const SHOT_MAX_HEIGHT = 16000; // выше видеокарта страницу уже не отдаёт

function printable() {
	const wc = activeContents();
	if (!wc || !win) return null;
	return /^(https?|file|problet):/i.test(wc.getURL()) ? wc : null;
}

// Системное окно печати; если принтеров нет или окно не открылось, предлагаем сохранить PDF
function printPage() {
	const wc = printable();
	if (!wc) return;
	wc.print({ silent: false, printBackground: true }, (ok, reason) => {
		if (!ok && reason && !/cancel/i.test(reason)) pdfPage();
	});
}

async function pdfPage() {
	const wc = printable();
	if (!wc) return;
	try {
		const buf = await wc.printToPDF({ printBackground: true, preferCSSPageSize: true });
		const host = (() => {
			try {
				return new URL(wc.getURL()).hostname || 'page';
			} catch (e) {
				return 'page';
			}
		})();
		const name = 'Problet-' + host + '-' + dateStamp() + '.pdf';
		let target;
		if (process.env.PROBLET_TEST_SAVE_DIR) {
			target = path.join(process.env.PROBLET_TEST_SAVE_DIR, name);
		} else {
			const r = await dialog.showSaveDialog(win, { title: 'Сохранить как PDF', defaultPath: path.join(downloadDir(), name), filters: [{ name: 'PDF', extensions: ['pdf'] }] });
			if (r.canceled || !r.filePath) return;
			target = r.filePath;
		}
		fs.writeFileSync(target, buf);
	} catch (e) {
		dialog.showErrorBox('PDF', 'Не удалось сохранить PDF: ' + ((e && e.message) || e));
	}
}

async function screenshotPage() {
	let wc = activeContents();
	if (!wc || !win) return;
	const url = wc.getURL();
	if (!/^(https?|file|problet):/i.test(url)) return;
	let attached = false;
	let ghostDone = null;
	try {
		// Внутренняя страница целиком снимается с её копии в скрытом окне
		if (wc.virtual) wc = await withGhost(wc, (g, done) => { ghostDone = done; return g; });
		wc.debugger.attach('1.3');
		attached = true;
		const metrics = await wc.debugger.sendCommand('Page.getLayoutMetrics');
		const size = metrics.cssContentSize || metrics.contentSize;
		const width = Math.max(1, Math.ceil(size.width));
		const height = Math.min(SHOT_MAX_HEIGHT, Math.max(1, Math.ceil(size.height)));
		const shot = await wc.debugger.sendCommand('Page.captureScreenshot', {
			format: 'png',
			captureBeyondViewport: true,
			clip: { x: 0, y: 0, width, height, scale: 1 },
		});
		const host = (() => {
			try {
				return new URL(url).hostname || 'page';
			} catch (e) {
				return 'page';
			}
		})();
		const name = 'Problet-' + host + '-' + dateStamp() + '.png';
		let target;
		if (process.env.PROBLET_TEST_SAVE_DIR) {
			target = path.join(process.env.PROBLET_TEST_SAVE_DIR, name);
		} else {
			const r = await dialog.showSaveDialog(win, { title: 'Скриншот страницы', defaultPath: path.join(downloadDir(), name), filters: [{ name: 'PNG', extensions: ['png'] }] });
			if (r.canceled || !r.filePath) return;
			target = r.filePath;
		}
		fs.writeFileSync(target, Buffer.from(shot.data, 'base64'));
	} catch (e) {
		dialog.showErrorBox('Скриншот', 'Не удалось сделать скриншот: ' + ((e && e.message) || e));
	} finally {
		if (attached) {
			try {
				wc.debugger.detach();
			} catch (e) { /* уже отключён */ }
		}
		if (ghostDone) ghostDone();
	}
}

function viewSource() {
	const tab = activeTab();
	if (!tab) return;
	const url = tab.view.webContents.getURL();
	if (/^(https?|file):\/\//i.test(url)) createTab('view-source:' + url, { afterId: tab.id });
}

function toggleDevTools() {
	const wc = activeContents();
	if (!wc) return;
	if (wc.isDevToolsOpened()) wc.closeDevTools();
	else wc.openDevTools({ mode: 'detach' });
}

function errorPage(code, description, url) {
	const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
	const html = '<!doctype html><meta charset="utf-8"><title>' + tr('Ошибка') + '</title><style>'
		+ ':root{color-scheme:dark light}'
		+ 'body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;font:16px system-ui,sans-serif;background:#1e1e20;color:#e4e4e8}'
		+ '@media (prefers-color-scheme:light){body{background:#fbfbfd;color:#2c2c30}}'
		+ 'div{max-width:560px;padding:24px}h2{margin:0 0 12px}p{margin:0 0 8px;word-break:break-all}.u{color:#999}.e{color:#e57373}'
		+ '</style><div><h2>' + tr('Не удалось открыть страницу') + '</h2><p class="u">' + esc(url) + '</p><p class="e">' + esc(description) + ' (' + code + ')</p></div>';
	return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
}

// ---------- Слои поверх страниц ----------

// Список подсказок и панель поиска — отдельные слои поверх страниц, и у каждого свой процесс (около 20 МБ).
// Создаём их при первом обращении, а после паузы закрываем, чтобы они не занимали память впустую
const LAYER_IDLE_MS = 45000;

function createLayer(preload, file) {
	const v = new WebContentsView({ webPreferences: { preload: path.join(__dirname, preload), contextIsolation: true } });
	v.setBackgroundColor(surfaceColor());
	v.setVisible(false);
	win.contentView.addChildView(v);
	v.webContents.on('did-finish-load', () => uiZoom(v.webContents));
	v.webContents.loadFile(file);
	return v;
}

function destroyLayer(v) {
	if (!v) return;
	try {
		win.contentView.removeChildView(v);
	} catch (e) { /* окно уже закрывается */ }
	if (!v.webContents.isDestroyed()) v.webContents.close();
}

let popupTimer = null;
function ensurePopup() {
	clearTimeout(popupTimer);
	if (popup) return;
	const typing = win.webContents.isFocused(); // новый слой забирает фокус у адресной строки: возвращаем
	const keep = () => typing && win && !win.isDestroyed() && !win.webContents.isFocused() && focusWc(win.webContents);
	popup = createLayer('preload-popup.js', 'popup.html');
	popupReady = false;
	keep();
	const mine = popup;
	mine.webContents.once('did-finish-load', () => {
		if (popup !== mine) return;
		popupReady = true;
		keep();
		if (sug.items.length) renderSuggest();
		keep();
		setTimeout(keep, 150);
	});
}

function releasePopup() {
	clearTimeout(popupTimer);
	popupTimer = setTimeout(() => {
		destroyLayer(popup);
		popup = null;
		popupReady = false;
	}, LAYER_IDLE_MS);
}

let findTimer = null;
let findReady = false;

// ---------- Поиск по странице ----------

function layoutFind() {
	if (!findView || !win) return;
	const [w] = contentSize();
	findView.setBounds({ x: Math.max(0, w - uiPx(FIND_WIDTH) - 12 - insets().right), y: insets().top + 6, width: uiPx(FIND_WIDTH), height: uiPx(FIND_HEIGHT) });
}

function showFind() {
	layoutFind();
	win.contentView.addChildView(findView); // поверх страниц
	if (popup) win.contentView.addChildView(popup);
	findView.setVisible(true);
	findView.webContents.send('find-open', findText);
	focusWc(findView.webContents);
}

function openFind() {
	const wc = activeContents();
	if (!wc) return;
	clearTimeout(findTimer);
	findOpen = true;
	if (!findView) {
		findView = createLayer('preload-find.js', 'find.html');
		findReady = false;
		const mine = findView;
		mine.webContents.once('did-finish-load', () => {
			if (findView !== mine) return;
			findReady = true;
			if (findOpen) showFind();
		});
	}
	if (findReady) showFind();
}

function closeFind() {
	if (!findOpen) return;
	findOpen = false;
	if (findView) findView.setVisible(false);
	clearTimeout(findTimer);
	findTimer = setTimeout(() => {
		if (findOpen) return;
		destroyLayer(findView);
		findView = null;
		findReady = false;
	}, LAYER_IDLE_MS);
	const wc = activeContents();
	if (wc) {
		wc.stopFindInPage('clearSelection');
		focusWc(wc);
	}
}

ipcMain.on('find-query', (e, msg) => {
	if (!findView || e.sender !== findView.webContents || !msg || typeof msg.text !== 'string') return;
	const wc = activeContents();
	if (!wc) return;
	findText = msg.text.slice(0, 500);
	if (!findText) {
		wc.stopFindInPage('clearSelection');
		findView.webContents.send('find-result', { active: 0, total: 0 });
		return;
	}
	// В Electron findNext=true начинает новый поиск, а false продолжает текущий
	wc.findInPage(findText, { forward: msg.forward !== false, findNext: !msg.next });
});

ipcMain.on('find-close', (e) => {
	if (findView && e.sender === findView.webContents) closeFind();
});

// ---------- Контекстные меню ----------

function popupMenu(template) {
	Menu.buildFromTemplate(template).popup({ window: win });
}

function showPageMenu(tab, params) {
	const wc = tab.view.webContents;
	const t = [];
	const item = (label, click, enabled = true) => t.push({ label, click, enabled });
	const sep = () => {
		if (t.length && t[t.length - 1].type !== 'separator') t.push({ type: 'separator' });
	};
	const web = (u) => /^(https?|file):\/\//i.test(u || '');

	if (web(params.linkURL)) {
		item('Открыть ссылку в новой вкладке', () => createTab(params.linkURL, { afterId: tab.id }));
		item('Открыть в фоновой вкладке', () => createTab(params.linkURL, { afterId: tab.id, activate: false }));
		item('Открыть ссылку в режиме инкогнито', () => openIncognito(params.linkURL));
		item('Копировать адрес ссылки', () => clipboard.writeText(params.linkURL));
		sep();
	}
	if (params.mediaType === 'image' && web(params.srcURL)) {
		item('Открыть картинку в новой вкладке', () => createTab(params.srcURL, { afterId: tab.id }));
		item('Копировать картинку', () => wc.copyImageAt(params.x, params.y));
		item('Копировать адрес картинки', () => clipboard.writeText(params.srcURL));
		item('Сохранить картинку как…', () => wc.downloadURL(params.srcURL));
		sep();
	}
	if (params.isEditable) {
		const f = params.editFlags;
		t.push({ label: 'Отменить', role: 'undo', enabled: f.canUndo });
		t.push({ label: 'Повторить', role: 'redo', enabled: f.canRedo });
		sep();
		t.push({ label: 'Вырезать', role: 'cut', enabled: f.canCut });
		t.push({ label: 'Копировать', role: 'copy', enabled: f.canCopy });
		t.push({ label: 'Вставить', role: 'paste', enabled: f.canPaste });
		t.push({ label: 'Выделить всё', role: 'selectAll', enabled: f.canSelectAll });
		sep();
	} else if (params.selectionText) {
		const text = params.selectionText.trim().slice(0, 200);
		t.push({ label: 'Копировать', role: 'copy' });
		item('Искать «' + (text.length > 30 ? text.slice(0, 30) + '…' : text) + '»', () => {
			rememberSearch(text, tab);
			createTab(store.searchUrl(text), { afterId: tab.id });
		});
		sep();
	}
	if (!params.isEditable) {
		item('Назад', () => tabBack(tab), canBack(tab));
		item('Вперёд', () => tabForward(tab), canForward(tab));
		item('Обновить', () => wc.reload());
		sep();
		item('Найти на странице', () => openFind());
	}
	sep();
	item('Скриншот страницы', () => screenshotPage());
	item('Печать…', () => printPage());
	item('Сохранить как PDF…', () => pdfPage());
	item('Просмотреть код страницы', () => viewSource(), web(wc.getURL()));
	item('Просмотреть код элемента', () => wc.inspectElement(params.x, params.y));
	popupMenu(t);
}

// Все открытые вкладки списком и недавно закрытые (Ctrl+Shift+A)
function showTabsMenu() {
	const short = (t) => (t.length > 60 ? t.slice(0, 59) + '…' : t);
	const items = visibleTabs().map((t) => ({
		label: short(tabTitle(t) || t.pendingUrl || t.url || tr('Новая вкладка')) + (t.pinned ? ' — ' + tr('закреплена') : ''),
		type: 'checkbox',
		checked: t.id === activeId,
		click: () => activateTab(t.id),
	}));
	items.push({ type: 'separator' });
	items.push({
		label: 'Недавно закрытые',
		enabled: closedTabs.length > 0,
		submenu: closedTabs.map((c, i) => ({ label: short(c.title || c.url), click: () => reopenTab(i) })).reverse(),
	});
	popupMenu(items);
}

function showTabMenu(id) {
	const tab = tabs.find((x) => x.id === id);
	if (!tab) return;
	const vis = visibleTabs();
	const index = vis.indexOf(tab);
	popupMenu([
		{ label: tab.pinned ? 'Открепить вкладку' : 'Закрепить вкладку', click: () => setPinned(tab.id, !tab.pinned) },
		{ label: 'Открыть закрытую вкладку', enabled: closedTabs.length > 0, click: () => reopenTab() },
		{ label: 'Дублировать', click: () => createTab(tab.pendingUrl || tab.view.webContents.getURL() || tab.url, { duplicate: true, afterId: tab.id, title: tab.title, icon: tab.icon }) },
		{ label: 'Обновить', click: () => tab.view.webContents.reload() },
		{ label: 'Переименовать вкладку', click: () => win.webContents.send('tab-rename', tab.id) },
		{ label: 'Сохранить для офлайна', enabled: !tab.incognito && pageTranslate.translatable(tab.view.webContents.getURL()) && /^https?:/i.test(tab.view.webContents.getURL()), click: () => saveOfflineNotify(tab) },
		{ type: 'separator' },
		{ label: 'Закрыть вкладку', click: () => closeTab(tab.id) },
		{ label: 'Закрыть вкладки справа', enabled: vis.slice(index + 1).some((x) => !x.pinned), click: () => vis.slice(index + 1).filter((x) => !x.pinned).forEach((x) => closeTab(x.id)) },
		{ label: 'Закрыть остальные', enabled: vis.some((x) => x !== tab && !x.pinned), click: () => vis.filter((x) => x !== tab && !x.pinned).forEach((x) => closeTab(x.id)) },
	]);
}

// ---------- Страницы для офлайна ----------

offline.init(app.getPath('userData'));

// Одна вкладка → один файл .mhtml. Возвращает { ok } или { ok: false, reason }
async function saveOffline(tab) {
	const wc = tab.view.webContents;
	if (tab.incognito) return { ok: false, reason: 'Из приватного окна страницы не сохраняются' };
	const url = wc.isDestroyed() ? '' : wc.getURL();
	if (!/^https?:\/\//i.test(url)) return { ok: false, reason: 'Сохраняются только страницы из интернета' };
	if (wc.isLoading()) return { ok: false, reason: 'Страница ещё загружается' };
	const slot = offline.reserve();
	try {
		await wc.savePage(slot.file, 'MHTML');
		offline.commit(slot.id, { url, title: tab.title || wc.getTitle() });
		return { ok: true };
	} catch (e) {
		try {
			fs.rmSync(slot.file, { force: true });
		} catch (err) { /* нечего убирать */ }
		return { ok: false, reason: 'Не удалось сохранить: ' + e.message };
	}
}

async function saveOfflineNotify(tab) {
	const r = await saveOffline(tab);
	if (Notification.isSupported()) new Notification({ title: tr(r.ok ? 'Страница сохранена для офлайна' : 'Страница не сохранена'), body: r.ok ? tab.title || tab.view.webContents.getURL() : tr(r.reason), silent: true }).show();
}

handle('offline:list', () => offline.all());
handle('offline:open', (id) => {
	const file = offline.pathOf(String(id));
	if (!file) throw new Error('Файл удалён');
	createTab(pathToFileURL(file).toString(), { activate: true });
});
handle('offline:delete', (id) => offline.remove(String(id)));
handle('offline:save-all', async () => {
	let saved = 0;
	const failed = [];
	for (const tab of tabs.slice()) {
		const url = tab.view.webContents.isDestroyed() ? '' : tab.view.webContents.getURL();
		if (!/^https?:\/\//i.test(url) || tab.incognito) continue;
		const r = await saveOffline(tab);
		if (r.ok) saved++;
		else failed.push((tab.title || url) + ': ' + tr(r.reason));
	}
	return { saved, failed };
});

// ---------- Загрузки ----------

function uniquePath(dir, name) {
	const safe = path.basename(name) || 'download';
	const ext = path.extname(safe);
	const base = path.basename(safe, ext);
	let candidate = path.join(dir, safe);
	for (let i = 1; fs.existsSync(candidate); i++) candidate = path.join(dir, base + ' (' + i + ')' + ext);
	return candidate;
}

function activeDownloads() {
	return downloads.filter((d) => d.state === 'progressing').length;
}

function notifyDownloads() {
	if (win && !win.isDestroyed()) win.webContents.send('downloads-busy', activeDownloads());
}

// Стандартная папка загрузок: выбранная в настройках, если она есть, иначе системная
function downloadDir() {
	const dir = settings().downloadDir;
	try {
		if (dir && fs.statSync(dir).isDirectory()) return dir;
	} catch (e) { /* папку удалили: используем системную */ }
	return app.getPath('downloads');
}

function persistDownloads() {
	store.setDownloads(downloads.filter((d) => d.state !== 'progressing' && !d.incognito).map((d) => ({
		id: d.id, name: d.name, path: d.path, url: d.url, size: d.total || d.received, state: d.state, time: d.time,
	})));
}

function setupDownloads(ses, incognito) {
	if (!incognito) for (const d of store.getDownloads()) downloads.push({ ...d, received: d.size, total: d.size, item: null });

	ses.on('will-download', (_e, item) => {
		const d = {
			id: crypto.randomUUID(), name: item.getFilename() || 'download', path: '', url: item.getURL().slice(0, 2048),
			received: 0, total: item.getTotalBytes(), state: 'progressing', time: Date.now(), item, incognito: !!incognito,
		};
		if (!settings().askDownload) {
			d.path = uniquePath(downloadDir(), d.name);
			d.name = path.basename(d.path);
			item.setSavePath(d.path); // иначе Electron покажет диалог выбора места
		} else {
			item.setSaveDialogOptions({ defaultPath: path.join(downloadDir(), d.name) });
		}
		// Из инкогнито можно переспросить: файл останется на диске и выдаст, что человек что-то качал
		if (incognito && settings().incognitoAsk) {
			item.pause();
			dialog.showMessageBox(win, {
				type: 'question', buttons: ['Скачать', 'Отмена'], defaultId: 1, cancelId: 1,
				message: 'Скачать файл из режима инкогнито?', detail: d.name + '\nФайл останется на компьютере после закрытия инкогнито.',
			}).then((r) => {
				if (r.response === 0) item.resume();
				else item.cancel();
			}).catch(() => item.cancel());
		}
		downloads.unshift(d);
		notifyDownloads();
		item.on('updated', () => {
			d.received = item.getReceivedBytes();
			d.total = item.getTotalBytes();
			const p = item.getSavePath();
			if (p && p !== d.path) {
				d.path = p;
				d.name = path.basename(p);
			}
		});
		item.once('done', (_ev, state) => {
			const p = item.getSavePath();
			if (p) {
				d.path = p;
				d.name = path.basename(p);
			}
			d.received = item.getReceivedBytes();
			d.total = item.getTotalBytes() || d.received;
			d.state = state === 'completed' ? 'done' : state === 'cancelled' ? 'cancelled' : 'failed';
			d.item = null;
			persistDownloads();
			notifyDownloads();
			if (d.state === 'done' && win && !win.isDestroyed()) win.webContents.send('download-done'); // кнопка «Загрузки» может подсветиться
		});
	});
}

function downloadsView() {
	return downloads.map((d) => ({
		id: d.id, name: d.name, url: d.url, received: d.received, total: d.total, state: d.state, time: d.time,
		missing: d.state === 'done' && !!d.path && !fs.existsSync(d.path),
	}));
}

// ---------- Маскировка под браузер и Do Not Track ----------

let profile = null;
let plainProfile = null;
let plainSites = new Set();

function loadPlainSites() {
	plainSites = new Set();
	for (const line of fs.readFileSync(path.join(__dirname, 'plain-ua-sites.txt'), 'utf8').split('\n')) {
		const d = line.trim().toLowerCase();
		if (d && !d.startsWith('#')) plainSites.add(d);
	}
}

function isPlainHost(host) {
	let h = String(host).toLowerCase();
	for (;;) {
		if (plainSites.has(h)) return true;
		const dot = h.indexOf('.');
		if (dot < 0) return false;
		h = h.slice(dot + 1);
	}
}

// Профиль для конкретного адреса: на сайтах-определителях под Problet Chrome в UA не показываем
function profileFor(url) {
	if (!profile || profile.kind !== 'problet') return profile;
	try {
		return isPlainHost(new URL(url).hostname) ? plainProfile : profile;
	} catch (e) {
		return profile;
	}
}

function refreshIdentity() {
	const hide = !!settings().hideSystem;
	profile = identity.build(settings().maskAs, app.getVersion(), false, hide);
	plainProfile = identity.build('problet', app.getVersion(), true, hide);
	session.defaultSession.setUserAgent(profile.userAgent);
	if (incSession) incSession.setUserAgent(profile.userAgent);
	for (const t of tabs) if (t.view.webContents && !t.view.webContents.isDestroyed()) t.view.webContents.setUserAgent(profile.userAgent);
}

function startIdentity(ses) {
	loadPlainSites();
	refreshIdentity();
	attachIdentity(ses, true);
}

// Единственный обработчик заголовков запроса: кеш (только в обычной сессии), затем маскировка и DNT
function attachIdentity(ses, withCache) {
	ses.webRequest.onBeforeSendHeaders({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
		const headers = { ...details.requestHeaders };
		if (withCache) cache.tweakRequest(details, headers);
		identity.applyHeaders(headers, profileFor(details.url), settings().dnt);
		callback({ requestHeaders: headers });
	});
}

// Заглушка вместо рекламы YouTube: односекундное видео «Реклама заблокирована» (pages/adstub.webm). Страница создаёт из него blob:, поэтому отдаём байты
let adStubB64 = null;
ipcMain.on('adblock:youtube', (e) => {
	if (!(settings().adblock && settings().adblockYoutube)) {
		e.returnValue = null;
		return;
	}
	if (adStubB64 === null) {
		try {
			adStubB64 = fs.readFileSync(path.join(__dirname, 'pages', 'adstub.webm')).toString('base64');
		} catch (err) {
			adStubB64 = '';
		}
	}
	e.returnValue = { stub: adStubB64 };
});

ipcMain.on('identity:get', (e) => {
	e.returnValue = identity.pagePayload(profileFor((e.senderFrame && e.senderFrame.url) || e.sender.getURL()) || identity.build('problet', app.getVersion(), false, !!settings().hideSystem), settings().dnt);
});

// ---------- Тема и применение настроек ----------

function broadcastTheme() {
	const payload = themeMsg();
	if (win && !win.isDestroyed()) win.webContents.send('theme', payload);
	if (popup) popup.webContents.send('theme', payload);
	if (findView) findView.webContents.send('theme', payload);
	if (panel) panel.webContents.send('theme', payload);
	for (const t of tabs) if (t.view.webContents && !t.view.webContents.isDestroyed()) t.view.webContents.send('theme', payload);
}

let mergedWas = null;
function applySettings() {
	const s = settings();
	vault.setAutoLock(s.pwLock);
	refreshIdentity();
	nativeTheme.themeSource = s.darkTheme ? 'dark' : 'light';
	win.setBackgroundColor(bgColor());
	if (popup) popup.setBackgroundColor(surfaceColor());
	if (findView) findView.setBackgroundColor(surfaceColor());
	if (panel) panel.setBackgroundColor(bgColor());
	for (const v of [win, popup, findView, panel, tipView]) if (v) uiZoom(v.webContents);
	for (const t of tabs) {
		t.view.setBackgroundColor(t.pageBg || bgColor());
		if (t.view.virtual) t.view.webContents.refreshZoom(); // масштаб интерфейса делится обратно у внутренних страниц
	}
	vtBounds = '';
	vhost.bounds();
	broadcastTheme();
	if (mergedWas !== s.spacesMerged) {
		mergedWas = s.spacesMerged;
		const cur = activeTab();
		if (!s.spacesMerged && cur && !cur.hidden) currentSpace = cur.space; // обычный режим: пространство — то, где лежит открытая вкладка
		store.notify('spaces');
	}
	applySpaceFreeze();
	sendLayout();
	layout();
	sendTabs();
	cache.checkRetention();
}

ipcMain.on('theme:get', (e) => {
	e.returnValue = themeMsg();
});

// ---------- Подсказки в адресной строке ----------

function buildSuggestions(text) {
	const q = text.trim();
	const items = [];
	const s = settings();
	const max = Number(s.suggestCount) || MAX_SUGGESTIONS;
	// «w кошки» — сначала строка «Искать в Википедии»
	const kw = q ? store.keywordSearch(q) : null;
	if (kw) items.push({ type: 'keyword', text: q, label: kw.keyword.name, query: kw.query });
	const calc = q && s.calcSuggest ? tryCalc(q) : null;
	if (calc !== null) items.push({ type: 'calc', text: calc, label: q });
	const searches = s.searchSuggest ? store.searchSuggestions(q, max) : [];
	const pages = q && s.urlSuggest ? store.searchVisits(q, 12).filter((p) => !store.isSearchUrl(p.url)).slice(0, Math.max(2, Math.round(max / 2))) : [];
	// Подсказки поисковика приходят позже и встают после истории поиска
	const remote = q && !kw && s.engineSuggest ? (engineSug.cache.get(engineSug.key(q)) || []).filter((t) => t.toLowerCase() !== q.toLowerCase() && !searches.includes(t)) : [];
	const roomForSearches = Math.max(1, max - items.length - pages.length - Math.min(remote.length, Math.ceil(max / 3)));
	for (const h of searches.slice(0, roomForSearches)) items.push({ type: 'history', text: h });
	for (const t of remote.slice(0, Math.max(0, max - items.length - pages.length))) items.push({ type: 'remote', text: t });
	for (const p of pages) items.push({ type: 'page', text: p.url, label: p.title });
	return items.slice(0, max);
}

// ---------- Подсказки поисковика ----------

// Адреса подсказок у поисковиков (формат OpenSearch: [запрос, [подсказки…]])
const SUGGEST_URLS = {
	duckduckgo: 'https://duckduckgo.com/ac/?type=list&q=%s',
	google: 'https://suggestqueries.google.com/complete/search?client=firefox&q=%s',
	brave: 'https://search.brave.com/api/suggest?q=%s',
	bing: 'https://api.bing.com/osjson.aspx?query=%s',
	yandex: 'https://suggest.yandex.ru/suggest-ff.cgi?part=%s',
};
const engineSug = {
	cache: new Map(),
	key: (q) => settings().engine + ' ' + q.trim().toLowerCase(),
	timer: null,
	seq: 0,
};
function requestEngineSuggest(q) {
	clearTimeout(engineSug.timer);
	const s = settings();
	const tpl = SUGGEST_URLS[s.engine];
	const text = q.trim();
	if (!s.engineSuggest || !tpl || !text || text.length > 200 || store.keywordSearch(text) || /^[a-z][a-z0-9+.-]*:/i.test(text)) return;
	const key = engineSug.key(text);
	if (engineSug.cache.has(key)) return;
	const seq = ++engineSug.seq;
	// ждём паузу в наборе, чтобы не слать запрос на каждую букву
	engineSug.timer = setTimeout(async () => {
		const ctl = new AbortController();
		const timeout = setTimeout(() => ctl.abort(), 2500);
		try {
			const res = await net.fetch((process.env.PROBLET_TEST_SUGGEST_URL || tpl).split('%s').join(encodeURIComponent(text)), { signal: ctl.signal, bypassCustomProtocolHandlers: true, headers: { accept: 'application/json' } });
			const buf = Buffer.from(await res.arrayBuffer());
			let body;
			try {
				body = JSON.parse(buf.toString('utf8'));
			} catch (e) {
				body = JSON.parse(new TextDecoder('windows-1251').decode(buf)); // Яндекс иногда отвечает не в UTF-8
			}
			const list = (Array.isArray(body) && Array.isArray(body[1]) ? body[1] : []).filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim().slice(0, 200)).slice(0, 10);
			if (engineSug.cache.size > 300) engineSug.cache.clear();
			engineSug.cache.set(key, list);
			// пока ждали ответ, человек мог набрать дальше — тогда подсказки не к месту
			if (seq === engineSug.seq && sug.live && sug.original.trim() === text && sug.selected === -1) {
				sug.items = buildSuggestions(sug.original);
				renderSuggest();
			}
		} catch (e) { /* поисковик недоступен: обходимся без его подсказок */ } finally {
			clearTimeout(timeout);
		}
	}, 180);
}

function renderSuggest() {
	if (!sug.items.length) {
		hideSuggest(true); // набор продолжается: подсказки поисковика ещё могут прийти
		return;
	}
	ensurePopup();
	if (!popupReady) return; // покажем, как только слой загрузится
	const height = uiPx(sug.items.length * ROW_HEIGHT + POPUP_PADDING * 2);
	popup.setBounds({
		x: sug.x,
		y: toolbarTop() !== null ? toolbarTop() + panelHeight('toolbar') - 2 : toolbarY() - height + 2, // сразу под адресной строкой, а если панель инструментов под страницей — над ней
		width: sug.width,
		height,
	});
	popup.setVisible(true);
	popup.webContents.send('render', { items: sug.items, selected: sug.selected });
	win.webContents.send('suggest-visible', true);
}

// typing — окошко прячется, пока подсказок нет, но человек ещё набирает
function hideSuggest(typing) {
	if (typing !== true) sug.live = false; // запоздавшие подсказки поисковика больше не показываем
	sug.items = [];
	sug.selected = -1;
	if (popup) {
		popup.setVisible(false);
		releasePopup();
	}
	if (win && !win.isDestroyed()) win.webContents.send('suggest-visible', false);
}

const fromToolbar = (e) => !!win && e.sender === win.webContents;
const fromPopup = (e) => !!popup && e.sender === popup.webContents;

ipcMain.on('suggest-query', (e, msg) => {
	if (!fromToolbar(e) || !msg || typeof msg.text !== 'string') return;
	if (!Number.isFinite(msg.x) || !Number.isFinite(msg.width)) return;
	sug.original = msg.text;
	sug.live = true;
	sug.x = uiPx(msg.x);
	sug.width = uiPx(msg.width);
	sug.items = buildSuggestions(msg.text);
	sug.selected = -1;
	renderSuggest();
	requestEngineSuggest(msg.text);
});

ipcMain.on('suggest-move', (e, dir) => {
	if (!fromToolbar(e) || !sug.items.length) return;
	const n = sug.items.length;
	let i = sug.selected + (dir > 0 ? 1 : -1);
	if (i >= n) i = -1;
	if (i < -1) i = n - 1;
	sug.selected = i;
	win.webContents.send('set-address', { text: i >= 0 ? sug.items[i].text : sug.original, select: false });
	renderSuggest();
});

ipcMain.on('suggest-hide', (e) => {
	if (fromToolbar(e)) hideSuggest();
});

ipcMain.on('popup-pick', (e, i) => {
	if (!fromPopup(e)) return;
	const item = sug.items[i];
	if (!item) return;
	hideSuggest();
	if (item.type === 'page') {
		loadInActive(item.text);
	} else if (item.type === 'keyword') {
		navigate(item.text);
	} else if (item.type === 'calc') {
		// Результат калькулятора кладём в адресную строку, чтобы его можно было скопировать
		focusWc(win.webContents);
		win.webContents.send('set-address', { text: item.text, select: true });
	} else {
		searchFor(item.text);
	}
});

ipcMain.on('popup-delete', (e, i) => {
	if (!fromPopup(e)) return;
	const item = sug.items[i];
	if (!item || item.type !== 'history') return;
	store.removeSearch(item.text);
	sug.items = buildSuggestions(sug.original);
	sug.selected = -1;
	focusWc(win.webContents);
	win.webContents.send('set-address', { text: sug.original, select: false });
	renderSuggest();
});

// ---------- Команды тулбара ----------

ipcMain.on('go', (e, text) => {
	if (fromToolbar(e)) navigate(text);
});
ipcMain.on('back', (e) => fromToolbar(e) && goBack());
ipcMain.on('forward', (e) => fromToolbar(e) && goForward());
ipcMain.on('reload', (e) => fromToolbar(e) && toggleReload());
ipcMain.on('toggle-bookmark', (e) => fromToolbar(e) && toggleBookmark().catch((err) => log('закладка', err)));
ipcMain.on('open-internal', (e, name) => fromToolbar(e) && openInternal(name));
ipcMain.on('tab-new', (e) => fromToolbar(e) && (btnOpt('newtab').incognito ? openIncognito() : createTab(NEWTAB)));
ipcMain.on('open-calendar', (e) => fromToolbar(e) && openSystemCalendar());
ipcMain.on('tab-activate', (e, id) => fromToolbar(e) && activateTab(id));
ipcMain.on('tab-close', (e, id) => fromToolbar(e) && closeTab(id));
ipcMain.on('tab-menu', (e, id) => fromToolbar(e) && showTabMenu(id));
ipcMain.on('tab-rename', (e, id, name) => {
	if (!fromToolbar(e)) return;
	const tab = tabs.find((x) => x.id === id);
	if (!tab) return;
	tab.customTitle = typeof name === 'string' ? name.trim().slice(0, 300) : ''; // пустое имя возвращает название страницы
	sendTabs();
});
// Растягивание панели вкладок мышью
ipcMain.on('tabs-scale', (e, v) => {
	if (!fromToolbar(e) || typeof v !== 'number' || safeMode) return;
	try {
		store.setSettings({ tabsScale: v });
		applySettings();
	} catch (err) { /* значение вне допустимого — оставляем как есть */ }
});
// Свои кнопки: адрес, скрипт на открытой странице или команда браузера из списка горячих клавиш
function runCustom(id) {
	const c = settings().customButtons.find((x) => x.id === id);
	if (!c) return;
	if (c.type === 'url') {
		if (c.newTab) createTab(c.value, { activate: true });
		else loadInActive(c.value);
	} else if (c.type === 'script') {
		const wc = activeContents();
		if (wc && !wc.getURL().startsWith('problet://')) wc.executeJavaScript(c.value, true).catch(() => {});
	} else if (ACTION_RUN[c.value]) {
		ACTION_RUN[c.value]();
	}
}
ipcMain.on('custom-button', (e, id) => fromToolbar(e) && runCustom(id));
ipcMain.on('dark-page', (e) => fromToolbar(e) && ACTION_RUN.darkPage());
ipcMain.on('translate-page', (e) => fromToolbar(e) && ACTION_RUN.translate());
ipcMain.on('tab-move', (e, id, to) => fromToolbar(e) && moveTab(id, to));

// ---------- Подсказка у иконки обновления ----------
// Обычный title не обновляется, пока на него наведён курсор, поэтому рисуем свою маленькую панельку поверх страниц

let tipView = null;
let tipRect = null;

function tipContent(st) {
	if (!st) return null;
	if (st.status === 'downloading') return { text: 'Скачивается версия ' + st.version + ': ' + st.progress + '%', progress: st.progress };
	if (st.status === 'ready') return { text: st.mode === 'dmg' ? 'Версия ' + st.version + ' скачана: открыть установщик' : 'Обновить до ' + st.version + ' и перезапустить' };
	if (st.status === 'available') return { text: 'Доступна версия ' + st.version + (st.mode === 'page' ? ': открыть страницу загрузки' : ': скачать и установить') };
	return null;
}

let tipTimer = null;
let tipReady = false;
let tipJs = '';
function ensureTip() {
	clearTimeout(tipTimer);
	if (tipView) return;
	const t = themePayload(settings());
	const html = '<!doctype html><meta charset="utf-8"><style>html,body{margin:0;height:100%;overflow:hidden}'
		+ 'body{box-sizing:border-box;padding:8px 12px;font:13px system-ui,sans-serif;background:' + t.vars['--surface'] + ';color:' + t.vars['--text'] + ';border:1px solid ' + t.vars['--border-strong'] + ';border-radius:8px}'
		+ '#b{height:4px;margin-top:6px;border-radius:2px;background:rgba(128,128,128,.3);overflow:hidden}#p{height:100%;width:0;background:' + t.accent + ';transition:width .3s}</style>'
		+ '<div id="t"></div><div id="b"><div id="p"></div></div>';
	tipView = new WebContentsView({ webPreferences: { contextIsolation: true, sandbox: true } });
	tipView.setBackgroundColor('#00000000');
	tipView.setVisible(false);
	win.contentView.addChildView(tipView);
	tipReady = false;
	const mine = tipView;
	mine.webContents.once('did-finish-load', () => {
		if (tipView !== mine) return;
		tipReady = true;
		if (tipJs) mine.webContents.executeJavaScript(tipJs).catch(() => {});
	});
	tipView.webContents.on('did-finish-load', () => uiZoom(tipView && tipView.webContents));
	tipView.webContents.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
}

function refreshTip() {
	if (!tipRect || !win || win.isDestroyed()) return;
	const c = tipContent(updater.getState());
	if (!c) return hideTip();
	ensureTip();
	const [cw, ch] = contentSize();
	const w = uiPx(270);
	const h = uiPx(c.progress === undefined ? 34 : 50);
	const below = tipRect.y + tipRect.height + 6;
	tipView.setBounds({ x: Math.round(Math.min(Math.max(8, tipRect.x + tipRect.width / 2 - w / 2), cw - w - 8)), y: Math.round(below + h <= ch ? below : Math.max(0, tipRect.y - h - 6)), width: w, height: h });
	win.contentView.addChildView(tipView);
	tipView.setVisible(true);
	const js = 'document.getElementById("t").textContent=' + JSON.stringify(c.text) + ';document.getElementById("b").style.display=' + (c.progress === undefined ? '"none"' : '"block"') + ';document.getElementById("p").style.width="' + (c.progress || 0) + '%"';
	tipJs = js;
	if (tipReady) tipView.webContents.executeJavaScript(js).catch(() => {});
}

function hideTip() {
	tipRect = null;
	if (!tipView) return;
	tipView.setVisible(false);
	clearTimeout(tipTimer);
	tipTimer = setTimeout(() => {
		destroyLayer(tipView);
		tipView = null;
		tipReady = false;
	}, LAYER_IDLE_MS);
}

ipcMain.on('update-tip', (e, rect) => {
	if (!fromToolbar0(e)) return;
	if (rect && Number.isFinite(rect.x) && Number.isFinite(rect.y)) {
		tipRect = uiRect({ x: rect.x, y: rect.y, width: Number(rect.width) || 0, height: Number(rect.height) || 0 });
		refreshTip();
	} else hideTip();
});

// ---------- Пространства и всплывающие апплеты ----------

let panel = null;
let panelOpen = false;
let panelKind = '';
let panelReturn = 'tab';
let panelClosedAt = 0;
let panelOpenedAt = 0;
const PANEL_SIZE = { bmstar: [340, 250], chars: [352, 460], pwsave: [340, 290], pwfill: [340, 260], folder: [320, 0], ext: [380, 440] };
let panelArg = '';

let panelTimer = null;
function ensurePanel() {
	clearTimeout(panelTimer);
	if (panel && panel.webContents.isDestroyed()) {
		panel = null; // страница расширения закрыла своё окошко сама (window.close)
		panelOpen = false;
	}
	if (panel) return;
	panel = new WebContentsView({
		webPreferences: { preload: path.join(__dirname, 'preload-page.js'), contextIsolation: true, sandbox: true },
	});
	panel.setBackgroundColor(bgColor());
	panel.setVisible(false);
	win.contentView.addChildView(panel);
	const made = panel;
	panel.webContents.on('did-finish-load', () => uiZoom(made.webContents)); // масштаб хранится по адресу страницы: у новой страницы окошка его надо выставить заново
	panel.webContents.on('destroyed', () => {
		if (panel !== made) return;
		try {
			win.contentView.removeChildView(made);
		} catch (e) { /* окно уже закрывается */ }
		panel = null;
		panelOpen = false;
	});
	// Потеря фокуса закрывает панель, но не пока она грузится: при загрузке страницы фокус на миг сбрасывается
	panel.webContents.on('blur', () => {
		if (!panelOpen || panel.webContents.isLoading() || Date.now() - panelOpenedAt < (panelKind === 'pwsave' ? 5000 : 500)) return; // предложение сохранить пережить редирект после входа
		closePanel();
	});
	panel.webContents.on('did-finish-load', () => {
		if (panelOpen && panelKind !== 'pwsave') focusWc(panel.webContents);
	});
}

function closePanel() {
	if (!panelOpen) return;
	panelOpen = false;
	panelClosedAt = Date.now();
	panel.setVisible(false);
	clearTimeout(panelTimer);
	panelTimer = setTimeout(() => {
		if (panelOpen) return;
		destroyLayer(panel);
		panel = null;
	}, LAYER_IDLE_MS);
	const back = panelReturn === 'toolbar' ? win.webContents : activeContents();
	if (back && !back.isDestroyed() && !win.webContents.isFocused() && !(back === win.webContents)) focusWc(back);
}

// rect — положение кнопки в окне; без неё панель встаёт у верхнего края
function openPanel(kind, rect, arg = '') {
	if (!PANEL_SIZE[kind] || !win || win.isDestroyed()) return;
	if (panelOpen && panelKind === kind && panelArg === arg) {
		closePanel();
		return;
	}
	if (kind === panelKind && panelArg === arg && Date.now() - panelClosedAt < 300) return; // клик по кнопке закрыл панель потерей фокуса
	ensurePanel();
	// Куда вернуть фокус и вставить символ: в адресную строку, только если курсор стоял в ней, иначе в страницу (кнопка на панели сама забирает фокус окна)
	panelReturn = rect && typeof rect.addr === 'boolean' ? (rect.addr ? 'toolbar' : 'tab') : win.webContents.isFocused() ? 'toolbar' : 'tab';
	const [w0, h0] = PANEL_SIZE[kind];
	const w = uiPx(w0);
	const h = uiPx(kind === 'folder' ? Math.min(440, 112 + Math.max(1, folderItems(arg).length) * 36) : h0); // шапка и подвал плюс строки закладок
	const place = (pw, ph) => {
		const [cw, ch] = contentSize();
		const r = rect && Number.isFinite(rect.x) ? rect : { x: cw / 2 - pw / 2, y: insets().top - 4, width: 0, height: 0 };
		const x = Math.round(Math.min(Math.max(8, r.x + r.width / 2 - pw / 2), Math.max(8, cw - pw - 8)));
		const y = Math.round(Math.min(r.y + r.height + 4, Math.max(0, ch - 120)));
		panel.setBounds({ x, y, width: pw, height: Math.min(ph, Math.max(160, ch - y - 8)) });
		uiZoom(panel.webContents);
	};
	place(w, h);
	panelKind = kind;
	panelArg = arg;
	panelOpen = true;
	panelOpenedAt = Date.now();
	win.contentView.addChildView(panel);
	panel.setVisible(true);
	if (kind === 'ext') {
		// окошко расширения само не сообщает размер: меряем страницу после загрузки
		const mine = panel;
		mine.webContents.once('did-finish-load', async () => {
			await new Promise((r) => setTimeout(r, 400));
			if (!panelOpen || panel !== mine || panelArg !== arg) return;
			try {
				const d = await mine.webContents.executeJavaScript('[document.documentElement.scrollWidth, document.documentElement.scrollHeight]');
				place(uiPx(Math.min(720, Math.max(280, d[0]))), uiPx(Math.min(600, Math.max(120, d[1]))));
			} catch (e) { /* остаётся прежний размер */ }
		});
		// В Electron у расширений нет chrome.runtime.openOptionsPage: подставляем своё, оно открывает страницу настроек вкладкой
		const options = extPage(arg, 'options');
		mine.webContents.setWindowOpenHandler(({ url }) => {
			if (/^(chrome-extension|problet-addon|https?):\/\//.test(url)) {
				createTab(url, { activate: true });
				closePanel();
			}
			return { action: 'deny' };
		});
		mine.webContents.once('dom-ready', () => {
			if (!options || arg.startsWith('@') || mine.webContents.isDestroyed()) return;
			mine.webContents.executeJavaScript('try{chrome.runtime.openOptionsPage=(cb)=>{window.open(' + JSON.stringify(options) + ');if(typeof cb==="function")cb();return Promise.resolve()}}catch(e){}').catch(() => {});
		});
		panel.webContents.loadURL(extPage(arg, 'popup')).catch(() => {});
	} else panel.webContents.loadURL('problet://' + kind + '/?popup=1' + (arg ? '&id=' + encodeURIComponent(arg) : '')).catch(() => {});
	if (kind !== 'pwsave') focusWc(panel.webContents);
}

ipcMain.on('applet-open', (e, kind, rect) => {
	if (!fromToolbar0(e)) return;
	if (kind === 'spaces') openSpacesApplet();
	else openPanel(kind, uiRect(rect));
});

// Апплет пространств: страница; если так выбрано в настройках, у неё нет вкладки в панели
function openSpacesApplet() {
	const url = 'problet://spaces';
	const existing = tabs.find((t) => (settings().spacesMerged || t.space === currentSpace) && (t.pendingUrl || t.url).startsWith(url));
	if (existing) activateTab(existing.id);
	else createTab(url, { hidden: settings().spacesPopup });
}

function spacesState() {
	return { spaces: spaces.map((x) => ({ ...x, count: tabs.filter((t) => t.space === x.id).length })), current: currentSpace };
}

function spacesChanged() {
	sendTabs();
	scheduleSession();
	store.notify('spaces');
}

function switchSpace(id) {
	if (!spaces.some((x) => x.id === id) || id === currentSpace) return;
	if (settings().spacesMerged) {
		currentSpace = id; // вкладки видны все, пространство лишь выбирает, где создаются новые
		sendTabs();
		scheduleSession();
		store.notify('spaces');
		return;
	}
	const list = tabs.filter((t) => t.space === id);
	const remembered = list.find((t) => t.id === spaceActive[id]);
	if (remembered || list.length) activateTab((remembered || list[list.length - 1]).id);
	else {
		currentSpace = id;
		createTab(NEWTAB, { space: id });
	}
	applySpaceFreeze();
	store.notify('spaces');
}

const cleanSpaceName = (n) => String(n || '').replace(/\s+/g, ' ').trim().slice(0, 40);

// ---------- API для внутренних страниц (настройки, закладки, новая вкладка) ----------

function guard(e) {
	const frame = e.senderFrame;
	if (win && e.sender === win.webContents && vtabOfFrame(frame) && frame.url.startsWith(vtab.FRAME_BASE)) return; // рамка внутренней страницы в окне панели
	const isTab = tabs.some((t) => t.view.webContents === e.sender) || (!!panel && e.sender === panel.webContents) || ghosts.has(e.sender);
	if (!isTab || !frame || frame !== e.sender.mainFrame || !frame.url.startsWith('problet://')) {
		throw new Error('Доступ запрещён');
	}
}

function handle(channel, fn) {
	ipcMain.handle(channel, (e, ...args) => {
		guard(e);
		return fn(...args);
	});
}

function dateStamp() {
	const d = new Date();
	const p = (n) => String(n).padStart(2, '0');
	return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

// Меняет закладки и сразу обновляет звёздочку в тулбаре
function bookmarksAction(fn) {
	fn();
	sendState();
	return store.bookmarksState();
}

handle('folder:open', (url, newTab) => {
	const b = store.bookmarksState().bookmarks.find((x) => x.url === url);
	if (!b) return;
	closePanel();
	openBookmarkUrl(b.url, !!newTab);
});
handle('folder:open-all', (id) => {
	closePanel();
	openFolderAll(String(id));
});
handle('folder:delete', (id) => removeFolderAsk(String(id)));
handle('folders:color', (id, color) => bookmarksAction(() => store.setFolderColor(id, color)));
handle('hotkeys:capture', (on) => {
	capturingHotkey = !!on;
});
ipcMain.on('zoom-reset', (e) => fromToolbar(e) && zoomReset());
// Меню отладки на странице problet://version/: действия вызываются только оттуда
const DEBUG_ASK = {
	'reset-settings': 'Сбросить все настройки к значениям по умолчанию? Закладки, история и пароли останутся.',
	'remove-extensions': 'Удалить все расширения вместе с их файлами?',
	'clear-site-data': 'Удалить все данные сайтов (куки, локальные хранилища, базы, кеш сервис-воркеров)? Придётся входить на сайты заново.',
	'clear-cookies': 'Удалить все куки? Придётся входить на сайты заново.',
};
// ---------- Родительский контроль ----------
function parentalGate(url) {
	const why = parental.check(url);
	if (!why) return null;
	parental.recordAttempt(url, why);
	return 'problet://parental/?u=' + encodeURIComponent(url) + '&r=' + why;
}
// Правила поменялись, время вышло или контроль выключили: вкладки, которые теперь нельзя смотреть, перезагружаем (их перехватит проверка),
// а вкладки со страницей блокировки, которые теперь можно, возвращаем туда, куда шли
function parentalApply() {
	for (const t of tabs) {
		const wc = t.view.webContents;
		if (t.pendingUrl || !wc || wc.isDestroyed()) continue;
		const url = wc.getURL();
		let target = '';
		try {
			const u = new URL(url);
			if (u.protocol === 'problet:' && u.host === 'parental') target = u.searchParams.get('u') || '';
		} catch (e) { /* пустая вкладка */ }
		if (target || t.parentalBlocked) {
			const to = target || url;
			if (parental.check(to)) continue;
			t.parentalBlocked = false;
			if (target) wc.loadURL(to).catch(() => {});
			else wc.reload(); // блокировка показана на месте страницы Problet
			continue;
		}
		if (!parental.check(url)) continue;
		if (t.view.virtual) wc.reload();
		else wc.loadURL(url).catch(() => {});
	}
}
// Учёт времени: считается, пока окно в фокусе или на какой-нибудь вкладке играет звук
const PARENTAL_TICK = 5000;
setInterval(() => {
	if (!parental.isOn() || !win || win.isDestroyed()) return;
	const audible = tabs.find((t) => !t.view.virtual && !t.view.webContents.isDestroyed() && t.view.webContents.isCurrentlyAudible());
	const focused = win.isFocused() && !win.isMinimized();
	if (!focused && !audible) return;
	const tab = focused ? activeTab() : audible;
	const key = tab && !tab.view.webContents.isDestroyed() ? parental.checkable(tab.view.webContents.getURL()) : '';
	if (parental.tick(PARENTAL_TICK, key)) parentalApply();
}, PARENTAL_TICK).unref();

handle('parental:status', () => parental.status());
handle('parental:set-on', async (on, pw) => {
	await parental.setOn(!!on, pw);
	parentalApply();
	return parental.status();
});
handle('parental:set-admin', async (on) => {
	// Защита держится на том, что у ребёнка нет прав администратора: в такой учётной записи её можно просто снять
	if (on && require('./parental-store').isPrivileged()) {
		const r = await dialog.showMessageBox(win, {
			type: 'warning',
			message: tr('Эта учётная запись — с правами администратора'),
			detail: tr('Из неё защиту правами администратора можно снять, так что от ребёнка, который сидит в этой учётной записи, она не защитит. Включай её в отдельной учётной записи ребёнка без прав администратора.'),
			buttons: [tr('Всё равно включить'), tr('Отмена')],
			defaultId: 1,
			cancelId: 1,
		});
		if (r.response !== 0) throw new Error('Отменено');
	}
	await parental.setAdmin(!!on);
	return parental.status();
});
handle('parental:unlock', (pw) => {
	const was = parental.isLocked();
	parental.unlock(pw);
	if (was) parentalApply();
	return parental.status();
});
handle('parental:get', () => {
	if (!parental.isUnlocked()) throw new Error('Нужен пароль родительского контроля');
	return parental.publicConfig();
});
handle('parental:set', (patch) => {
	parental.setConfig(patch);
	parentalApply();
	return parental.publicConfig();
});
handle('parental:stats', () => parental.stats());
// Страница блокировки: что за адрес и почему
ipcMain.handle('parental:blocked', (e) => {
	guard(e);
	const page = new URL(senderPageUrl(e));
	const tab = senderTab(e);
	if (tab && page.host !== 'parental') tab.parentalBlocked = true; // блокировка показана на месте страницы Problet
	const url = page.host === 'parental' ? page.searchParams.get('u') || '' : page.href;
	const why = parental.check(url) || (page.host === 'parental' ? page.searchParams.get('r') : null);
	return { url, reason: ['time', 'locked'].includes(why) ? why : why ? 'site' : null, ...parental.info() };
});
ipcMain.handle('parental:enter', (e, url, pw) => {
	guard(e);
	const tab = senderTab(e);
	const target = String(url);
	const why = parental.check(target);
	parental.enter(target, pw, why);
	if (why === 'locked') return parentalApply(); // браузер был заперт: открываем все вкладки, и эту тоже
	if (tab) tab.parentalBlocked = false;
	if (tab && !tab.view.webContents.isDestroyed()) {
		if (tab.view.virtual && tab.view.webContents.getURL() === target) tab.view.webContents.reload();
		else tab.view.webContents.loadURL(target).catch(() => {});
	}
});

function restartApp() {
	store.flush();
	if (process.env.APPIMAGE) updater.restartAppImage();
	else {
		app.relaunch();
		app.exit(0);
	}
}
handle('app:restart', () => {
	restartApp();
});
const allSessions = () => [session.defaultSession, ...(incSession ? [incSession] : [])];
ipcMain.handle('debug:run', async (e, action) => {
	guard(e);
	if (!senderPageUrl(e).startsWith('problet://version')) throw new Error('Доступ запрещён');
	action = String(action);
	if (DEBUG_ASK[action]) {
		const r = await dialog.showMessageBox(win, { type: 'warning', message: DEBUG_ASK[action], buttons: ['Да', 'Отмена'], defaultId: 1, cancelId: 1 });
		if (r.response !== 0) return { message: 'Отменено' };
	}
	switch (action) {
		case 'force-update': {
			const st = await updater.check(true);
			if (st.status === 'error') throw new Error(st.message);
			await updater.apply();
			return { message: 'Последняя версия ' + st.version + ' ставится принудительно' + (st.mode === 'page' || st.mode === 'dev' ? ' (открыта страница релиза)' : '') };
		}
		case 'clear-cookies':
			for (const s of allSessions()) await s.clearStorageData({ storages: ['cookies'] });
			return { message: 'Куки удалены' };
		case 'clear-site-data':
			for (const s of allSessions()) await s.clearStorageData();
			return { message: 'Данные сайтов удалены' };
		case 'clear-cache':
			await cache.clearNow();
			return { message: 'Кеш очищен' };
		case 'reset-settings':
			store.resetSettings();
			applySettings();
			sendExtActions();
			return { message: 'Настройки сброшены' };
		case 'remove-extensions': {
			const list = extensions.list();
			for (const x of list) await extensions.remove(x.path);
			const n = addons.list().length;
			addons.removeAll();
			sendExtActions();
			return { message: 'Расширений удалено: ' + list.length + ', аддонов: ' + n };
		}
		case 'open-data':
			await shell.openPath(app.getPath('userData'));
			return { message: 'Папка открыта' };
		case 'open-log':
			if (fs.existsSync(LOG_FILE)) await shell.openPath(LOG_FILE);
			else return { message: 'Журнал пока пуст' };
			return { message: 'Журнал открыт' };
		case 'devtools':
			win.webContents.openDevTools({ mode: 'detach' });
			return { message: 'Инструменты разработчика интерфейса открыты' };
		case 'safe-mode':
			await setSafeMode(!safeMode);
			return { message: safeMode ? 'Безопасный режим включён' : 'Безопасный режим выключен', safeMode };
		case 'restart':
			restartApp();
			return { message: 'Перезапуск…' };
		default:
			throw new Error('Неизвестное действие');
	}
});

handle('version:info', () => ({
	name: 'Problet',
	version: app.getVersion(),
	chromium: process.versions.chrome,
	electron: process.versions.electron,
	node: process.versions.node,
	v8: process.versions.v8,
	os: os.type() + ' ' + os.release(),
	arch: process.arch,
	packaged: app.isPackaged,
	userAgent: (profile && profile.userAgent) || session.defaultSession.getUserAgent(),
	mask: settings().maskAs,
	data: app.getPath('userData'),
}));
handle('adblock:stats', () => ({ session: adblock.blockedCount(), total: store.blockedTotal() }));
handle('update:state', () => updater.getState());
handle('update:check', () => updater.check());
handle('update:apply', () => updater.apply());
ipcMain.on('update-apply', (e) => fromToolbar(e) && updater.apply());
ipcMain.on('update-get', (e) => {
	e.returnValue = fromToolbar(e) ? updater.getState() : null;
});

handle('settings:get', () => ({
	settings: store.rawSettings(),
	safeMode,
	engines: store.engineList(),
	defaultKeywords: store.DEFAULT_KEYWORDS,
	accents: accentList(),
	themes: { presets: PRESETS, tints: TINTS, contrasts: CONTRASTS, scales: UI_SCALES, keys: THEME_KEYS, palettes: PALETTES },
	arrowSets: store.ARROWS,
	searchCount: store.searchCount(),
	version: app.getVersion(),
}));
handle('safe:set', (on) => setSafeMode(on));
ipcMain.on('safe-exit', (e) => {
	if (fromToolbar(e)) setSafeMode(false);
});
handle('settings:set', (patch) => {
	const result = store.setSettings(patch);
	applySettings();
	return result;
});
handle('dir:pick', async () => {
	const r = await dialog.showOpenDialog(win, { title: 'Папка для загрузок', defaultPath: downloadDir(), properties: ['openDirectory', 'createDirectory'] });
	if (r.canceled || !r.filePaths[0]) return { canceled: true };
	return { path: r.filePaths[0] };
});
handle('history:clear', () => {
	store.clearSearches();
});
handle('cache:size', () => cache.size());
handle('cache:dir-pick', async () => {
	const r = await dialog.showOpenDialog(win, { title: 'Папка кеша', defaultPath: settings().cacheDir || app.getPath('userData'), properties: ['openDirectory', 'createDirectory'] });
	if (r.canceled || !r.filePaths[0]) return { canceled: true };
	return { path: r.filePaths[0] };
});
handle('cache:clear', async () => {
	await cache.clearNow();
	return { message: 'Кеш очищен' };
});

// Поиск из строки на странице новой вкладки: ищем в той вкладке, откуда пришёл запрос
ipcMain.handle('search:run', (e, text) => {
	guard(e);
	const tab = senderTab(e);
	const q = String(text || '').trim().slice(0, 500);
	if (!tab || !q) return;
	rememberSearch(q, tab);
	tab.pendingUrl = null;
	tab.view.webContents.loadURL(store.searchUrl(q)).catch(() => {});
});

// Открыть внутреннюю страницу (историю, закладки…) в новой вкладке
// Проводник (problet://files): список папки, боковая панель, операции с файлами — в filemanager.js.
// Изменять файлы может только сама страница проводника
const filesGuard = (e) => {
	guard(e);
	if (!senderPageUrl(e).startsWith('problet://files')) throw new Error('Доступ запрещён');
};
const filesHandle = (channel, fn) => ipcMain.handle(channel, (e, ...args) => {
	filesGuard(e);
	return fn(...args);
});
handle('files:list', (dir) => fm.list(dir));
filesHandle('files:places', () => fm.places());
filesHandle('files:thumb', (p) => fm.thumb(p));
filesHandle('files:pin', (dir, on) => fm.setPin(dir, !!on));
filesHandle('files:op', (kind, args) => fm.op(String(kind), args));
filesHandle('files:tab', (dir) => {
	createTab('problet://files/?p=' + encodeURIComponent(path.resolve(String(dir))), { activate: true });
});
filesHandle('files:clip', (mode, paths) => (mode === undefined ? fm.getClip() : fm.setClip(mode, paths)));
// Открыть файл: то, что браузер умеет показать, — во вкладке, остальное — программой системы
filesHandle('files:launch', async (p, how) => {
	p = path.resolve(String(p));
	if (how === 'system' || (how !== 'tab' && !BROWSER_VIEWABLE.test(p))) {
		const err = await shell.openPath(p);
		if (err) throw new Error(err);
		return 'system';
	}
	const tab = tabs.find((t) => t.id === activeId);
	if (how === 'newtab' || !tab) createTab(pathToFileURL(p).href, { activate: true });
	else tab.view.webContents.loadURL(pathToFileURL(p).href).catch(() => {});
	return 'tab';
});
const BROWSER_VIEWABLE = /\.(html?|xhtml|svg|png|jpe?g|gif|webp|avif|bmp|ico|pdf|txt|md|log|json|xml|csv|tsv|css|js|mjs|ts|py|c|h|cpp|hpp|java|rs|go|sh|ya?ml|toml|ini|conf|cfg|mp4|webm|ogg|ogv|mp3|wav|flac|m4a|opus)$/i;
// Стандартный проводник системы
handle('files-default:get', async () => ({ on: await fm.isDefault(), platform: process.platform }));
handle('files-default:set', async (on) => {
	if (!on) return fm.restoreDefault();
	let launcher = process.execPath;
	if (process.platform === 'linux' && process.env.APPIMAGE) {
		// AppImage: тот же скрипт-посредник, что и у ярлыка браузера (передаёт папку запущенному окну)
		const { apps } = require('./desktop').writeLauncher(process.env.APPIMAGE, path.join(__dirname, 'icon.png'), os.homedir(), app.getPath('userData'));
		launcher = path.join(os.homedir(), '.local', 'share', 'problet', 'open.sh');
		log('ярлык браузера обновлён', apps);
	}
	return fm.setDefault(launcher, path.join(__dirname, 'icon.png'));
});

// Страница problet:// не может сама перейти на file://, поэтому открываем файл в её вкладке отсюда
handle('files:open', (p, asIs) => {
	const tab = tabs.find((t) => t.id === activeId);
	if (!tab || tab.view.webContents.isDestroyed()) return;
	const url = pathToFileURL(path.resolve(String(p))).href + (asIs ? '?view' : '');
	tab.view.webContents.loadURL(url).catch(() => {});
});

// Редактор svg: чтение и запись файла по полному пути
const svgPath = (p) => {
	p = path.resolve(String(p));
	if (!/\.(svg|png)$/i.test(p)) throw new Error('Это не svg и не png');
	return p;
};
// png открывается в растровом режиме того же редактора
handle('png:read', (p) => {
	p = svgPath(p);
	if (!/\.png$/i.test(p)) throw new Error('Это не png-файл');
	if (fs.statSync(p).size > 5 * 1024 * 1024) throw new Error('Файл больше 5 МБ');
	const buf = fs.readFileSync(p);
	if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error('Это не png-картинка');
	return { dataUrl: 'data:image/png;base64,' + buf.toString('base64'), width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
});
handle('png:write', (p, dataUrl) => {
	p = svgPath(p);
	const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl));
	if (!/\.png$/i.test(p) || !m) throw new Error('Неверное изображение');
	fs.writeFileSync(p, Buffer.from(m[1], 'base64'));
	return { path: p };
});
handle('svg:read', (p) => {
	p = svgPath(p);
	if (!/\.svg$/i.test(p)) throw new Error('Это не svg-файл');
	if (fs.statSync(p).size > 5 * 1024 * 1024) throw new Error('Файл больше 5 МБ');
	return { path: p, text: fs.readFileSync(p, 'utf8') };
});
handle('svg:write', (p, text) => {
	p = svgPath(p);
	if (!/\.svg$/i.test(p)) throw new Error('Это не svg-файл');
	if (typeof text !== 'string' || text.length > 10 * 1024 * 1024) throw new Error('Слишком большой файл');
	fs.writeFileSync(p, text, 'utf8');
	return { path: p };
});
// Своя иконка закладки: svg из редактора превращается в data-адрес и показывается вместо значка сайта
// Значок сайта у закладки: редактор начинает с него, если своего рисунка ещё нет
async function siteIconData(url) {
	try {
		const r = await net.fetch(url, { signal: AbortSignal.timeout(6000) });
		const type = (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
		const buf = Buffer.from(await r.arrayBuffer());
		if (!r.ok || buf.length > 1024 * 1024 || !/^image\//.test(type || 'image/x-icon')) return '';
		return 'data:' + (type || 'image/x-icon') + ';base64,' + buf.toString('base64');
	} catch (e) {
		return '';
	}
}
handle('bm:icon-get', async (id) => {
	const cb = settings().customButtons.find((x) => x.id === id);
	if (cb) return { title: cb.name, svg: cb.svg ? decodeURIComponent(cb.svg.slice(cb.svg.indexOf(',') + 1)) : '' };
	const b = store.bookmarksState().bookmarks.find((x) => x.id === id);
	if (!b) throw new Error('Закладка не найдена');
	const url = b.customIcon || '';
	if (!url && b.icon) return { title: b.title, svg: '', image: await siteIconData(b.icon) };
	return { title: b.title, svg: url ? decodeURIComponent(url.slice(url.indexOf(',') + 1)) : '' };
});
handle('bm:icon-set', (id, svg) => {
	if (typeof svg !== 'string' || svg.length > 200000) throw new Error('Иконка слишком большая');
	const data = svg ? 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg) : '';
	if (String(id).startsWith('cb:')) {
		const list = store.rawSettings().customButtons;
		if (!list.some((x) => x.id === id)) throw new Error('Кнопка не найдена');
		store.setSettings({ customButtons: list.map((x) => (x.id === id ? { ...x, svg: data } : x)) });
		applySettings();
		return;
	}
	store.updateBookmark(id, { customIcon: data });
});
// Картинка из редактора в буфер обмена (через систему: navigator.clipboard требует фокуса и не везде умеет картинки)
handle('svg:copy-png', (dataUrl) => {
	if (!/^data:image\/png;base64,/.test(String(dataUrl))) throw new Error('Неверная картинка');
	const buf = Buffer.from(String(dataUrl).slice(String(dataUrl).indexOf(',') + 1), 'base64');
	if (!buf.length) throw new Error('Пустая картинка');
	const { ClipboardItem } = require('electron');
	return clipboard.write([new ClipboardItem({ 'image/png': new Blob([buf], { type: 'image/png' }) })]);
});
handle('svg:save-png', async (dataUrl, name) => {
	const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl));
	if (!m) throw new Error('Неверное изображение');
	const r = await dialog.showSaveDialog(win, { defaultPath: String(name || 'image.png').replace(/[\\/]/g, '_'), filters: [{ name: 'PNG', extensions: ['png'] }] });
	if (r.canceled || !r.filePath) return null;
	const file = /\.png$/i.test(r.filePath) ? r.filePath : r.filePath + '.png';
	fs.writeFileSync(file, Buffer.from(m[1], 'base64'));
	return { path: file };
});
handle('svg:save-as', async (text) => {
	const r = await dialog.showSaveDialog(win, { defaultPath: 'image.svg', filters: [{ name: 'SVG', extensions: ['svg'] }] });
	if (r.canceled || !r.filePath) return null;
	const file = /\.svg$/i.test(r.filePath) ? r.filePath : r.filePath + '.svg';
	fs.writeFileSync(file, String(text), 'utf8');
	return { path: file };
});

handle('insecure:proceed', (url) => {
	const u = new URL(String(url));
	if (u.protocol !== 'http:') throw new Error('Неверный адрес');
	adblock.allowInsecure(u.hostname);
	const tab = tabs.find((t) => t.id === activeId);
	if (tab && !tab.view.webContents.isDestroyed()) tab.view.webContents.loadURL(u.href);
});
// Ссылка на локальный файл со страницы браузера: в той же вкладке или в новой
ipcMain.handle('page:open-file', (e, url, newTab) => {
	guard(e);
	const u = new URL(String(url));
	if (u.protocol !== 'file:') throw new Error('Неверный адрес');
	const tab = senderTab(e);
	if (newTab || !tab) createTab(u.href, { afterId: tab ? tab.id : undefined });
	else tab.view.webContents.loadURL(u.href).catch(() => {});
});
handle('page:open-tab', (name) => {
	if (!INTERNAL_PAGES.has(name) || name === 'newtab') throw new Error('Неизвестная страница');
	createTab('problet://' + name);
});

// Окно ошибки: безопасный режим включается без перезапуска, язык и заголовок — как у браузера
errorwin.setup({ safe: { state: () => safeMode, enable: () => setSafeMode(true) }, lang: () => (curLang() === 'en' ? 'en' : 'ru'), title: (t) => tr(t) });

handle('default-browser:set', async () => {
	if (!app.isPackaged) return { ok: false, message: 'Работает только в установленной версии Problet' };
	const run = (cmd, args) => new Promise((resolve) => require('child_process').execFile(cmd, args, { timeout: 8000 }, (err, out) => resolve(err ? null : String(out).trim())));
	let ok;
	if (process.platform === 'linux') {
		// AppImage сам в меню приложений не появляется: записываем свой ярлык, который запускает именно этот файл
		if (process.env.APPIMAGE) {
			try {
				const { apps } = require('./desktop').writeLauncher(process.env.APPIMAGE, path.join(__dirname, 'icon.png'), os.homedir(), app.getPath('userData'));
				await run('update-desktop-database', [apps]);
				await run('xdg-mime', ['default', 'problet.desktop', 'x-scheme-handler/http']);
				await run('xdg-mime', ['default', 'problet.desktop', 'x-scheme-handler/https']);
			} catch (e) {
				log('не удалось записать ярлык AppImage', e);
			}
		}
		await run('xdg-settings', ['set', 'default-web-browser', 'problet.desktop']);
		ok = (await run('xdg-settings', ['get', 'default-web-browser'])) === 'problet.desktop';
	} else {
		app.setAsDefaultProtocolClient('http');
		app.setAsDefaultProtocolClient('https');
		ok = app.isDefaultProtocolClient('http') && app.isDefaultProtocolClient('https');
	}
	log('стандартный браузер', ok ? 'установлен' : 'не удалось');
	if (ok) return { ok, message: 'Problet теперь стандартный браузер' };
	return { ok, message: process.platform === 'win32' || process.platform === 'darwin'
		? 'Система не применила изменение. Выбери Problet вручную в настройках системы: приложения по умолчанию'
		: 'Не удалось назначить браузер по умолчанию через xdg-settings. Выбери Problet вручную в настройках системы' };
});
handle('spaces:state', () => spacesState());
handle('spaces:switch', (id) => switchSpace(String(id)));
handle('spaces:add', (name) => {
	if (spaces.length >= store.SPACES_LIMIT) throw new Error('Слишком много пространств');
	const clean = cleanSpaceName(name) || 'Пространство ' + (spaces.length + 1);
	const space = { id: 's' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36), name: clean };
	spaces.push(space);
	switchSpace(space.id);
	spacesChanged();
	return space.id;
});
handle('spaces:rename', (id, name) => {
	const space = spaces.find((x) => x.id === String(id));
	const clean = cleanSpaceName(name);
	if (!space || !clean) return;
	space.name = clean;
	spacesChanged();
});
handle('spaces:remove', (id) => {
	id = String(id);
	if (id === store.DEFAULT_SPACE || !spaces.some((x) => x.id === id)) return;
	const wasCurrent = currentSpace === id;
	for (const t of tabs) if (t.space === id) t.space = store.DEFAULT_SPACE; // вкладки удалённого пространства уходят в основное
	spaces = spaces.filter((x) => x.id !== id);
	delete spaceActive[id];
	if (wasCurrent && settings().spacesMerged) currentSpace = store.DEFAULT_SPACE;
	else if (wasCurrent) {
		currentSpace = null;
		const list = tabs.filter((t) => t.space === store.DEFAULT_SPACE);
		activateTab(list[list.length - 1].id);
	}
	spacesChanged();
});
handle('spaces:open-applet', () => openSpacesApplet());
handle('panel:close', () => closePanel());
handle('chars:pick', (ch) => {
	if (typeof ch !== 'string' || !ch || ch.length > 8) return;
	const toolbar = panelReturn === 'toolbar';
	closePanel();
	const wc = toolbar ? win.webContents : activeContents();
	if (!wc || wc.isDestroyed()) return;
	focusWc(wc);
	wc.insertText(ch);
});

handle('visits:list', () => store.visitsList());
handle('visits:remove', (id) => {
	store.removeVisit(String(id));
});
handle('visits:clear', () => {
	store.clearVisits();
});
// Очистка за период: последний час, сутки, неделю, месяц или всё
const CLEAR_PERIODS = { hour: 36e5, day: 864e5, week: 7 * 864e5, month: 30 * 864e5, all: 0 };
handle('visits:clear-since', (period) => {
	if (!Object.hasOwn(CLEAR_PERIODS, period)) throw new Error('Неизвестный период');
	return store.clearVisitsSince(CLEAR_PERIODS[period]);
});
// Часто посещаемые сайты для новой вкладки
handle('visits:top', () => (settings().topSites ? store.topSites(8).map((s) => ({ ...s, icon: settings().cacheIcons ? iconByOrigin.get(s.origin) || '' : '' })) : []));

handle('downloads:list', () => downloadsView());
handle('downloads:open', async (id) => {
	const d = downloads.find((x) => x.id === id && x.state === 'done');
	if (!d || !fs.existsSync(d.path)) throw new Error('Файл не найден');
	const err = await shell.openPath(d.path);
	if (err) throw new Error(err);
});
handle('downloads:show', (id) => {
	const d = downloads.find((x) => x.id === id && x.path);
	if (d && fs.existsSync(d.path)) shell.showItemInFolder(d.path);
});
handle('downloads:cancel', (id) => {
	const d = downloads.find((x) => x.id === id);
	if (d && d.item) d.item.cancel();
});
handle('downloads:remove', (id) => {
	const i = downloads.findIndex((x) => x.id === id);
	if (i < 0) return;
	if (downloads[i].item) downloads[i].item.cancel();
	downloads.splice(i, 1);
	persistDownloads();
	notifyDownloads();
});
handle('downloads:clear', () => {
	for (let i = downloads.length - 1; i >= 0; i--) if (downloads[i].state !== 'progressing') downloads.splice(i, 1);
	persistDownloads();
});

handle('bookmarks:state', () => store.bookmarksState());
handle('bookmarks:add', (b) => bookmarksAction(() => store.addBookmark(b)));
handle('bookmarks:update', (id, patch) => bookmarksAction(() => store.updateBookmark(id, patch)));
handle('bookmarks:remove', (id) => bookmarksAction(() => store.removeBookmark(id)));
handle('bookmarks:restore', (b) => bookmarksAction(() => store.restoreBookmark(b)));
handle('folders:add', (name) => bookmarksAction(() => store.addFolder(name)));
handle('folders:rename', (id, name) => bookmarksAction(() => store.renameFolder(id, name)));
handle('folders:remove', (id) => bookmarksAction(() => store.removeFolder(id)));

// ---------- Иконки закладок без иконки ----------
// Закладке иконку даёт вкладка в момент добавления. У импортированных её нет: ищем в фоне по самому сайту
// (ссылка <link rel="icon"> на странице, иначе /favicon.ico), а у сайтов, где иконка уже известна, берём её сразу
const ICON_LINK = /<link\b[^>]*>/gi;
async function findSiteIcon(url) {
	const known = iconByOrigin.get(originOf(url));
	if (known) return known;
	const res = await net.fetch(url, { signal: AbortSignal.timeout(10000), redirect: 'follow' });
	const base = res.url || url;
	if (res.ok && /text\/html/i.test(res.headers.get('content-type') || '')) {
		const html = (await res.text()).slice(0, 300000);
		const head = html.split(/<\/head>/i)[0];
		let best = '';
		for (const tag of head.match(ICON_LINK) || []) {
			const rel = (/\brel\s*=\s*["']?([^"'>]+)/i.exec(tag) || [])[1] || '';
			const href = (/\bhref\s*=\s*["']([^"']+)["']/i.exec(tag) || /\bhref\s*=\s*([^\s>]+)/i.exec(tag) || [])[1];
			if (!href || !/(^|\s)(shortcut\s+)?icon(\s|$)|apple-touch-icon/i.test(rel)) continue;
			let abs;
			try {
				abs = new URL(href.replace(/&amp;/g, '&'), base).href;
			} catch (e) {
				continue;
			}
			if (!/^https?:/i.test(abs)) continue;
			if (/(^|\s)icon(\s|$)/i.test(rel) || !best) best = abs; // обычная иконка важнее иконки для телефонов
			if (/(^|\s)icon(\s|$)/i.test(rel)) break;
		}
		if (best) return best;
	} else if (res.body) {
		res.body.cancel().catch(() => {});
	}
	const ico = new URL('/favicon.ico', base).href;
	const r2 = await net.fetch(ico, { signal: AbortSignal.timeout(10000) });
	const ok = r2.ok && /image|icon|octet-stream/i.test(r2.headers.get('content-type') || 'image');
	if (r2.body) r2.body.cancel().catch(() => {});
	return ok ? ico : '';
}

const bmIconQueue = [];
let bmIconRunning = 0;
let bmIconFound = {};
let bmIconFlush = null;
function queueBookmarkIcons(ids) {
	const want = new Set(ids);
	for (const b of store.bookmarksState().bookmarks) {
		if (want.has(b.id) && !b.icon && /^https?:/i.test(b.url)) bmIconQueue.push({ id: b.id, url: b.url });
	}
	for (let i = bmIconRunning; i < 4; i++) nextBookmarkIcon();
}
function nextBookmarkIcon() {
	const job = bmIconQueue.shift();
	if (!job) return;
	bmIconRunning++;
	findSiteIcon(job.url)
		.then((icon) => {
			if (!icon) return;
			bmIconFound[job.id] = icon;
			cache.addIcon(icon);
		})
		.catch(() => {}) // сайт недоступен — закладка останется со значком по умолчанию
		.finally(() => {
			bmIconRunning--;
			// Сохраняем пачками, чтобы не перерисовывать списки после каждой иконки
			if (!bmIconFlush) {
				bmIconFlush = setTimeout(() => {
					bmIconFlush = null;
					const map = bmIconFound;
					bmIconFound = {};
					store.setBookmarkIcons(map);
					sendState();
				}, bmIconQueue.length ? 1500 : 0);
			}
			nextBookmarkIcon();
		});
}

// ---------- Тон иконок закладок ----------
// Многие сайты дают однотонную иконку под светлую тему (GitHub — почти чёрную), а светлую подставляют своим скриптом.
// У закладки такая иконка сливается с тёмным фоном. Один раз смотрим, однотонная ли иконка и какого она тона (store.setBookmarkTones)
function colorsTone(list) {
	let dark = 0;
	let light = 0;
	let n = 0;
	for (const [r, g, b] of list) {
		if (Math.max(r, g, b) - Math.min(r, g, b) > 60) return ''; // цветная иконка видна на любом фоне
		const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
		n++;
		if (lum < 0.35) dark++;
		else if (lum > 0.75) light++;
	}
	if (!n) return '';
	if (dark >= n * 0.95) return 'dark';
	if (light >= n * 0.95) return 'light';
	return '';
}

const NAMED_COLORS = { black: [0, 0, 0], white: [255, 255, 255], currentcolor: [0, 0, 0], gray: [128, 128, 128], grey: [128, 128, 128] };
function parseColor(v) {
	v = String(v).trim().toLowerCase();
	if (!v || v === 'none' || v === 'transparent' || v.startsWith('url(')) return null;
	let m = /^#([0-9a-f]{3})$/.exec(v);
	if (m) return [...m[1]].map((c) => parseInt(c + c, 16));
	m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(v);
	if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
	m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(v);
	if (m) return [+m[1], +m[2], +m[3]];
	return NAMED_COLORS[v] || 'other'; // незнакомое название цвета — считаем иконку цветной
}

function svgTone(text) {
	if (/prefers-color-scheme/i.test(text)) return ''; // иконка сама меняется под тему
	const colors = [];
	for (const m of text.matchAll(/\b(?:fill|stroke|stop-color|color)\s*[=:]\s*["']?([^"';>]+)/gi)) {
		const c = parseColor(m[1]);
		if (c === 'other') return '';
		if (c) colors.push(c);
	}
	// Без цветов фигуры заливаются чёрным
	if (!colors.length) return /<(path|rect|circle|ellipse|polygon|polyline|text)\b/i.test(text) ? 'dark' : '';
	return colorsTone(colors);
}

function bitmapTone(px, count, bgra) {
	const list = [];
	const step = Math.max(1, Math.floor(count / 4096));
	for (let i = 0; i < count; i += step) {
		const o = i * 4;
		if (px[o + 3] < 100) continue; // прозрачное не считаем
		list.push(bgra ? [px[o + 2], px[o + 1], px[o]] : [px[o], px[o + 1], px[o + 2]]);
	}
	return list.length < 4 ? '' : colorsTone(list);
}

// ICO: берём самую большую картинку; внутри бывает PNG или 32-битный BMP
function icoTone(buf) {
	const count = buf.readUInt16LE(4);
	let best = null;
	for (let i = 0; i < count && 6 + i * 16 + 16 <= buf.length; i++) {
		const e = 6 + i * 16;
		const w = buf[e] || 256;
		const size = buf.readUInt32LE(e + 8);
		const off = buf.readUInt32LE(e + 12);
		if (off + size <= buf.length && (!best || w > best.w)) best = { w, data: buf.subarray(off, off + size) };
	}
	if (!best) return '';
	const d = best.data;
	if (d.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return pngTone(d);
	if (d.length < 40 || d.readUInt16LE(14) !== 32) return '';
	const w = d.readInt32LE(4);
	const h = Math.abs(d.readInt32LE(8)) / 2;
	const px = d.subarray(d.readUInt32LE(0), d.readUInt32LE(0) + w * h * 4);
	return px.length === w * h * 4 ? bitmapTone(px, w * h, true) : '';
}

function pngTone(buf) {
	const img = nativeImage.createFromBuffer(buf);
	if (img.isEmpty()) return '';
	const { width, height } = img.getSize();
	return bitmapTone(img.toBitmap(), width * height, true); // toBitmap отдаёт BGRA
}

const toneCache = new Map(); // адрес иконки → обещание тона (null — не удалось скачать, в этом запуске не повторяем)
function iconToneOf(url) {
	if (!toneCache.has(url)) {
		if (toneCache.size > 5000) toneCache.clear();
		toneCache.set(url, (async () => {
			const res = await net.fetch(url, { signal: AbortSignal.timeout(10000) });
			if (!res.ok) return null;
			const buf = Buffer.from(await res.arrayBuffer());
			if (!buf.length || buf.length > 2000000) return '';
			const head = buf.subarray(0, 300).toString('utf8');
			if (/svg/i.test(res.headers.get('content-type') || '') || /^\s*(<\?xml|<svg|<!--)/i.test(head)) return svgTone(buf.toString('utf8'));
			if (buf.length > 6 && buf.readUInt16LE(0) === 0 && buf.readUInt16LE(2) === 1) return icoTone(buf);
			return pngTone(buf); // PNG, JPEG и другое, что понимает nativeImage
		})().catch(() => null));
	}
	return toneCache.get(url);
}

let toneScanning = false;
const toneFailed = new Set();
function scanIconTones() {
	if (toneScanning) return;
	const todo = store.bookmarksState().bookmarks.filter((b) => b.icon && b.iconTone === undefined && !toneFailed.has(b.icon));
	if (!todo.length) return;
	toneScanning = true;
	(async () => {
		const map = {};
		let i = 0;
		const worker = async () => {
			while (i < todo.length) {
				const b = todo[i++];
				const tone = await iconToneOf(b.icon);
				if (tone === null) toneFailed.add(b.icon);
				else map[b.id] = { icon: b.icon, tone };
			}
		};
		await Promise.all([worker(), worker(), worker(), worker()]);
		store.setBookmarkTones(map);
	})().catch((e) => log('тон иконок закладок', e)).finally(() => {
		toneScanning = false;
		sendState();
	});
}

// Открыли сайт, у закладок которого нет иконки: теперь она известна
function fillBookmarkIcons(url, icon) {
	const origin = originOf(url);
	if (!origin || !icon) return;
	const map = {};
	for (const b of store.bookmarksState().bookmarks) if (!b.icon && originOf(b.url) === origin) map[b.id] = icon;
	if (!Object.keys(map).length) return;
	store.setBookmarkIcons(map);
	sendState();
}

handle('bookmarks:import-items', (items) => {
	const r = store.importBookmarkItems(items);
	queueBookmarkIcons(r.ids);
	sendState();
	return { message: 'Добавлено закладок: ' + r.added + ', новых папок: ' + r.folders + (r.skipped ? '. Пропущено (повторы и неподходящие адреса): ' + r.skipped : '') };
});

handle('import:detect', () => importer.detect().map((s) => ({ id: s.id, name: s.name })));
handle('import:run', (id) => {
	const items = importer.read(String(id));
	if (!items.length) throw new Error('В этом браузере не найдено закладок');
	const r = store.importBookmarkItems(items);
	queueBookmarkIcons(r.ids);
	sendState();
	return { message: 'Добавлено закладок: ' + r.added + ', новых папок: ' + r.folders + (r.skipped ? '. Пропущено (повторы и неподходящие адреса): ' + r.skipped : '') };
});

handle('ext:list', () => [...extensions.list(), ...addons.list()]);
handle('ext:add', async () => {
	let dir;
	if (process.env.PROBLET_TEST_EXT_DIR) {
		dir = process.env.PROBLET_TEST_EXT_DIR;
	} else {
		const r = await dialog.showOpenDialog(win, { title: 'Папка с распакованным расширением', properties: ['openDirectory'] });
		if (r.canceled || !r.filePaths[0]) return { canceled: true };
		dir = r.filePaths[0];
	}
	const e = await extensions.add(dir);
	sendExtActions();
	return { message: 'Расширение «' + e.name + '» добавлено' };
});
handle('ext:store', async (input) => {
	try {
		const e = await extensions.installFromStore(String(input || ''), process.versions.chrome, log);
		sendExtActions();
		return { message: 'Расширение «' + e.name + '» установлено' };
	} catch (err) {
		log('магазин: ошибка установки', err);
		throw err;
	}
});
handle('ext:remove', async (p) => {
	await extensions.remove(String(p));
	sendExtActions();
});
// Кнопки расширений на панели инструментов
// Каждое расширение с кнопкой получает свою кнопку на панели инструментов, у удалённых кнопки пропадают
let extReady = false;

// ---------- Безопасный режим ----------
// Включается без перезапуска: стандартные панели, без своих кнопок и их клавиш, без расширений и аддонов,
// без автообновления, перевода страниц, блокировщика и скрытия баннеров, масштаб интерфейса 100%.
// Сохранённые настройки не меняются: после выхода всё возвращается как было
let safeMode = false;
async function setSafeMode(on) {
	on = !!on;
	if (on === safeMode) return safeMode;
	safeMode = on;
	log(on ? 'безопасный режим включён' : 'безопасный режим выключен');
	store.setSafe(on);
	addons.setSafe(on);
	if (win && !win.isDestroyed()) {
		applySettings();
		// Раскладку с кнопками расширений не пересчитываем, пока расширения загружаются заново: иначе их кнопки
		// посчитаются удалёнными, выпадут из раскладки и вернутся уже в конец панели (sendExtActions ниже, после загрузки)
		if (extReady) syncRelays();
		sendLayout();
		sendState();
		setWindowTitle(activeTab());
	}
	try {
		await extensions.setSafe(on);
	} catch (e) {
		log('расширения в безопасном режиме', e);
	}
	if (win && !win.isDestroyed()) sendExtActions();
	return safeMode;
}
// Вкладки для расширений (chrome.tabs в ext-shim.js): номер вкладки — номер её страницы, окно одно
function extTabList() {
	return tabs.filter((t) => !t.view.webContents.isDestroyed()).map((t, index) => {
		const wc = t.view.webContents;
		const active = t.id === activeId;
		const b = pageBounds();
		return {
			id: wc.id, index, windowId: 1, active, highlighted: active, selected: active, pinned: !!t.pinned, incognito: !!t.incognito,
			audible: wc.isCurrentlyAudible(), mutedInfo: { muted: !!(wc.isAudioMuted && wc.isAudioMuted()) }, discarded: !!t.frozen, autoDiscardable: true,
			url: t.pendingUrl || wc.getURL() || t.url, title: t.title || t.pendingUrl || wc.getURL() || t.url,
			status: t.loading ? 'loading' : 'complete', favIconUrl: t.icon || undefined, width: b.width, height: b.height,
			groupId: -1, openerTabId: undefined,
		};
	});
}

// События chrome.tabs.on*: сравниваем с прошлым состоянием при каждом обновлении полосы вкладок
let extTabsPrev = new Map();
let extActivePrev = null;
function sendTabEvents() {
	if (!extRelays.size) return;
	const send = (ev) => {
		for (const w of extRelays.values()) if (!w.isDestroyed()) w.webContents.send('tab:event', ev);
	};
	const now = new Map(extTabList().map((t) => [t.id, t]));
	for (const [id, t] of now) {
		const old = extTabsPrev.get(id);
		if (!old) {
			send({ type: 'created', tab: t });
			continue;
		}
		const change = {};
		for (const k of ['status', 'url', 'title', 'pinned', 'favIconUrl', 'audible', 'discarded']) if (old[k] !== t[k]) change[k] = t[k];
		if (Object.keys(change).length) send({ type: 'updated', tab: t, change });
	}
	for (const id of extTabsPrev.keys()) if (!now.has(id)) send({ type: 'removed', tabId: id });
	const act = [...now.values()].find((t) => t.active);
	if (act && act.id !== extActivePrev) send({ type: 'activated', tabId: act.id });
	extActivePrev = act ? act.id : null;
	extTabsPrev = now;
}

// Скрытые страницы-посредники расширений из магазина (problet-relay.html, см. extensions.js): id расширения → окно
const extRelays = new Map();
function syncRelays() {
	const want = new Map();
	if (!safeMode) for (const e of extensions.list()) {
		if (e.id && !e.error && fs.existsSync(path.join(e.path, 'problet-relay.html'))) want.set(e.id, e);
	}
	for (const [id, w] of extRelays) {
		if (want.has(id) && !w.isDestroyed()) continue;
		if (!w.isDestroyed()) w.destroy();
		extRelays.delete(id);
	}
	for (const id of want.keys()) {
		if (extRelays.has(id)) continue;
		const w = new BrowserWindow({ show: false, width: 400, height: 300, webPreferences: { preload: PAGE_PRELOAD, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
		extRelays.set(id, w);
		w.on('closed', () => {
			if (extRelays.get(id) === w) extRelays.delete(id);
		});
		w.webContents.on('render-process-gone', () => setTimeout(() => {
			// Процесс расширения упал: поднимаем посредника заново
			if (extRelays.get(id) === w && !w.isDestroyed()) w.webContents.reload();
		}, 1000));
		w.loadURL('chrome-extension://' + id + '/problet-relay.html').catch((err) => log('посредник расширения не открылся', err));
	}
}
const relayExt = (wc) => {
	for (const [id, w] of extRelays) if (!w.isDestroyed() && w.webContents === wc) return id;
	return '';
};

function sendExtActions() {
	if (extReady) syncRelays();
	if (extReady && !safeMode) { // в безопасном режиме раскладка стандартная, сохранённую не трогаем
		const ids = [...extensions.actions(), ...addons.actions()].map((x) => 'x:' + x.id);
		const L = settings().btnLayout;
		const has = new Set([...L.tabs, ...L.toolbar, ...L.bmbar, ...L.extra, ...L.hidden]);
		const next = { tabs: [...L.tabs], toolbar: [...L.toolbar], bmbar: [...L.bmbar], extra: [...L.extra], hidden: [...L.hidden] };
		let changed = false;
		for (const key of Object.keys(next)) {
			const keep = next[key].filter((id) => !store.EXT_BTN.test(id) || ids.includes(id));
			if (keep.length !== next[key].length) changed = true;
			next[key] = keep;
		}
		// Вернувшаяся кнопка (расширение снова загрузилось) встаёт на прежнее место — по памяти расположения
		// (сразу после прежней соседки); новая — в конец панели инструментов
		const mem = settings().btnMemory || {};
		for (const id of ids) {
			if (has.has(id)) continue;
			changed = true;
			const panel = ['toolbar', 'bmbar', 'tabs', 'extra'].find((k) => (mem[k] || []).includes(id));
			if (!panel) {
				next.toolbar.push(id);
				continue;
			}
			const list = next[panel];
			const order = mem[panel];
			let put = 0;
			for (let j = order.indexOf(id) - 1; j >= 0; j--) {
				const k = list.indexOf(order[j]);
				if (k >= 0) {
					put = k + 1;
					break;
				}
			}
			list.splice(put, 0, id);
		}
		if (changed) {
			try {
				store.setSettings({ btnLayout: next });
			} catch (e) { /* расположение останется прежним */ }
		}
	}
	sendLayout();
}
// Страницы кнопки и настроек: id расширения Chrome или @id аддона Problet
function extPage(id, kind) {
	return id.startsWith('@') ? addons.pageUrl(id.slice(1), kind) : extensions.pageUrl(id, kind);
}
// chrome.debugger для расширений: в Electron его нет, а инструменты Claude (скриншоты, клики, чтение страницы) работают через него.
// Запросы идут из фонового процесса расширения по каналу в страницу боковой панели, а оттуда сюда: отладчик Electron на нужной вкладке
// Страница-посредник расширения передаёт запросы его фонового процесса браузеру
ipcMain.on('ext:is-relay', (e) => {
	const ext = relayExt(e.sender);
	e.returnValue = !!ext && !!e.senderFrame && e.senderFrame.url === 'chrome-extension://' + ext + '/problet-relay.html';
});
const dbgHooked = new WeakSet();
let offscreenWin = null; // скрытая страница расширения (chrome.offscreen)
const dbgTab = (id) => {
	const t = tabs.find((x) => !x.view.webContents.isDestroyed() && x.view.webContents.id === id);
	return t ? t.view.webContents : null;
};
const dbgOwner = new Map(); // номер вкладки → расширение, которое подключило к ней отладчик
// События отладчика идут в служебную страницу того расширения, которое подключило отладчик, а она передаёт их фоновому процессу
const dbgSend = (ev) => {
	const r = extRelays.get(dbgOwner.get(ev.tabId));
	if (r && !r.isDestroyed()) r.webContents.send('dbg:event', ev);
};
ipcMain.handle('ext:dbg', async (e, req) => {
	const ext = relayExt(e.sender);
	if (!ext || !e.senderFrame || e.senderFrame.url !== 'chrome-extension://' + ext + '/problet-relay.html' || !req || typeof req !== 'object') throw new Error('Доступ запрещён');
	return extDbg(req, ext);
});

// Вкладки, которые завело расширение: остаются настоящими страницами, чтобы номер вкладки у расширения не менялся
async function extDbg(req, extId) {
	if (req.op === 'tab-list') return extTabList();
	if (req.op === 'tab-update' || req.op === 'tab-reload') {
		const t = tabs.find((x) => !x.view.webContents.isDestroyed() && x.view.webContents.id === Number(req.tabId));
		if (!t) throw new Error('No tab with id: ' + req.tabId + '.');
		if (req.op === 'tab-reload') {
			t.view.webContents.reload();
			return null;
		}
		const p = req.props && typeof req.props === 'object' ? req.props : {};
		if (typeof p.url === 'string' && p.url) {
			if (!/^(https?:|problet:|chrome-extension:|about:blank|data:|file:)/.test(p.url)) throw new Error('Unsupported URL: ' + p.url);
			t.pendingUrl = null;
			t.frozen = false;
			t.view.webContents.loadURL(p.url).catch(() => {});
		}
		if (p.pinned !== undefined) setPinned(t.id, !!p.pinned);
		if (p.active || p.highlighted) activateTab(t.id);
		if (p.muted !== undefined && t.view.webContents.setAudioMuted) t.view.webContents.setAudioMuted(!!p.muted);
		return extTabList().find((x) => x.id === Number(req.tabId)) || null;
	}
	if (req.op === 'tab-capture') {
		const t = activeTab();
		if (!t || t.view.webContents.isDestroyed()) throw new Error('No active tab');
		const img = await t.view.webContents.capturePage();
		return req.format === 'jpeg' ? 'data:image/jpeg;base64,' + img.toJPEG(Math.min(100, Math.max(0, Number(req.quality) || 92))).toString('base64') : img.toDataURL();
	}
	if (req.op === 'tab-create') {
		let u = String(req.url || '');
		if (!u || /^chrome:\/\/newtab/.test(u)) u = NEWTAB;
		if (!/^(https?:|problet:|chrome-extension:|about:blank)/.test(u)) throw new Error('Unsupported URL: ' + u);
		const t = createTab(u, { activate: req.active !== false, real: true, extOwned: true });
		return { id: t.view.webContents.id, url: u, title: '', active: req.active !== false, tab: extTabList().find((x) => x.id === t.view.webContents.id) };
	}
	if (req.op === 'tab-remove') {
		for (const wid of [].concat(req.ids || [])) {
			const t = tabs.find((x) => !x.view.webContents.isDestroyed() && x.view.webContents.id === wid);
			if (t) closeTab(t.id);
		}
		return null;
	}
	if (req.op === 'tab-nav') {
		const wc = req.tabId === undefined ? (activeTab() || {}).view && activeTab().view.webContents : dbgTab(Number(req.tabId));
		if (!wc || wc.isDestroyed()) throw new Error('No tab with id: ' + req.tabId + '.');
		const h = wc.navigationHistory;
		if (req.dir < 0 ? h.canGoBack() : h.canGoForward()) req.dir < 0 ? h.goBack() : h.goForward();
		return null;
	}
	if (req.op === 'win-get' || req.op === 'win-set') {
		if (!win || win.isDestroyed()) throw new Error('No window');
		if (req.op === 'win-set') {
			const p = req.props && typeof req.props === 'object' ? req.props : {};
			const num = (v) => (typeof v === 'number' && isFinite(v) ? Math.round(v) : undefined);
			if (p.state === 'maximized') win.maximize();
			else if (p.state === 'minimized') win.minimize();
			else if (p.state === 'fullscreen') win.setFullScreen(true);
			else if (p.state === 'normal' || num(p.width) || num(p.height) || num(p.left) !== undefined || num(p.top) !== undefined) {
				if (win.isFullScreen()) win.setFullScreen(false);
				if (win.isMaximized()) win.unmaximize();
				if (win.isMinimized()) win.restore();
				const b = win.getBounds();
				win.setBounds({ x: num(p.left) ?? b.x, y: num(p.top) ?? b.y, width: num(p.width) || b.width, height: num(p.height) || b.height });
			}
			if (p.focused) win.focus();
		}
		const b = win.getBounds();
		return { id: 1, focused: win.isFocused(), incognito: false, alwaysOnTop: win.isAlwaysOnTop(), left: b.x, top: b.y, width: b.width, height: b.height, type: 'normal', state: win.isFullScreen() ? 'fullscreen' : win.isMinimized() ? 'minimized' : win.isMaximized() ? 'maximized' : 'normal' };
	}
	if (req.op === 'offscreen-has') return !!offscreenWin && !offscreenWin.isDestroyed();
	if (req.op === 'offscreen-close') {
		if (offscreenWin && !offscreenWin.isDestroyed()) offscreenWin.destroy();
		offscreenWin = null;
		return null;
	}
	if (req.op === 'offscreen-create') {
		if (offscreenWin && !offscreenWin.isDestroyed()) throw new Error('Only a single offscreen document may be created.');
		const u = new URL(String(req.url || ''), 'chrome-extension://' + extId + '/');
		if (!extId || u.protocol !== 'chrome-extension:' || u.hostname !== extId) throw new Error('Unsupported URL');
		offscreenWin = new BrowserWindow({ show: false, width: 800, height: 600, webPreferences: { preload: path.join(__dirname, 'preload-page.js'), contextIsolation: true, sandbox: true } });
		await offscreenWin.loadURL(u.href);
		return null;
	}
	if (req.op === 'targets') {
		return tabs.filter((t) => !t.view.webContents.isDestroyed()).map((t) => {
			const wc = t.view.webContents;
			return { type: 'page', id: String(wc.id), tabId: wc.id, title: wc.getTitle(), url: wc.getURL(), attached: wc.debugger.isAttached() };
		});
	}
	const wc = dbgTab(Number(req.tabId));
	if (!wc) throw new Error('No tab with id: ' + req.tabId + '.');
	const dbg = wc.debugger;
	if (req.op === 'attach') {
		if (dbg.isAttached()) throw new Error('Another debugger is already attached to the tab with id: ' + wc.id + '.');
		dbg.attach(typeof req.version === 'string' ? req.version : '1.3');
		dbgOwner.set(wc.id, extId);
		if (!dbgHooked.has(wc)) {
			dbgHooked.add(wc);
			dbg.on('message', (ev, method, params, sessionId) => dbgSend({ tabId: wc.id, method, params, sessionId }));
			dbg.on('detach', (ev, reason) => dbgSend({ tabId: wc.id, detach: true, reason }));
		}
		return null;
	}
	if (req.op === 'detach') {
		if (!dbg.isAttached()) throw new Error('Debugger is not attached to the tab with id: ' + wc.id + '.');
		dbg.detach();
		return null;
	}
	if (req.op === 'send') {
		if (!dbg.isAttached()) throw new Error('Debugger is not attached to the tab with id: ' + wc.id + '.');
		if (typeof req.method !== 'string') throw new Error('Неверный запрос');
		return dbg.sendCommand(req.method, req.params || {}, typeof req.sessionId === 'string' ? req.sessionId : undefined);
	}
	throw new Error('Неверный запрос');
}
ipcMain.on('ext:shim', (e) => {
	try {
		const shim = fs.readFileSync(path.join(__dirname, 'ext-shim.js'), 'utf8');
		// Боковая панель в Chrome не вкладка: у неё chrome.tabs.getCurrent() ничего не возвращает, и расширение по этому её узнаёт
		e.returnValue = /^chrome-extension:\/\//.test(e.senderFrame.url) ? (sideView && e.sender === sideView.webContents ? 'window.__probletSidePanel = true;\n' : '') + shim : '';
	} catch (err) {
		e.returnValue = '';
	}
});
ipcMain.on('bar:ext', (e, id, rect) => {
	if (!fromToolbar0(e)) return;
	id = String(id);
	const url = extPage(id, 'popup');
	if (url) openPanel('ext', folderRect(rect), id);
	else if (id.startsWith('@')) addons.click(id.slice(1)); // кнопка без окошка: нажатие получает фон аддона
	else if (toggleSidePanel(id)) { /* боковая панель расширения */ } else {
		const options = extPage(id, 'options');
		if (options) createTab(options, { activate: true });
	}
});

// ---------- Аддоны Problet ----------

// API для фона и страниц аддона
ipcMain.handle('addon:call', (e, method, args) => {
	if (e.senderFrame !== e.sender.mainFrame) throw new Error('Доступ запрещён');
	return addons.call(e.sender, String(method), args);
});
ipcMain.on('addon:reply', (e, id, value) => addons.reply(e.sender, id, value));
// Прелоад вкладки спрашивает, какие скрипты аддонов вставить в загружающуюся страницу
ipcMain.on('addon:content-get', (e, url) => {
	const tab = tabs.find((t) => t.view.webContents === e.sender);
	try {
		e.returnValue = tab && !tab.incognito && e.senderFrame === e.sender.mainFrame ? addons.contentFor(String(url)) : [];
	} catch (err) {
		e.returnValue = [];
	}
});
ipcMain.handle('addon:content', (e, id, kind, args) => {
	const tab = tabs.find((t) => t.view.webContents === e.sender);
	if (!tab) throw new Error('Доступ запрещён');
	return addons.fromContent(e.sender, String(id), String(kind), Array.isArray(args) ? args : [], { id: tab.id, url: e.sender.getURL(), title: tab.title, incognito: tab.incognito });
});
// Настройки: установка и удаление
handle('addon:catalog', () => addons.catalog());
handle('addon:install-catalog', (id) => addons.installFromCatalog(String(id)));
handle('addon:install-url', (url) => addons.installFromUrl(String(url)));
handle('addon:install-zip', async () => {
	let file = process.env.PROBLET_TEST_ADDON_ZIP;
	if (!file) {
		const r = await dialog.showOpenDialog(win, { title: 'Архив с аддоном Problet', properties: ['openFile'], filters: [{ name: 'Архив ZIP', extensions: ['zip'] }] });
		if (r.canceled || !r.filePaths[0]) return { canceled: true };
		file = r.filePaths[0];
	}
	return addons.installFromZip(file);
});
handle('addon:remove', (id) => addons.remove(String(id).replace(/^@/, '')));
handle('addon:reset', (id) => addons.resetPermissions(String(id).replace(/^@/, '')));
handle('addon:options', (id) => {
	const u = addons.pageUrl(String(id).replace(/^@/, ''), 'options');
	if (u) createTab(u, { activate: true });
});

async function saveToFile(title, defaultName, filters, content) {
	const res = await dialog.showSaveDialog(win, { title, defaultPath: defaultName, filters });
	if (res.canceled || !res.filePath) return { canceled: true };
	await fs.promises.writeFile(res.filePath, content, 'utf8');
	return { message: 'Сохранено: ' + res.filePath };
}

handle('data:export', () => saveToFile(
	'Экспорт данных', 'problet-backup-' + dateStamp() + '.json', [{ name: 'JSON', extensions: ['json'] }],
	JSON.stringify(store.exportData(), null, '\t'),
));

handle('bookmarks:export-html', () => saveToFile(
	'Экспорт закладок', 'bookmarks-' + dateStamp() + '.html', [{ name: 'HTML', extensions: ['html'] }],
	store.exportBookmarksHtml(),
));

handle('data:import', async () => {
	const res = await dialog.showOpenDialog(win, {
		title: 'Импорт данных',
		properties: ['openFile'],
		filters: [{ name: 'JSON', extensions: ['json'] }],
	});
	if (res.canceled || !res.filePaths[0]) return { canceled: true };

	const stat = await fs.promises.stat(res.filePaths[0]);
	if (stat.size > 50 * 1024 * 1024) throw new Error('Файл слишком большой для резервной копии');
	let parsed;
	try {
		parsed = JSON.parse(await fs.promises.readFile(res.filePaths[0], 'utf8'));
	} catch (e) {
		throw new Error('Не удалось прочитать файл: это не JSON');
	}
	if (!store.looksLikeBackup(parsed)) throw new Error('Файл не похож на резервную копию браузера');

	const choice = await dialog.showMessageBox(win, {
		type: 'question',
		title: 'Импорт',
		message: 'Как импортировать данные?',
		detail: 'Объединить: добавить к текущим закладкам и истории, повторяющиеся закладки пропускаются, настройки остаются как есть.\n\n'
			+ 'Заменить: полностью заменить текущие закладки, папки, историю и настройки данными из файла.',
		buttons: ['Объединить', 'Заменить', 'Отмена'],
		defaultId: 0,
		cancelId: 2,
	});
	if (choice.response === 2) return { canceled: true };

	const mode = choice.response === 1 ? 'replace' : 'merge';
	const s = store.importData(parsed, mode);
	applySettings();
	sendExtActions();
	sendState();
	const base = 'закладок ' + s.bookmarks + ', папок ' + s.folders + ', запросов ' + s.searches;
	return { message: mode === 'replace' ? 'Данные заменены: ' + base : 'Добавлено: ' + base + (s.skipped ? '. Пропущено повторов: ' + s.skipped : '') };
});

// ---------- Окно ----------

// Страница 404 для несуществующих адресов problet://: стили вшиваем в неё, ведь у неизвестного адреса своих файлов нет
function notFoundResponse(request, shownUrl) {
	const read = (...p) => {
		try {
			return fs.readFileSync(path.join(...p), 'utf8');
		} catch (e) {
			return '';
		}
	};
	const dest = request.headers.get('sec-fetch-dest');
	if (dest && dest !== 'document' && dest !== 'iframe') return new Response('Not found', { status: 404 });
	let html = read(__dirname, 'pages', '404.html')
		.replace('/*THEME*/', read(__dirname, 'theme.css') + read(__dirname, 'pages', 'common.css'))
		.replace('{{url}}', (shownUrl || request.url).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]));
	if (curLang() === 'en') html = html.replace(/>([^<>]*[А-Яа-яЁё][^<>]*)</g, (_m, t) => '>' + tr(t) + '<').replace('<html lang="ru">', '<html lang="en">'); // у неизвестного адреса нет своих скриптов: переводим сразу
	// Мини-игра «Лабиринт» — после перевода, чтобы он не трогал код игры (у неё свои строки на двух языках)
	html = html.replace('/*MAZE_CSS*/', () => read(__dirname, 'pages', 'maze.css')).replace('/*MAZE_JS*/', () => read(__dirname, 'pages', 'maze.js').replace(/<\/script/gi, '<\\/script'));
	return new Response(html, { status: 404, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

const fileResponse = (filePath, request, shownUrl) => (fs.existsSync(filePath) ? net.fetch(pathToFileURL(filePath).toString()) : notFoundResponse(request, shownUrl));

// Файл внутренней страницы host с путём pathname
function pageResponse(host, pathname, request, shownUrl) {
	const root = path.join(__dirname, 'pages');
	// Родительский контроль: вместо запрещённой страницы Problet (и вместо «Не найдено») — страница блокировки по тому же адресу
	if (parental.isOn() && host !== 'parental' && (pathname === '/' || pathname === '' || /\.html$/.test(pathname) || /^\/debug\/?$/.test(pathname))) {
		const shown = shownUrl || 'problet://' + host + (pathname || '/');
		const why = parental.check(shown);
		if (why) {
			parental.recordAttempt(shown, why);
			return fileResponse(path.join(root, 'parental.html'), request, shownUrl);
		}
	}
	if (!INTERNAL_PAGES.has(host)) return notFoundResponse(request, shownUrl);
	const name = pathname === '/' || pathname === '' || (host === 'version' && /^\/debug\/?$/.test(pathname)) ? (pathname === '/' || pathname === '' ? host : 'debug') + '.html' : path.posix.basename(pathname);
	if (!/^[\w-]+\.(html|js|css)$/.test(name)) return notFoundResponse(request, shownUrl);
	return fileResponse(name === 'theme.css' ? path.join(__dirname, 'theme.css') : path.join(root, name), request, shownUrl); // тема общая для всех окон
}

// Окно панели (problet://ui/) и рамки внутренних страниц в нём (problet://ui/<страница>/…)
const UI_FILES = new Set(['renderer.js', 'style.css', 'theme.css']);
function uiResponse(url, request) {
	const p = url.pathname;
	if (p === '/') return fileResponse(path.join(__dirname, 'index.html'), request);
	const own = /^\/([\w-]+\.(?:js|css))$/.exec(p);
	if (own) return UI_FILES.has(own[1]) ? fileResponse(path.join(__dirname, own[1]), request) : notFoundResponse(request);
	const lib = /^\/pages\/([\w-]+\.js)$/.exec(p);
	if (lib) return fileResponse(path.join(__dirname, 'pages', lib[1]), request);
	const m = /^\/([^/]+)(\/.*)?$/.exec(p);
	if (!m) return notFoundResponse(request);
	return pageResponse(m[1], m[2] || '/', request, vtab.fromFrameUrl(request.url));
}

function internalHandler(request) {
	const url = new URL(request.url);
	if (url.hostname === 'ui') return uiResponse(url, request);
	return pageResponse(url.hostname, url.pathname, request);
}

function registerInternalPages() {
	protocol.handle('problet', internalHandler);
	protocol.handle(addons.SCHEME, addons.handler);
}

// ---------- Режим инкогнито ----------
// Все вкладки инкогнито делят одну сессию в памяти: куки, кеш и хранилища живут, пока открыта хоть одна такая вкладка

let incSession = null;

function incognitoSession() {
	if (incSession) return incSession;
	incSession = session.fromPartition('incognito'); // без префикса persist: данные только в памяти
	incSession.protocol.handle('problet', internalHandler);
	adblock.start(incSession, store);
	attachIdentity(incSession, false);
	setupDownloads(incSession, true);
	if (profile) incSession.setUserAgent(profile.userAgent);
	return incSession;
}

function wipeIncognito() {
	if (!incSession) return;
	incSession.clearStorageData().catch(() => {});
	incSession.clearCache().catch(() => {});
	incSession.closeAllConnections().catch(() => {});
}

function openIncognito(url) {
	createTab(url || NEWTAB, { incognito: true });
}

// Окно панели и рамки внутренних страниц в нём
function wireToolbarFrames() {
	const wc = win.webContents;
	wc.on('will-frame-navigate', (d) => {
		if (d.isMainFrame) {
			if (!d.url.startsWith(vtab.FRAME_BASE)) d.preventDefault(); // сама панель никуда не уходит (например, если на неё бросили ссылку)
			return;
		}
		const vt = vtabOfFrame(d.frame);
		if (vt && vt.view.webContents.pageNavigate(d.url)) d.preventDefault();
	});
	// Ссылка в новой вкладке (средняя кнопка, target=_blank) со страницы браузера
	wc.setWindowOpenHandler(({ url, disposition }) => {
		if (/^(https?|file|problet):/i.test(url)) createTab(url, { afterId: activeId || undefined, activate: disposition !== 'background-tab' });
		return { action: 'deny' };
	});
	wc.on('console-message', (e) => {
		const vt = vtabOfFrame(e.frame);
		if (vt) vt.view.webContents.emit('console-message', e);
	});
	// Ctrl+колесо над внутренней страницей
	wc.on('zoom-changed', (_e, direction) => {
		const t = activeTab();
		if (t && t.view.virtual) zoomBy(direction === 'in' ? 1 : -1);
	});
	// Окно панели перезагрузилось (например, из инструментов разработчика): рамки пропали, открываем их заново
	wc.on('did-finish-load', () => {
		vtBounds = '';
		vhost.bounds();
		for (const t of tabs) {
			if (!t.view.virtual || t.pendingUrl) continue;
			const vc = t.view.webContents;
			if (!vc.opened) continue;
			vc.opened = false;
			vc.load(vc.getURL());
			if (t.view.visible) vhost.send({ op: 'show', id: vc.id });
		}
	});
}

ipcMain.on('vt:loaded', (e, title) => {
	const vt = vtabOfFrame(e.senderFrame);
	if (vt) vt.view.webContents.loaded(e.senderFrame, title);
});
ipcMain.on('vt:title', (e, title) => {
	const vt = vtabOfFrame(e.senderFrame);
	if (vt) vt.view.webContents.titled(title);
});

// Место и режим окна переживают перезапуск: сохраняем при каждом изменении и перед перезапуском в новую версию
function savedBounds() {
	const w = store.getWindow();
	if (w.width === undefined) return { width: 1200, height: 800 };
	// Окно должно хоть частью попадать на один из экранов: монитор могли отключить
	const visible = screen.getAllDisplays().some((d) => {
		const a = d.workArea;
		return w.x < a.x + a.width - 50 && w.x + w.width > a.x + 50 && w.y < a.y + a.height - 50 && w.y + 30 > a.y;
	});
	return visible ? { x: w.x, y: w.y, width: w.width, height: w.height } : { width: w.width, height: w.height };
}
function saveWindow(quiet = false) {
	if (headless.enabled || !win || win.isDestroyed()) return;
	const b = win.getNormalBounds();
	// У свёрнутого окна режим не узнать надёжно: оставляем прежний
	const mode = win.isMinimized() ? store.getWindow().mode : win.isFullScreen() ? 'fullscreen' : win.isMaximized() ? 'maximized' : 'normal';
	store.setWindow({ ...b, mode, minimized: win.isMinimized(), quiet });
}
let winSaveTimer = null;
function scheduleWindowSave() {
	clearTimeout(winSaveTimer);
	winSaveTimer = setTimeout(() => saveWindow(), 500);
}
// Перезапуск в новую версию: окно в фоне или свёрнуто — новое тоже не должно забирать фокус
updater.hooks.beforeRestart = () => {
	clearTimeout(winSaveTimer);
	saveWindow(!!win && !win.isDestroyed() && (!win.isFocused() || win.isMinimized()));
	saveSession();
	store.flush();
	parental.flush();
};
// Тихий запуск: пока человек сам не переключится в окно, не переводим фокус внутрь него — на Linux и Windows это поднимает окно поверх остальных
let holdFocus = false;
function focusWc(wc) {
	if (holdFocus && win && !win.isDestroyed() && !win.isFocused()) return;
	wc.focus();
}
function showWindow() {
	const w = store.getWindow();
	if (w.quiet) {
		holdFocus = true;
		win.once('focus', () => {
			holdFocus = false;
			const tab = activeTab();
			if (tab && isNewTab(tab.view.webContents.getURL() || tab.url) && !parental.check(tab.view.webContents.getURL() || tab.url)) focusAddress();
			else if (tab) focusWc(tab.view.webContents);
		});
	}
	if (w.quiet) store.setWindow({ ...w, quiet: false });
	if (w.mode === 'fullscreen') {
		if (w.quiet) win.showInactive();
		win.setFullScreen(true);
	} else if (w.mode === 'maximized') {
		if (w.quiet) win.showInactive(); // maximize() на скрытом окне в некоторых оконных менеджерах отдаёт ему фокус
		win.maximize();
		if (!w.quiet) win.focus();
	} else if (w.quiet) win.showInactive();
	else win.show();
	if (w.quiet && w.minimized) win.minimize();
}

function createWindow() {
	win = new BrowserWindow({
		...(headless.enabled ? { width: 1200, height: 800 } : savedBounds()),
		minWidth: 480,
		minHeight: 320,
		backgroundColor: bgColor(),
		show: false,
		icon: path.join(__dirname, 'icon.png'),
		autoHideMenuBar: true,
		frame: false, // заголовок окна рисуем сами: панель вкладок и кнопки окна лежат в нём
		title: 'Problet',
		webPreferences: {
			preload: PAGE_PRELOAD,
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
			nodeIntegrationInSubFrames: true, // прелоад нужен и рамкам внутренних страниц
		},
	});
	win.removeMenu();
	win.loadURL(vtab.FRAME_BASE);
	win.on('page-title-updated', (e) => e.preventDefault());
	wireToolbarFrames();

	win.webContents.on('context-menu', (_e, params) => {
		const vt = vtabOfFrame(params.frame);
		if (vt) {
			vt.view.webContents.emit('context-menu', _e, params);
			return;
		}
		if (!params.isEditable) return;
		const f = params.editFlags;
		popupMenu([
			{ label: 'Вырезать', role: 'cut', enabled: f.canCut },
			{ label: 'Копировать', role: 'copy', enabled: f.canCopy },
			{ label: 'Вставить', role: 'paste', enabled: f.canPaste },
			{ label: 'Выделить всё', role: 'selectAll', enabled: f.canSelectAll },
		]);
	});

	// Страницы должны подстраиваться под окно при любом изменении размера: перетаскивание, разворачивание, полный экран
	for (const ev of ['resize', 'maximize', 'unmaximize', 'restore', 'enter-full-screen', 'leave-full-screen']) win.on(ev, layout);
	win.contentView.on('bounds-changed', layout);
	win.on('resize', closePanel);
	win.on('close', saveSession);
	if (!headless.enabled) {
		for (const ev of ['resize', 'move', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) win.on(ev, scheduleWindowSave);
		win.on('close', () => {
			clearTimeout(winSaveTimer);
			saveWindow();
		});
		showWindow();
	}
	// Скрытые окна-посредники расширений не дают сработать window-all-closed: без главного окна браузер выходит сам
	win.on('closed', () => app.quit());
	win.on('maximize', sendLayout);
	win.on('unmaximize', sendLayout);
	win.webContents.on('before-input-event', hotkeys);
	win.webContents.on('did-finish-load', () => uiZoom(win.webContents));
	win.webContents.on('did-finish-load', sendExtActions);
	win.webContents.on('did-finish-load', () => {
		if (started) return;
		started = true;
		openStartupTabs();
		for (const [arg, cwd] of incomingEarly.splice(0)) openIncoming(arg, cwd);
	});
}

// Второй запуск (например, «открыть ссылку в Problet» из системы) открывает адрес в новой вкладке уже запущенного окна
const gotLock = headless.enabled || app.requestSingleInstanceLock(); // без окна можно запускать сколько угодно копий
// Ссылка из системы (второй запуск или ярлык): показываем окно и открываем адрес в новой вкладке
let incomingEarly = []; // ссылки, пришедшие до появления окна (macOS присылает их событием ещё при запуске)
function openIncoming(arg, cwd) {
	if (win && win.isDestroyed()) return; // окно уже закрыто, браузер выходит
	if (!started) {
		if (arg) incomingEarly.push([arg, cwd]);
		return;
	}
	if (win.isMinimized()) win.restore();
	win.focus();
	let r = null;
	if (arg && cwd && !path.isAbsolute(arg) && !/^[a-z][a-z0-9+.-]*:/i.test(arg) && fs.existsSync(path.resolve(cwd, arg))) r = { url: pathToFileURL(path.resolve(cwd, arg)).href };
	else if (arg) r = resolveInput(arg, true);
	if (r) createTab(r.url);
}
app.on('second-instance', (_e, argv, cwd) => openIncoming(argv.slice(app.isPackaged ? 1 : 2).find((x) => !x.startsWith('-')), cwd));
// macOS передаёт ссылки и файлы не аргументами, а событиями
app.on('open-url', (e, url) => {
	e.preventDefault();
	openIncoming(url);
});
app.on('open-file', (e, file) => {
	e.preventDefault();
	openIncoming(file);
});

app.whenReady().then(() => {
	if (!gotLock) {
		app.quit();
		return;
	}
	if (process.platform === 'linux' && process.env.APPIMAGE && !headless.enabled) { // без окна профиль временный: ярлык и приём ссылок остаются у обычного Problet
		try {
			const desktop = require('./desktop');
			// Ярлык, записанный старой версией, запускал AppImage напрямую (и без FUSE не работал): переписываем его на скрипт, который передаёт ссылку запущенному браузеру
			if (fs.existsSync(path.join(os.homedir(), '.local', 'share', 'applications', 'problet.desktop'))) desktop.writeLauncher(process.env.APPIMAGE, path.join(__dirname, 'icon.png'), os.homedir(), app.getPath('userData'));
			desktop.startInbox(app.getPath('userData'), openIncoming);
		} catch (e) { log('не удалось подготовить приём ссылок из системы', e); }
	}
	if (app.isPackaged && !headless.enabled && (process.platform === 'linux' || process.platform === 'win32')) { // команда problet в терминале
		try {
			require('./desktop').installCommand(process.env.APPIMAGE || process.execPath, os.homedir());
		} catch (e) { log('не удалось записать команду problet', e); }
	}
	// macOS: стандартное меню Electron перезагружало бы саму панель браузера по Cmd+R и закрывало окно по Cmd+W, когда фокус в поиске или окошке.
	// Оставляем только нужное системе: меню приложения, правку (копирование и вставка работают через него) и окно
	if (process.platform === 'darwin') Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { label: 'Окно', submenu: [{ role: 'minimize' }, { role: 'zoom' }] }]));
	store.init(app.getPath('userData'));
	fm.init(app.getPath('userData'), log);
	// Запуск сразу в безопасном режиме: problet --safe-mode
	if (process.argv.includes('--safe-mode')) {
		safeMode = true;
		store.setSafe(true);
		addons.setSafe(true);
		extensions.setSafe(true);
		log('запуск в безопасном режиме');
	}
	vault.init(app.getPath('userData'), { onLock: () => sendState() });
	vault.setAutoLock(settings().pwLock);
	nativeTheme.themeSource = settings().darkTheme ? 'dark' : 'light';
	registerInternalPages();
	cache.start(session.defaultSession, store);
	adblock.setGate(parentalGate);
	adblock.start(session.defaultSession, store);
	startIdentity(session.defaultSession);
	setupDownloads(session.defaultSession);
	extensions.setLog(log);
	session.defaultSession.serviceWorkers.on('console-message', (_e, d) => { if (/^chrome-extension:/.test(d.sourceUrl || '') && d.level >= 2) log('фон расширения:', d.message, d.sourceUrl, d.lineNumber); });
	extensions.init(session.defaultSession, app.getPath('userData')).then(() => {
		extReady = true;
		sendExtActions();
	}).catch(() => {});
	try {
		addons.init(app.getPath('userData'), {
			log,
			lang: curLang,
			window: () => win,
			store,
			tabs: () => tabs.filter((t) => !t.hidden).map((t) => ({ id: t.id, url: t.view.webContents && !t.view.webContents.isDestroyed() ? t.view.webContents.getURL() || t.pendingUrl || t.url : t.url, title: t.title, active: t.id === activeId, incognito: !!t.incognito })),
			contents: (id) => {
				const t = tabs.find((x) => x.id === id);
				if (!t || !t.view.webContents || t.view.webContents.isDestroyed()) throw new Error('Нет такой вкладки');
				return t.view.webContents;
			},
			openTab: (url, active) => createTab(url, { activate: active }).id,
			closeTab: (id) => closeTab(id),
			activateTab: (id) => activateTab(id),
			changed: () => sendState(),
			buttonsChanged: () => sendExtActions(),
		});
	} catch (e) {
		log('аддоны не загрузились', e);
	}
	createWindow();
	if (headless.enabled) startHeadless();
	updater.onChange((st) => {
		if (win && !win.isDestroyed()) win.webContents.send('update-state', st);
		refreshTip();
	});
	// Старая история удаляется по сроку хранения: при запуске и раз в час
	store.pruneVisits();
	setInterval(() => store.pruneVisits(), 3600000);
	// Копия закладок: при запуске и раз в час проверяем, не пора ли
	setTimeout(backupIfDue, 30000);
	setInterval(backupIfDue, 3600000);
	if (!headless.enabled) updater.schedule(() => ({ every: settings().updateEvery, enabled: settings().autoUpdate, restart: settings().autoRestart, faster: settings().updateFaster, off: safeMode }));
});
function startHeadless() {
	if (headless.flag('adblock')) store.setSettings({ adblock: true });
	adblock.observe(headless.record);
	win.webContents.once('did-finish-load', () => {
		setTimeout(() => headless.start({
			dir: LOG_DIR,
			tabs: () => tabs,
			createTab,
			closeTab: (id) => {
				if (tabs.length > 1) closeTab(id);
			},
			activeTab,
			log,
			quit: () => app.quit(),
			readLog: (n) => {
				try {
					return fs.readFileSync(LOG_FILE, 'utf8').split('\n').slice(-n).join('\n');
				} catch (e) {
					return '';
				}
			},
			clearSite: async () => {
				await session.defaultSession.clearStorageData();
				await session.defaultSession.clearCache();
			},
		}), 600); // стартовая вкладка успевает открыться
	});
}

app.on('before-quit', () => {
	store.flush();
	parental.flush();
});
app.on('window-all-closed', () => app.quit());
