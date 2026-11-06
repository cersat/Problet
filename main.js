const { app, BrowserWindow, WebContentsView, ipcMain, protocol, net, dialog, nativeTheme, session, Menu, clipboard, shell, nativeImage } = require('electron');
const crypto = require('crypto');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { pathToFileURL } = require('url');
const store = require('./store');
const cache = require('./cache');
const adblock = require('./adblock');
const identity = require('./identity');
const updater = require('./updater');
const importer = require('./importer');
const extensions = require('./extensions');
const accel = require('./pages/accel');
const vault = require('./vault');
const passcsv = require('./passcsv');
const { tryCalc } = require('./calc');
const { themePayload, accentList } = require('./theme');

const TABBAR_HEIGHT = 36;
const TOOLBAR_HEIGHT = 44;
const BMBAR_HEIGHT = 32;
const SIDE_WIDTH = 220; // ширина вертикальной панели вкладок
const ROW_HEIGHT = 34;
const POPUP_PADDING = 4;
const MAX_SUGGESTIONS = 7;
const INTERNAL_PAGES = new Set(['settings', 'bookmarks', 'newtab', 'history', 'downloads', 'passwords', 'version', 'spaces', 'chars']);
const FIND_WIDTH = 390;
const FIND_HEIGHT = 46;
const NEWTAB = 'problet://newtab/';

// Внутренние страницы живут на адресах problet://settings, problet://bookmarks и problet://newtab
protocol.registerSchemesAsPrivileged([
	{ scheme: 'problet', privileges: { standard: true, secure: true, supportFetchAPI: true } },
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
const bgColor = () => (settings().darkTheme ? '#1e1e20' : '#fbfbfd');
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
	tab.view.webContents.focus();
}

// История поисковых запросов не пополняется из вкладок инкогнито
function rememberSearch(text, tab) {
	const t = tab === undefined ? activeTab() : tab;
	if (!t || !t.incognito) store.addSearch(text);
}

function tabOfContents(wc) {
	return tabs.find((t) => t.view.webContents === wc) || {};
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
	if (t.url.startsWith('data:') && t.title.startsWith('data:')) return 'HTML-страница';
	return t.title;
}

// Значки внутренних страниц (SVG в виде data-адреса); у новой вкладки — значок браузера
const svgIcon = (body) => 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#8fa3d9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + body + '</svg>');
const INTERNAL_ICONS = {
	settings: svgIcon('<path d="M4 7h9M19 7h1M4 17h1M11 17h9"/><circle cx="16" cy="7" r="2.2"/><circle cx="8" cy="17" r="2.2"/>'),
	bookmarks: svgIcon('<path d="M7 4h10v16l-5-4-5 4z"/>'),
	history: svgIcon('<circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/>'),
	version: svgIcon('<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8v.2"/>'),
	passwords: svgIcon('<circle cx="8.5" cy="14" r="3.5"/><path d="M11 12l8-8M16 7l2.5 2.5M13.5 9.5L15 11"/>'),
	downloads: svgIcon('<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19h14"/>'),
	spaces: svgIcon('<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>'),
};
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

const LAYOUT_KEYS = ['tabsPos', 'bmPos', 'bmOnlyIcons', 'bookmarksBar', 'tabsNewButton', 'winButtons', 'appPasswords', 'appHistory', 'appSettings', 'appDownloads', 'appUpdate', 'appBookmarks', 'appChars', 'appSpaces'];

function layoutPayload() {
	const s = settings();
	const out = {};
	for (const k of LAYOUT_KEYS) out[k] = s[k];
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
	return { folders: st.folders.map((f) => ({ id: f.id, name: f.name })), bookmarks: st.bookmarks.map((b) => ({ id: b.id, title: b.title, url: b.url, icon: b.icon, folder: b.folder })) };
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
	else loadInActive(url);
}

ipcMain.on('bar:open', (e, id, newTab) => {
	if (!fromToolbar0(e)) return;
	const b = store.bookmarksState().bookmarks.find((x) => x.id === id);
	if (!b) return;
	openBookmarkUrl(b.url, newTab);
});
ipcMain.on('bar:folder', (e, folderId) => {
	if (!fromToolbar0(e)) return;
	const st = store.bookmarksState();
	const items = st.bookmarks.filter((b) => b.folder === folderId);
	popupMenu(items.length
		? items.map((b) => ({ label: b.title.length > 50 ? b.title.slice(0, 49) + '…' : b.title, click: () => openBookmarkUrl(b.url) }))
		: [{ label: 'Папка пуста', enabled: false }]);
});

function sendTabs() {
	if (!win || win.isDestroyed()) return;
	const s = settings();
	win.webContents.send('tabs', {
		activeId,
		showUrl: s.showUrlInTabs,
		showIcons: s.showTabIcons,
		overflow: s.tabOverflow,
		space: spaces.find((x) => x.id === currentSpace) || spaces[0],
		tabs: visibleTabs().map((t) => ({ id: t.id, title: tabTitle(t), url: t.pendingUrl || t.url, icon: internalIcon(t.pendingUrl || t.url) || t.icon, loading: t.loading, pinned: t.pinned, incognito: !!t.incognito })),
		side: s.tabsPos === 'left' || s.tabsPos === 'right',
	});
}

// navigated — страница действительно сменилась, reset — вкладку переключили и адрес надо заменить в любом случае
function sendState(navigated, reset) {
	if (!win || win.isDestroyed()) return;
	const tab = activeTab();
	if (!tab) return;
	const wc = tab.view.webContents;
	const url = tab.pendingUrl || wc.getURL() || tab.url;
	const bookmarkable = isBookmarkable(url);
	win.webContents.send('state', {
		url: url.startsWith('data:text/html') || isNewTab(url) ? '' : url,
		canGoBack: wc.navigationHistory.canGoBack(),
		canGoForward: wc.navigationHistory.canGoForward(),
		loading: wc.isLoading(),
		canBookmark: bookmarkable,
		bookmarked: bookmarkable && !!store.findBookmarkByUrl(url),
		navigated: !!navigated,
		reset: !!reset,
		zoom: levelToPercent(wc.getZoomLevel()),
		pwOffer: offerFor(tab),
	});
}

function focusAddress() {
	win.webContents.focus();
	win.webContents.send('focus-address');
}

function toggleReload() {
	const wc = activeContents();
	if (!wc) return;
	if (wc.isLoading()) wc.stop();
	else wc.reload();
}

function goBack() {
	const wc = activeContents();
	if (wc && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
}

function goForward() {
	const wc = activeContents();
	if (wc && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
}

function toggleBookmark() {
	const tab = activeTab();
	if (!tab) return;
	const wc = tab.view.webContents;
	const url = wc.getURL();
	if (!isBookmarkable(url)) return;
	const existing = store.findBookmarkByUrl(url);
	if (existing) store.removeBookmark(existing.id);
	else store.addBookmark({ title: wc.getTitle(), url, icon: tab.icon });
	sendState();
}

// ---------- Вкладки ----------

// Размер берём у корневого вида окна: после разворачивания на весь экран getContentSize() в обработчике события может отдавать старое значение
function contentSize() {
	const b = win.contentView.getBounds();
	return [b.width, b.height];
}

// Сколько места вокруг страницы занимают панели. Те же числа заданы в style.css
function insets() {
	const s = settings();
	const i = { top: TOOLBAR_HEIGHT, bottom: 0, left: 0, right: 0 };
	if (s.tabsPos === 'top') i.top += TABBAR_HEIGHT;
	else if (s.tabsPos === 'bottom') i.bottom += TABBAR_HEIGHT;
	else if (s.tabsPos === 'left') i.left = SIDE_WIDTH;
	else i.right = SIDE_WIDTH;
	if (s.bookmarksBar) {
		if (s.bmPos === 'bottom') i.bottom += BMBAR_HEIGHT;
		else i.top += BMBAR_HEIGHT;
	}
	return i;
}

function pageBounds() {
	const [w, h] = contentSize();
	const i = insets();
	return { x: i.left, y: i.top, width: Math.max(0, w - i.left - i.right), height: Math.max(0, h - i.top - i.bottom) };
}

function layout() {
	for (const t of tabs) t.view.setBounds(pageBounds());
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
	win.setTitle(tab && tab.title ? tab.title + ' — Problet' : 'Problet');
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
	const alive = () => tabs.includes(tab);

	wc.setWindowOpenHandler(({ url }) => {
		if (/^(https?|file):\/\//i.test(url)) createTab(url, { afterId: tab.id });
		return { action: 'deny' };
	});
	wc.on('before-input-event', hotkeys);
	wc.on('context-menu', (_e, params) => showPageMenu(tab, params));
	wc.on('found-in-page', (_e, result) => {
		if (tab.id === activeId && findOpen && findView) findView.webContents.send('find-result', { active: result.activeMatchOrdinal, total: result.matches });
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
		if (offer && frameOriginOfUrl(wc.getURL()) !== offer.origin) pwOffers.delete(tab.id);
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
		if (tab.icon && !tab.incognito) iconByOrigin.set(originOf(tab.view.webContents.getURL()), tab.icon);
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
		if (tab.id === activeId && isNewTab(wc.getURL()) && Date.now() - tab.created < 5000 && win && win.isFocused()) focusAddress();
	});
	// Включённый блокировщик прячет остатки рекламы на самой странице
	wc.on('dom-ready', () => {
		if (settings().adblock && /^https?:/i.test(wc.getURL()) && (settings().adblockYoutube || !adblock.isYoutubeHost(new URL(wc.getURL()).hostname))) wc.insertCSS(adblock.COSMETIC_CSS).catch(() => {});
	});
	wc.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
		if (!isMainFrame || code === -3) return; // -3 — загрузку отменили сами
		wc.loadURL(errorPage(code, description, url)).catch(() => {});
	});
}

// opts: activate (по умолчанию да), lazy (загрузить при первом открытии), afterId, title, icon
function visibleTabs() {
	return tabs.filter((t) => t.space === currentSpace && !t.hidden);
}

function spaceOf(opts) {
	if (opts.space && spaces.some((x) => x.id === opts.space)) return opts.space;
	const from = opts.afterId && tabs.find((t) => t.id === opts.afterId);
	return from ? from.space : currentSpace;
}

function createTab(url, opts = {}) {
	// Вкладка, открытая из вкладки инкогнито, тоже инкогнито
	if (opts.incognito === undefined && opts.afterId) {
		const from = tabs.find((t) => t.id === opts.afterId);
		if (from && from.incognito) opts = { ...opts, incognito: true };
	}
	const prefs = { preload: path.join(__dirname, 'preload-page.js'), contextIsolation: true, sandbox: true };
	if (opts.incognito) prefs.session = incognitoSession();
	const view = new WebContentsView({ webPreferences: prefs });
	view.setBackgroundColor(bgColor());
	view.setVisible(false);
	if (profile) view.webContents.setUserAgent(profile.userAgent);
	const tab = { id: nextTabId++, view, title: opts.title || '', url: url || '', icon: opts.icon || '', loading: false, pendingUrl: null, pinned: !!opts.pinned, incognito: !!opts.incognito, space: spaceOf(opts), hidden: !!opts.hidden, created: Date.now() };

	let index = tabs.length;
	if (opts.afterId) {
		const i = tabs.findIndex((t) => t.id === opts.afterId);
		if (i >= 0) index = i + 1;
	}
	// Закреплённые вкладки всегда идут первыми
	index = tab.pinned ? Math.min(index, pinnedCount()) : Math.max(index, pinnedCount());
	tabs.splice(index, 0, tab);
	win.contentView.addChildView(view);
	win.contentView.addChildView(findView);
	win.contentView.addChildView(popup); // подсказки всегда поверх страниц
	if (panel) win.contentView.addChildView(panel);
	view.setBounds(pageBounds());
	wireTab(tab);

	if (!tab.incognito && tab.icon && originOf(tab.url)) iconByOrigin.set(originOf(tab.url), tab.icon);
	if (opts.lazy) tab.pendingUrl = url;
	else if (url) view.webContents.loadURL(url).catch(() => {});

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
	hideSuggest();
	if (tab.id !== activeId) { closeFind(); closePanel(); }
	currentSpace = tab.space;
	if (!tab.hidden) spaceActive[tab.space] = tab.id;
	const prev = activeTab();
	if (prev && prev !== tab) prev.view.setVisible(false);
	activeId = tab.id;
	for (const h of tabs.filter((t) => t.hidden && t !== tab)) closeTab(h.id); // страница без вкладки живёт, пока на неё смотрят
	tab.view.setVisible(true);
	if (tab.pendingUrl) {
		const url = tab.pendingUrl;
		tab.pendingUrl = null;
		tab.view.webContents.loadURL(url).catch(() => {});
	}
	setWindowTitle(tab);
	if (isNewTab(tab.view.webContents.getURL() || tab.url)) focusAddress();
	else tab.view.webContents.focus();
	sendTabs();
	sendState(true, true);
	scheduleSession();
}

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
	const vis = tabs.filter((t) => t.space === tab.space);
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
	if (tabs.length > 1 && !tabs[index].incognito && !tabs[index].hidden) rememberClosed(tabs[index]); // адреса из инкогнито не запоминаем
	const vIndex = tabs.filter((t) => t.space === tabs[index].space && !t.hidden).indexOf(tabs[index]);
	const [tab] = tabs.splice(index, 1);
	pwOffers.delete(tab.id);
	const lastIncognito = tab.incognito && !tabs.some((t) => t.incognito);
	win.contentView.removeChildView(tab.view);
	tab.view.webContents.close();
	if (lastIncognito) wipeIncognito();
	if (!tabs.length) {
		win.close();
		return;
	}
	if (tab.id === activeId) {
		activeId = null;
		const same = tabs.filter((t) => t.space === tab.space && !t.hidden);
		const back = tab.hidden ? same.find((t) => t.id === spaceActive[tab.space]) : null;
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
		const existing = tabs.find((t) => t.space === currentSpace && (t.pendingUrl || t.url).startsWith(url));
		if (existing) activateTab(existing.id);
		else createTab(url);
		return;
	}
	navigate(url);
}

function openStartupTabs() {
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
	list.forEach((item, i) => createTab(item.url, {
		activate: i === active,
		lazy: !!item.restored && i !== active,
		title: item.title,
		icon: item.icon,
		pinned: !!item.pinned,
		space: item.space,
	}));
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
			if (!wc.isDestroyed() && wc.getURL().startsWith('problet://')) wc.send('data-changed', kinds);
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
		pwOffers.set(tab.id, { origin, username, password, update });
	}
	if (tab.id === activeId) sendState();
});

// Страница просит подставить логин и пароль (только для её собственного адреса и только когда хранилище открыто)
ipcMain.handle('pw:lookup', (e) => {
	const origin = frameOrigin(e);
	if (!origin || !tabOfSender(e) || !settings().pwFill) return [];
	return vault.forOrigin(origin);
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

const ACTION_RUN = {
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
	bookmark: () => toggleBookmark(),
	bookmarks: () => openInternal('bookmarks'),
	history: () => openInternal('history'),
	downloads: () => openInternal('downloads'),
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
	for (const a of accel.ACTIONS) {
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
		ACTION_RUN[id]();
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
	const wc = activeContents();
	if (!wc || !win) return;
	const url = wc.getURL();
	if (!/^(https?|file|problet):/i.test(url)) return;
	let attached = false;
	try {
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
	const html = '<!doctype html><meta charset="utf-8"><title>Ошибка</title><style>'
		+ ':root{color-scheme:dark light}'
		+ 'body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;font:16px system-ui,sans-serif;background:#1e1e20;color:#e4e4e8}'
		+ '@media (prefers-color-scheme:light){body{background:#fbfbfd;color:#2c2c30}}'
		+ 'div{max-width:560px;padding:24px}h2{margin:0 0 12px}p{margin:0 0 8px;word-break:break-all}.u{color:#999}.e{color:#e57373}'
		+ '</style><div><h2>Не удалось открыть страницу</h2><p class="u">' + esc(url) + '</p><p class="e">' + esc(description) + ' (' + code + ')</p></div>';
	return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
}

// ---------- Поиск по странице ----------

function layoutFind() {
	if (!findView || !win) return;
	const [w] = contentSize();
	findView.setBounds({ x: Math.max(0, w - FIND_WIDTH - 12 - insets().right), y: insets().top + 6, width: FIND_WIDTH, height: FIND_HEIGHT });
}

function openFind() {
	const wc = activeContents();
	if (!wc || !findView) return;
	findOpen = true;
	layoutFind();
	win.contentView.addChildView(findView); // поверх страниц
	win.contentView.addChildView(popup);
	findView.setVisible(true);
	findView.webContents.send('find-open', findText);
	findView.webContents.focus();
}

function closeFind() {
	if (!findOpen) return;
	findOpen = false;
	findView.setVisible(false);
	const wc = activeContents();
	if (wc) {
		wc.stopFindInPage('clearSelection');
		wc.focus();
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
		item('Назад', () => goBack(), wc.navigationHistory.canGoBack());
		item('Вперёд', () => goForward(), wc.navigationHistory.canGoForward());
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
		label: short((t.pinned ? '📌 ' : '') + (tabTitle(t) || t.pendingUrl || t.url || 'Новая вкладка')),
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
		{ label: 'Дублировать', click: () => createTab(tab.pendingUrl || tab.view.webContents.getURL() || tab.url, { afterId: tab.id, title: tab.title, icon: tab.icon }) },
		{ label: 'Обновить', click: () => tab.view.webContents.reload() },
		{ type: 'separator' },
		{ label: 'Закрыть вкладку', click: () => closeTab(tab.id) },
		{ label: 'Закрыть вкладки справа', enabled: vis.slice(index + 1).some((x) => !x.pinned), click: () => vis.slice(index + 1).filter((x) => !x.pinned).forEach((x) => closeTab(x.id)) },
		{ label: 'Закрыть остальные', enabled: vis.some((x) => x !== tab && !x.pinned), click: () => vis.filter((x) => x !== tab && !x.pinned).forEach((x) => closeTab(x.id)) },
	]);
}

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
	profile = identity.build(settings().maskAs, app.getVersion());
	plainProfile = identity.build('problet', app.getVersion(), true);
	session.defaultSession.setUserAgent(profile.userAgent);
	if (incSession) incSession.setUserAgent(profile.userAgent);
	for (const t of tabs) if (!t.view.webContents.isDestroyed()) t.view.webContents.setUserAgent(profile.userAgent);
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

ipcMain.on('identity:get', (e) => {
	e.returnValue = identity.pagePayload(profileFor((e.senderFrame && e.senderFrame.url) || e.sender.getURL()) || identity.build('problet', app.getVersion()), settings().dnt);
});

// ---------- Тема и применение настроек ----------

function broadcastTheme() {
	const payload = themePayload(settings());
	if (win && !win.isDestroyed()) win.webContents.send('theme', payload);
	if (popup) popup.webContents.send('theme', payload);
	if (findView) findView.webContents.send('theme', payload);
	if (panel) panel.webContents.send('theme', payload);
	for (const t of tabs) t.view.webContents.send('theme', payload);
}

function applySettings() {
	const s = settings();
	vault.setAutoLock(s.pwLock);
	refreshIdentity();
	nativeTheme.themeSource = s.darkTheme ? 'dark' : 'light';
	win.setBackgroundColor(bgColor());
	popup.setBackgroundColor(s.darkTheme ? '#2c2c2f' : '#f0f0f5');
	if (findView) findView.setBackgroundColor(s.darkTheme ? '#2c2c2f' : '#f0f0f5');
	for (const t of tabs) t.view.setBackgroundColor(bgColor());
	broadcastTheme();
	sendLayout();
	layout();
	sendTabs();
	cache.checkRetention();
}

ipcMain.on('theme:get', (e) => {
	e.returnValue = themePayload(settings());
});

// ---------- Подсказки в адресной строке ----------

function buildSuggestions(text) {
	const q = text.trim();
	const items = [];
	const s = settings();
	const calc = q && s.calcSuggest ? tryCalc(q) : null;
	if (calc !== null) items.push({ type: 'calc', text: calc, label: q });
	const searches = s.searchSuggest ? store.searchSuggestions(q, MAX_SUGGESTIONS) : [];
	const pages = q && s.urlSuggest ? store.searchVisits(q, 12).filter((p) => !store.isSearchUrl(p.url)).slice(0, 4) : [];
	for (const h of searches.slice(0, pages.length ? 3 : MAX_SUGGESTIONS)) items.push({ type: 'history', text: h });
	for (const p of pages) items.push({ type: 'page', text: p.url, label: p.title });
	return items.slice(0, MAX_SUGGESTIONS);
}

function renderSuggest() {
	if (!popupReady || !sug.items.length) {
		hideSuggest();
		return;
	}
	popup.setBounds({
		x: sug.x,
		y: (settings().tabsPos === 'top' ? TABBAR_HEIGHT : 0) + TOOLBAR_HEIGHT - 2, // сразу под адресной строкой
		width: sug.width,
		height: sug.items.length * ROW_HEIGHT + POPUP_PADDING * 2,
	});
	popup.setVisible(true);
	popup.webContents.send('render', { items: sug.items, selected: sug.selected });
	win.webContents.send('suggest-visible', true);
}

function hideSuggest() {
	sug.items = [];
	sug.selected = -1;
	if (popup) popup.setVisible(false);
	if (win && !win.isDestroyed()) win.webContents.send('suggest-visible', false);
}

const fromToolbar = (e) => !!win && e.sender === win.webContents;
const fromPopup = (e) => !!popup && e.sender === popup.webContents;

ipcMain.on('suggest-query', (e, msg) => {
	if (!fromToolbar(e) || !msg || typeof msg.text !== 'string') return;
	if (!Number.isFinite(msg.x) || !Number.isFinite(msg.width)) return;
	sug.original = msg.text;
	sug.x = Math.round(msg.x);
	sug.width = Math.round(msg.width);
	sug.items = buildSuggestions(msg.text);
	sug.selected = -1;
	renderSuggest();
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
	} else if (item.type === 'calc') {
		// Результат калькулятора кладём в адресную строку, чтобы его можно было скопировать
		win.webContents.focus();
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
	win.webContents.focus();
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
ipcMain.on('toggle-bookmark', (e) => fromToolbar(e) && toggleBookmark());
ipcMain.on('open-internal', (e, name) => fromToolbar(e) && openInternal(name));
ipcMain.on('tab-new', (e) => fromToolbar(e) && createTab(NEWTAB));
ipcMain.on('tab-activate', (e, id) => fromToolbar(e) && activateTab(id));
ipcMain.on('tab-close', (e, id) => fromToolbar(e) && closeTab(id));
ipcMain.on('tab-menu', (e, id) => fromToolbar(e) && showTabMenu(id));
ipcMain.on('tab-move', (e, id, to) => fromToolbar(e) && moveTab(id, to));

// ---------- Подсказка у иконки обновления ----------
// Обычный title не обновляется, пока на него наведён курсор, поэтому рисуем свою маленькую панельку поверх страниц

let tipView = null;
let tipRect = null;
let tipShown = '';

function tipContent(st) {
	if (!st) return null;
	if (st.status === 'downloading') return { text: 'Скачивается версия ' + st.version + ': ' + st.progress + '%', progress: st.progress };
	if (st.status === 'ready') return { text: 'Обновить до ' + st.version + ' и перезапустить' };
	if (st.status === 'available') return { text: 'Доступна версия ' + st.version + (st.mode === 'page' ? ': открыть страницу загрузки' : ': скачать и установить') };
	return null;
}

function ensureTip() {
	if (tipView) return;
	const t = themePayload(settings());
	const html = '<!doctype html><meta charset="utf-8"><style>html,body{margin:0;height:100%;overflow:hidden}'
		+ 'body{box-sizing:border-box;padding:8px 12px;font:13px system-ui,sans-serif;background:' + (settings().darkTheme ? '#2c2c2f' : '#f0f0f5') + ';color:' + (settings().darkTheme ? '#ececf0' : '#222') + ';border:1px solid ' + (settings().darkTheme ? '#4a4a50' : '#c9c9d2') + ';border-radius:8px}'
		+ '#b{height:4px;margin-top:6px;border-radius:2px;background:rgba(128,128,128,.3);overflow:hidden}#p{height:100%;width:0;background:' + t.accent + ';transition:width .3s}</style>'
		+ '<div id="t"></div><div id="b"><div id="p"></div></div>';
	tipView = new WebContentsView({ webPreferences: { contextIsolation: true, sandbox: true } });
	tipView.setBackgroundColor('#00000000');
	tipView.setVisible(false);
	win.contentView.addChildView(tipView);
	tipView.webContents.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
}

function refreshTip() {
	if (!tipRect || !win || win.isDestroyed()) return;
	const c = tipContent(updater.getState());
	if (!c) return hideTip();
	ensureTip();
	const [cw] = contentSize();
	const w = 270;
	const h = c.progress === undefined ? 34 : 50;
	tipView.setBounds({ x: Math.round(Math.min(Math.max(8, tipRect.x + tipRect.width / 2 - w / 2), cw - w - 8)), y: Math.round(tipRect.y + tipRect.height + 6), width: w, height: h });
	win.contentView.addChildView(tipView);
	tipView.setVisible(true);
	const js = 'document.getElementById("t").textContent=' + JSON.stringify(c.text) + ';document.getElementById("b").style.display=' + (c.progress === undefined ? '"none"' : '"block"') + ';document.getElementById("p").style.width="' + (c.progress || 0) + '%"';
	tipView.webContents.executeJavaScript(js).catch(() => {});
}

function hideTip() {
	tipRect = null;
	if (tipView) tipView.setVisible(false);
}

ipcMain.on('update-tip', (e, rect) => {
	if (!fromToolbar0(e)) return;
	if (rect && Number.isFinite(rect.x) && Number.isFinite(rect.y)) {
		tipRect = { x: rect.x, y: rect.y, width: Number(rect.width) || 0, height: Number(rect.height) || 0 };
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
const PANEL_SIZE = { chars: [352, 400] };

function ensurePanel() {
	if (panel) return;
	panel = new WebContentsView({
		webPreferences: { preload: path.join(__dirname, 'preload-page.js'), contextIsolation: true, sandbox: true },
	});
	panel.setBackgroundColor(bgColor());
	panel.setVisible(false);
	win.contentView.addChildView(panel);
	// Потеря фокуса закрывает панель, но не пока она грузится: при загрузке страницы фокус на миг сбрасывается
	panel.webContents.on('blur', () => {
		if (!panelOpen || panel.webContents.isLoading() || Date.now() - panelOpenedAt < 500) return;
		closePanel();
	});
	panel.webContents.on('did-finish-load', () => {
		if (panelOpen) panel.webContents.focus();
	});
}

function closePanel() {
	if (!panelOpen) return;
	panelOpen = false;
	panelClosedAt = Date.now();
	panel.setVisible(false);
	const back = panelReturn === 'toolbar' ? win.webContents : activeContents();
	if (back && !back.isDestroyed() && !win.webContents.isFocused() && !(back === win.webContents)) back.focus();
}

// rect — положение кнопки в окне; без неё панель встаёт у верхнего края
function openPanel(kind, rect) {
	if (!PANEL_SIZE[kind] || !win || win.isDestroyed()) return;
	if (panelOpen && panelKind === kind) {
		closePanel();
		return;
	}
	if (kind === panelKind && Date.now() - panelClosedAt < 300) return; // клик по кнопке закрыл панель потерей фокуса
	ensurePanel();
	panelReturn = win.webContents.isFocused() ? 'toolbar' : 'tab';
	const [w, h] = PANEL_SIZE[kind];
	const [cw, ch] = contentSize();
	const r = rect && Number.isFinite(rect.x) ? rect : { x: cw / 2 - w / 2, y: insets().top - 4, width: 0, height: 0 };
	const x = Math.round(Math.min(Math.max(8, r.x + r.width / 2 - w / 2), Math.max(8, cw - w - 8)));
	const y = Math.round(Math.min(r.y + r.height + 4, Math.max(0, ch - 120)));
	panel.setBounds({ x, y, width: w, height: Math.min(h, Math.max(160, ch - y - 8)) });
	panelKind = kind;
	panelOpen = true;
	panelOpenedAt = Date.now();
	win.contentView.addChildView(panel);
	panel.setVisible(true);
	panel.webContents.loadURL('problet://' + kind + '/?popup=1').catch(() => {});
	panel.webContents.focus();
}

ipcMain.on('applet-open', (e, kind, rect) => {
	if (!fromToolbar0(e)) return;
	if (kind === 'spaces') openSpacesApplet();
	else openPanel(kind, rect);
});

// Апплет пространств: страница; если так выбрано в настройках, у неё нет вкладки в панели
function openSpacesApplet() {
	const url = 'problet://spaces';
	const existing = tabs.find((t) => t.space === currentSpace && (t.pendingUrl || t.url).startsWith(url));
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
	const list = tabs.filter((t) => t.space === id);
	const remembered = list.find((t) => t.id === spaceActive[id]);
	if (remembered || list.length) activateTab((remembered || list[list.length - 1]).id);
	else {
		currentSpace = id;
		createTab(NEWTAB, { space: id });
	}
	store.notify('spaces');
}

const cleanSpaceName = (n) => String(n || '').replace(/\s+/g, ' ').trim().slice(0, 40);

// ---------- API для внутренних страниц (настройки, закладки, новая вкладка) ----------

function guard(e) {
	const frame = e.senderFrame;
	const isTab = tabs.some((t) => t.view.webContents === e.sender) || (!!panel && e.sender === panel.webContents);
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

handle('hotkeys:capture', (on) => {
	capturingHotkey = !!on;
});
ipcMain.on('zoom-reset', (e) => fromToolbar(e) && zoomReset());
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
	settings: store.getSettings(),
	engines: store.engineList(),
	accents: accentList(),
	searchCount: store.searchCount(),
	version: app.getVersion(),
}));
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
handle('cache:clear', async () => {
	await cache.clearNow();
	return { message: 'Кеш очищен' };
});

// Поиск из строки на странице новой вкладки: ищем в той вкладке, откуда пришёл запрос
ipcMain.handle('search:run', (e, text) => {
	guard(e);
	const tab = tabs.find((t) => t.view.webContents === e.sender);
	const q = String(text || '').trim().slice(0, 500);
	if (!tab || !q) return;
	rememberSearch(q, tab);
	tab.pendingUrl = null;
	tab.view.webContents.loadURL(store.searchUrl(q)).catch(() => {});
});

// Открыть внутреннюю страницу (историю, закладки…) в новой вкладке
handle('page:open-tab', (name) => {
	if (!INTERNAL_PAGES.has(name) || name === 'newtab') throw new Error('Неизвестная страница');
	createTab('problet://' + name);
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
	if (wasCurrent) {
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
	wc.focus();
	wc.insertText(ch);
});

handle('visits:list', () => store.visitsList());
handle('visits:remove', (id) => {
	store.removeVisit(String(id));
});
handle('visits:clear', () => {
	store.clearVisits();
});

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

handle('bookmarks:import-items', (items) => {
	const r = store.importBookmarkItems(items);
	sendState();
	return { message: 'Добавлено закладок: ' + r.added + ', новых папок: ' + r.folders + (r.skipped ? '. Пропущено (повторы и неподходящие адреса): ' + r.skipped : '') };
});

handle('import:detect', () => importer.detect().map((s) => ({ id: s.id, name: s.name })));
handle('import:run', (id) => {
	const items = importer.read(String(id));
	if (!items.length) throw new Error('В этом браузере не найдено закладок');
	const r = store.importBookmarkItems(items);
	sendState();
	return { message: 'Добавлено закладок: ' + r.added + ', новых папок: ' + r.folders + (r.skipped ? '. Пропущено (повторы и неподходящие адреса): ' + r.skipped : '') };
});

handle('ext:list', () => extensions.list());
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
	return { message: 'Расширение «' + e.name + '» добавлено' };
});
handle('ext:remove', (p) => extensions.remove(String(p)));

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
	sendState();
	const base = 'закладок ' + s.bookmarks + ', папок ' + s.folders + ', запросов ' + s.searches;
	return { message: mode === 'replace' ? 'Данные заменены: ' + base : 'Добавлено: ' + base + (s.skipped ? '. Пропущено повторов: ' + s.skipped : '') };
});

// ---------- Окно ----------

function internalHandler(request) {
	const root = path.join(__dirname, 'pages');
	{
		const url = new URL(request.url);
		if (url.hostname === 'blocked') return adblock.blockedResponse(path.posix.basename(url.pathname)) || new Response('Not found', { status: 404 });
		if (!INTERNAL_PAGES.has(url.hostname)) return new Response('Not found', { status: 404 });
		const name = url.pathname === '/' || url.pathname === '' ? url.hostname + '.html' : path.posix.basename(url.pathname);
		if (!/^[\w-]+\.(html|js|css)$/.test(name)) return new Response('Not found', { status: 404 });
		const filePath = name === 'theme.css' ? path.join(__dirname, 'theme.css') : path.join(root, name); // тема общая для всех окон
		if (!fs.existsSync(filePath)) return new Response('Not found', { status: 404 });
		return net.fetch(pathToFileURL(filePath).toString());
	}
}

function registerInternalPages() {
	protocol.handle('problet', internalHandler);
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

function createWindow() {
	win = new BrowserWindow({
		width: 1200,
		height: 800,
		minWidth: 480,
		minHeight: 320,
		backgroundColor: bgColor(),
		icon: path.join(__dirname, 'icon.png'),
		autoHideMenuBar: true,
		frame: false, // заголовок окна рисуем сами: панель вкладок и кнопки окна лежат в нём
		title: 'Problet',
		webPreferences: {
			preload: path.join(__dirname, 'preload-toolbar.js'),
			contextIsolation: true,
			nodeIntegration: false,
		},
	});
	win.removeMenu();
	win.loadFile('index.html');
	win.on('page-title-updated', (e) => e.preventDefault());

	// Выпадающий список подсказок — отдельный слой поверх страниц
	popup = new WebContentsView({
		webPreferences: { preload: path.join(__dirname, 'preload-popup.js'), contextIsolation: true },
	});
	popup.setBackgroundColor(settings().darkTheme ? '#2c2c2f' : '#f0f0f5');
	popup.setVisible(false);
	win.contentView.addChildView(popup);
	popup.webContents.loadFile('popup.html');
	popup.webContents.once('did-finish-load', () => {
		popupReady = true;
	});

	// Панель поиска по странице — тоже отдельный слой поверх страниц
	findView = new WebContentsView({
		webPreferences: { preload: path.join(__dirname, 'preload-find.js'), contextIsolation: true },
	});
	findView.setBackgroundColor(settings().darkTheme ? '#2c2c2f' : '#f0f0f5');
	findView.setVisible(false);
	win.contentView.addChildView(findView);
	findView.webContents.loadFile('find.html');

	win.webContents.on('context-menu', (_e, params) => {
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
	win.on('maximize', sendLayout);
	win.on('unmaximize', sendLayout);
	win.webContents.on('before-input-event', hotkeys);
	win.webContents.on('did-finish-load', () => {
		if (started) return;
		started = true;
		openStartupTabs();
	});
}

// Второй запуск (например, «открыть ссылку в Problet» из системы) открывает адрес в новой вкладке уже запущенного окна
const gotLock = app.requestSingleInstanceLock();
app.on('second-instance', (_e, argv) => {
	if (!win) return;
	if (win.isMinimized()) win.restore();
	win.focus();
	const arg = argv.slice(app.isPackaged ? 1 : 2).find((x) => !x.startsWith('-'));
	const r = arg && resolveInput(arg, true);
	if (r) createTab(r.url);
});

app.whenReady().then(() => {
	if (!gotLock) {
		app.quit();
		return;
	}
	store.init(app.getPath('userData'));
	vault.init(app.getPath('userData'), { onLock: () => sendState() });
	vault.setAutoLock(settings().pwLock);
	nativeTheme.themeSource = settings().darkTheme ? 'dark' : 'light';
	registerInternalPages();
	cache.start(session.defaultSession, store);
	adblock.start(session.defaultSession, store);
	startIdentity(session.defaultSession);
	setupDownloads(session.defaultSession);
	extensions.init(session.defaultSession, app.getPath('userData')).catch(() => {});
	createWindow();
	updater.onChange((st) => {
		if (win && !win.isDestroyed()) win.webContents.send('update-state', st);
		refreshTip();
	});
	updater.schedule(() => settings().autoUpdate, () => settings().autoRestart);
});
app.on('before-quit', () => store.flush());
app.on('window-all-closed', () => app.quit());
