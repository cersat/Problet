// Хранилище: настройки, закладки, папки, история поиска. Всё лежит в одном data.json

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ACCENTS } = require('./theme');
const accel = require('./pages/accel');

const ENGINES = {
	duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s' },
	google: { name: 'Google', url: 'https://www.google.com/search?q=%s' },
	brave: { name: 'Brave Search', url: 'https://search.brave.com/search?q=%s' },
	bing: { name: 'Bing', url: 'https://www.bing.com/search?q=%s' },
	yandex: { name: 'Яндекс', url: 'https://yandex.com/search/?text=%s' },
};
const DEFAULT_SPACE = 'main';
const SPACES_LIMIT = 30;
const HISTORY_LIMIT = 500;
const BOOKMARKS_LIMIT = 50000;
const VISITS_LIMIT = 5000;
const DOWNLOADS_LIMIT = 200;
const VISIT_PROTOCOLS = /^(https?|file):/i;
const ALLOWED_PROTOCOLS = ['http:', 'https:', 'file:', 'problet:'];
const BAD_URL = 'Некорректный адрес. Допустимы http://, https:// и file://';

// Остальные настройки проверяются по схеме: переключатели и списки допустимых значений
const SETTING_DEFAULTS = {
	engine: 'duckduckgo',
	customTemplate: '',
	showUrlInTabs: false,
	showTabIcons: true,
	startup: 'newtab',
	startupUrl: '',
	tabOverflow: 'shrink',
	settingsAsTab: true,
	darkTheme: true,
	accent: 'default',
	cacheKeep: 'always',
	cacheIcons: true,
	cachePages: true,
	cacheImages: true,
	askDownload: false,
	saveHistory: true,
	adblock: false,
	adblockYoutube: true,
	adblockStub: true,
	calcSuggest: true,
	searchSuggest: true,
	dnt: false,
	autoUpdate: true,
	updateEvery: '360',
	updateFaster: false,
	autoRestart: false,
	pwOffer: true,
	pwFill: true,
	pwLock: '15',
	maskAs: 'problet',
	urlSuggest: true,
	incognitoAsk: true,
	downloadDir: '',
	tabsPos: 'top',
	bmPos: 'top',
	bmOnlyIcons: false,
	bookmarksBar: true,
	tabsNewButton: true,
	winButtons: true,
	appPasswords: true,
	appHistory: true,
	appSettings: true,
	appDownloads: true,
	appUpdate: true,
	appBookmarks: true,
	appChars: true,
	appSpaces: true,
	spacesPopup: false,
	spacesMerged: false,
	noDuplicateTabs: false,
	freezeStart: true,
	freezeSpaces: false,
	freezeDiscard: false,
	freezeAfter: '0',
	warnInsecure: false,
	customBlock: '',
	bmNewTab: false,
	hotkeys: {}, // только изменённые: { действие: 'Ctrl+Shift+X' }, пустая строка — клавиша отключена
};
const BOOL_SETTINGS = ['showUrlInTabs', 'showTabIcons', 'settingsAsTab', 'darkTheme', 'cacheIcons', 'cachePages', 'cacheImages', 'askDownload', 'saveHistory', 'adblock', 'adblockYoutube', 'adblockStub', 'calcSuggest', 'searchSuggest', 'dnt', 'autoUpdate', 'updateFaster', 'autoRestart', 'pwOffer', 'pwFill', 'urlSuggest', 'incognitoAsk', 'bmOnlyIcons', 'bookmarksBar', 'tabsNewButton', 'winButtons', 'appPasswords', 'appHistory', 'appSettings', 'appDownloads', 'appUpdate', 'appBookmarks', 'appChars', 'appSpaces', 'spacesPopup', 'spacesMerged', 'noDuplicateTabs', 'freezeStart', 'freezeSpaces', 'freezeDiscard', 'warnInsecure', 'bmNewTab'];
const ENUM_SETTINGS = {
	startup: ['newtab', 'url', 'session'],
	tabOverflow: ['shrink', 'scroll'],
	accent: Object.keys(ACCENTS),
	cacheKeep: ['always', 'month', 'week', 'day', 'hour', 'restart'],
	maskAs: ['chrome', 'problet', 'firefox'],
	tabsPos: ['top', 'bottom', 'left', 'right'],
	bmPos: ['top', 'bottom'],
	freezeAfter: ['1', '2', '5', '10', '30', '60', '120', '300', '600', '1440', '0'], // через сколько минут без просмотра вкладка замораживается; 0 — никогда
	updateEvery: ['15', '30', '60', '180', '360', '720', '1440'], // период авто-проверки обновлений в минутах
	pwLock: ['5', '15', '60', '0'], // через сколько минут бездействия хранилище паролей запирается; 0 — никогда
};

let file = null;
let data = defaults();
let timer = null;

function defaults() {
	return {
		settings: { ...SETTING_DEFAULTS },
		folders: [],
		bookmarks: [],
		searchHistory: [],
		session: sanitizeSession({}),
		cacheClearedAt: 0,
		visits: [],
		downloads: [],
		zoom: {},
		blockedTotal: 0,
	};
}

function newId() {
	return crypto.randomUUID();
}

function str(v, max) {
	return typeof v === 'string' ? v.slice(0, max) : '';
}

function cleanUrl(v) {
	const s = str(v, 2048).trim();
	try {
		return ALLOWED_PROTOCOLS.includes(new URL(s).protocol) ? s : '';
	} catch (e) {
		return '';
	}
}

function cleanIcon(v) {
	const s = cleanUrl(v);
	return /^https?:/i.test(s) ? s : '';
}

function validTemplate(t) {
	return typeof t === 'string' && t.length <= 500 && /^https?:\/\/\S+$/i.test(t.trim()) && t.includes('%s');
}

// Оставляем только известные действия с допустимыми сочетаниями, без повторов
function cleanHotkeys(raw) {
	const out = {};
	if (!raw || typeof raw !== 'object') return out;
	const known = new Map(accel.ACTIONS.map((a) => [a.id, a.key]));
	const used = new Set();
	for (const a of accel.ACTIONS) {
		const v = Object.hasOwn(raw, a.id) ? raw[a.id] : undefined;
		if (typeof v !== 'string' || !accel.valid(v) || v === known.get(a.id)) continue;
		out[a.id] = v;
	}
	// Сочетание не должно назначаться двум действиям сразу
	for (const a of accel.ACTIONS) {
		const eff = Object.hasOwn(out, a.id) ? out[a.id] : a.key;
		if (!eff) continue;
		if (used.has(eff)) {
			if (Object.hasOwn(out, a.id)) delete out[a.id];
			continue;
		}
		used.add(eff);
	}
	return out;
}

// true, если у настроек есть горячая клавиша (своя или по умолчанию)
function settingsReachableByKey(hotkeys) {
	const h = hotkeys || {};
	return !!(Object.hasOwn(h, 'settings') ? h.settings : accel.ACTIONS.find((a) => a.id === 'settings').key);
}

function sanitizeSettings(raw) {
	const r = raw && typeof raw === 'object' ? raw : {};
	const out = { ...SETTING_DEFAULTS };
	for (const key of BOOL_SETTINGS) {
		if (typeof r[key] === 'boolean') out[key] = r[key];
	}
	for (const [key, values] of Object.entries(ENUM_SETTINGS)) {
		if (values.includes(r[key])) out[key] = r[key];
	}
	out.hotkeys = cleanHotkeys(r.hotkeys);
	out.startupUrl = str(r.startupUrl, 2048).trim();
	out.customBlock = str(r.customBlock, 200000);
	out.downloadDir = typeof r.downloadDir === 'string' && r.downloadDir.length <= 1024 && path.isAbsolute(r.downloadDir) ? r.downloadDir : '';
	if (!settingsReachableByKey(out.hotkeys)) out.appSettings = true;
	out.customTemplate = validTemplate(r.customTemplate) ? r.customTemplate.trim() : '';
	let engine = typeof r.engine === 'string' ? r.engine : 'duckduckgo';
	if (engine === 'custom' ? !out.customTemplate : !Object.hasOwn(ENGINES, engine)) engine = 'duckduckgo';
	out.engine = engine;
	return out;
}

// Вкладки прошлого запуска: только безопасные адреса, не больше 200 штук
function sanitizeSession(raw) {
	const r = raw && typeof raw === 'object' ? raw : {};
	const tabs = [];
	for (const t of (Array.isArray(r.tabs) ? r.tabs : []).slice(0, 200)) {
		if (!t || typeof t !== 'object') continue;
		const url = cleanUrl(t.url);
		if (url) tabs.push({ url, title: str(t.title, 300), icon: cleanIcon(t.icon), pinned: t.pinned === true, space: str(t.space, 40) || DEFAULT_SPACE });
	}
	const active = Math.min(Math.max(0, Math.floor(Number(r.active)) || 0), Math.max(0, tabs.length - 1));
	// Пространства: всегда есть основное, остальные по порядку
	const spaces = [];
	for (const sp of (Array.isArray(r.spaces) ? r.spaces : []).slice(0, SPACES_LIMIT)) {
		if (!sp || typeof sp !== 'object') continue;
		const id = str(sp.id, 40);
		const name = str(sp.name, 40).trim();
		if (id && name && !spaces.some((x) => x.id === id)) spaces.push({ id, name });
	}
	if (!spaces.some((x) => x.id === DEFAULT_SPACE)) spaces.unshift({ id: DEFAULT_SPACE, name: 'Основное' });
	for (const t of tabs) if (!spaces.some((x) => x.id === t.space)) t.space = DEFAULT_SPACE;
	const space = spaces.some((x) => x.id === r.space) ? r.space : DEFAULT_SPACE;
	return { tabs, active, spaces, space };
}

// История посещений: новые сверху, только http/https/file
function sanitizeVisits(raw) {
	const out = [];
	for (const v of (Array.isArray(raw) ? raw : []).slice(0, VISITS_LIMIT)) {
		if (!v || typeof v !== 'object') continue;
		const url = cleanUrl(v.url);
		if (!url || !VISIT_PROTOCOLS.test(url)) continue;
		out.push({ id: str(v.id, 64) || newId(), url, title: str(v.title, 300), time: Number.isFinite(v.time) ? v.time : 0 });
	}
	return out;
}

// Список загрузок: хранятся только завершённые
function sanitizeDownloads(raw) {
	const out = [];
	for (const d of (Array.isArray(raw) ? raw : []).slice(0, DOWNLOADS_LIMIT)) {
		if (!d || typeof d !== 'object') continue;
		const name = str(d.name, 300);
		const filePath = str(d.path, 1024);
		if (!name || !filePath) continue;
		out.push({
			id: str(d.id, 64) || newId(),
			name,
			path: filePath,
			url: str(d.url, 2048),
			size: Math.max(0, Number(d.size) || 0),
			state: ['done', 'cancelled', 'failed'].includes(d.state) ? d.state : 'failed',
			time: Number.isFinite(d.time) ? d.time : 0,
		});
	}
	return out;
}

function sanitizeBookmark(b, folderIds, usedIds) {
	if (!b || typeof b !== 'object') return null;
	const url = cleanUrl(b.url);
	if (!url) return null;
	let id = str(b.id, 64);
	if (!id || usedIds.has(id)) id = newId();
	usedIds.add(id);
	return {
		id,
		title: str(b.title, 300).trim() || url,
		url,
		icon: cleanIcon(b.icon),
		folder: folderIds.has(b.folder) ? b.folder : null,
		added: Number.isFinite(b.added) ? b.added : Date.now(),
	};
}

// Масштаб по сайтам: { хост: уровень Electron }, уровень 0 — это 100% и не хранится
const ZOOM_LIMIT = 500;

function sanitizeZoom(raw) {
	const out = {};
	if (!raw || typeof raw !== 'object') return out;
	for (const [host, level] of Object.entries(raw).slice(0, ZOOM_LIMIT)) {
		if (typeof host === 'string' && host.length <= 253 && Number.isFinite(level) && level !== 0 && Math.abs(level) <= 9) out[host] = level;
	}
	return out;
}

// Сколько рекламных запросов заблокировано за всё время
function addBlocked() {
	data.blockedTotal++;
	scheduleSave();
}

const blockedTotal = () => data.blockedTotal;

function getZoom(host) {
	return Object.hasOwn(data.zoom, host) ? data.zoom[host] : 0;
}

function setZoom(host, level) {
	if (!host || host.length > 253) return;
	if (!level) delete data.zoom[host];
	else if (Object.keys(data.zoom).length < ZOOM_LIMIT || Object.hasOwn(data.zoom, host)) data.zoom[host] = level;
	scheduleSave();
}

// Приводит что угодно (файл с диска, импорт) к безопасному виду
function sanitize(raw) {
	const r = raw && typeof raw === 'object' ? raw : {};
	const out = {
		settings: sanitizeSettings(r.settings),
		folders: [],
		bookmarks: [],
		searchHistory: [],
		session: sanitizeSession(r.session),
		cacheClearedAt: Number.isFinite(r.cacheClearedAt) ? r.cacheClearedAt : 0,
		visits: sanitizeVisits(r.visits),
		downloads: sanitizeDownloads(r.downloads),
		zoom: sanitizeZoom(r.zoom),
		blockedTotal: Number.isSafeInteger(r.blockedTotal) && r.blockedTotal > 0 ? r.blockedTotal : 0,
	};

	const folderIds = new Set();
	for (const f of Array.isArray(r.folders) ? r.folders : []) {
		if (!f || typeof f !== 'object') continue;
		const name = str(f.name, 100).trim();
		if (!name) continue;
		let id = str(f.id, 64);
		if (!id || folderIds.has(id)) id = newId();
		folderIds.add(id);
		out.folders.push({ id, name });
	}

	const usedIds = new Set();
	for (const b of (Array.isArray(r.bookmarks) ? r.bookmarks : []).slice(0, BOOKMARKS_LIMIT)) {
		const bm = sanitizeBookmark(b, folderIds, usedIds);
		if (bm) out.bookmarks.push(bm);
	}

	const seen = new Map();
	for (const h of (Array.isArray(r.searchHistory) ? r.searchHistory : []).slice(0, HISTORY_LIMIT * 4)) {
		if (!h || typeof h !== 'object') continue;
		const q = str(h.q, 200).trim();
		if (!q) continue;
		const count = Math.max(1, Math.floor(Number(h.count)) || 1);
		const last = Number.isFinite(h.last) ? h.last : 0;
		const cur = seen.get(q.toLowerCase());
		if (cur) {
			cur.count += count;
			cur.last = Math.max(cur.last, last);
		} else {
			seen.set(q.toLowerCase(), { q, count, last });
		}
	}
	out.searchHistory = [...seen.values()];
	return out;
}

function init(dir) {
	file = path.join(dir, 'data.json');
	let raw = null;
	try {
		raw = JSON.parse(fs.readFileSync(file, 'utf8'));
	} catch (e) {
		if (fs.existsSync(file)) {
			try {
				fs.copyFileSync(file, file + '.broken'); // не затираем повреждённый файл молча
			} catch (e2) { /* ничего не поделаешь */ }
		}
	}
	data = sanitize(raw);
	trimHistory();
}

function save() {
	clearTimeout(timer);
	timer = null;
	if (!file) return;
	try {
		const tmp = file + '.tmp';
		fs.writeFileSync(tmp, JSON.stringify(data), 'utf8');
		fs.renameSync(tmp, file);
	} catch (e) {
		console.error('Не удалось сохранить данные:', e.message);
	}
}

// Подписчики на изменения данных: главный процесс по ним обновляет открытые страницы браузера
const listeners = [];

function onChange(cb) {
	listeners.push(cb);
}

function changed(kind) {
	for (const cb of listeners) cb(kind);
}

function scheduleSave() {
	if (!timer) timer = setTimeout(save, 300);
}

function flush() {
	if (timer) save();
}

// ---------- Сессия и служебные отметки ----------

function getSession() {
	return data.session;
}

function setSession(raw) {
	data.session = sanitizeSession(raw);
	scheduleSave();
}

function getCacheClearedAt() {
	return data.cacheClearedAt;
}

function setCacheClearedAt(time) {
	data.cacheClearedAt = time;
	scheduleSave();
}

// ---------- История посещений и загрузки ----------

function addVisit(url, title) {
	if (!data.settings.saveHistory) return;
	const u = cleanUrl(url);
	if (!u || !VISIT_PROTOCOLS.test(u)) return;
	const now = Date.now();
	const last = data.visits[0];
	if (last && last.url === u && now - last.time < 30000) {
		last.time = now; // обновление страницы не плодит записи
	} else {
		data.visits.unshift({ id: newId(), url: u, title: str(title, 300), time: now });
		if (data.visits.length > VISITS_LIMIT) data.visits.length = VISITS_LIMIT;
	}
	scheduleSave();
	changed('visits');
}

function updateVisitTitle(url, title) {
	const t = str(title, 300);
	if (!t) return;
	const v = data.visits.slice(0, 20).find((x) => x.url === url);
	if (v && v.title !== t) {
		v.title = t;
		scheduleSave();
		changed('visits');
	}
}

function visitsList() {
	return data.visits.map((v) => ({ ...v }));
}

function removeVisit(id) {
	data.visits = data.visits.filter((v) => v.id !== id);
	scheduleSave();
	changed('visits');
}

function clearVisits() {
	data.visits = [];
	scheduleSave();
	changed('visits');
}

// Для подсказок адресной строки: страницы, в названии или адресе которых есть все слова запроса
function searchVisits(query, limit) {
	const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
	if (!words.length) return [];
	const seen = new Set();
	const out = [];
	for (const v of data.visits) {
		if (seen.has(v.url)) continue;
		const hay = (v.title + ' ' + v.url).toLowerCase();
		if (!words.every((w) => hay.includes(w))) continue;
		seen.add(v.url);
		out.push({ url: v.url, title: v.title });
		if (out.length >= limit) break;
	}
	return out;
}

function getDownloads() {
	return data.downloads;
}

function setDownloads(list) {
	data.downloads = sanitizeDownloads(list);
	scheduleSave();
}

// ---------- Настройки и поиск ----------

function resetSettings() {
	data.settings = sanitizeSettings({});
	scheduleSave();
	changed('settings');
	return getSettings();
}

function getSettings() {
	return { ...data.settings };
}

function engineList() {
	return [...Object.entries(ENGINES).map(([id, e]) => ({ id, name: e.name })), { id: 'custom', name: 'Свой' }];
}

function setSettings(patch) {
	const next = { ...data.settings };
	if (patch && patch.engine !== undefined) {
		if (patch.engine !== 'custom' && !Object.hasOwn(ENGINES, patch.engine)) throw new Error('Неизвестный поисковик');
		next.engine = patch.engine;
	}
	if (patch && patch.customTemplate !== undefined) {
		const t = String(patch.customTemplate).trim();
		if (t && !validTemplate(t)) throw new Error('Шаблон должен начинаться с http:// или https:// и содержать %s');
		next.customTemplate = t;
	}
	const p = patch && typeof patch === 'object' ? patch : {};
	for (const key of BOOL_SETTINGS) {
		if (p[key] === undefined) continue;
		if (typeof p[key] !== 'boolean') throw new Error('Некорректное значение настройки: ' + key);
		next[key] = p[key];
	}
	for (const [key, values] of Object.entries(ENUM_SETTINGS)) {
		if (p[key] === undefined) continue;
		if (!values.includes(p[key])) throw new Error('Некорректное значение настройки: ' + key);
		next[key] = p[key];
	}
	if (p.hotkeys !== undefined) {
		if (!p.hotkeys || typeof p.hotkeys !== 'object' || Array.isArray(p.hotkeys)) throw new Error('Некорректные горячие клавиши');
		const clean = cleanHotkeys(p.hotkeys);
		const given = Object.keys(p.hotkeys).filter((k) => accel.ACTIONS.some((a) => a.id === k) && p.hotkeys[k] !== accel.ACTIONS.find((a) => a.id === k).key);
		if (given.some((k) => !Object.hasOwn(clean, k))) throw new Error('Такое сочетание уже занято или записано неверно');
		next.hotkeys = clean;
	}
	if (p.startupUrl !== undefined) {
		const u = str(p.startupUrl, 2048).trim();
		if (/^(javascript|vbscript):/i.test(u)) throw new Error('Некорректный адрес стартовой страницы');
		next.startupUrl = u;
	}
	if (p.customBlock !== undefined) {
		if (typeof p.customBlock !== 'string' || p.customBlock.length > 200000) throw new Error('Список слишком длинный');
		next.customBlock = p.customBlock;
	}
	if (p.downloadDir !== undefined) {
		if (typeof p.downloadDir !== 'string' || p.downloadDir.length > 1024 || (p.downloadDir && !path.isAbsolute(p.downloadDir))) throw new Error('Некорректная папка загрузок');
		next.downloadDir = p.downloadDir;
	}
	if (next.engine === 'custom' && !next.customTemplate) throw new Error('Укажи шаблон адреса для своего поисковика');
	// Панель настроек нельзя убрать, пока у настроек нет горячей клавиши: иначе до них не добраться
	if (!settingsReachableByKey(next.hotkeys)) next.appSettings = true;
	data.settings = next;
	scheduleSave();
	changed('settings');
	return getSettings();
}

// Страница результатов поиска одного из поисковиков (в подсказках она только дублирует историю поиска)
function isSearchUrl(url) {
	const templates = Object.values(ENGINES).map((e) => e.url);
	if (data.settings.customTemplate) templates.push(data.settings.customTemplate);
	return templates.some((t) => url.startsWith(t.slice(0, t.indexOf('%s'))));
}

function searchUrl(text) {
	const s = data.settings;
	const template = s.engine === 'custom' ? s.customTemplate : ENGINES[s.engine].url;
	return template.split('%s').join(encodeURIComponent(text));
}

function trimHistory() {
	if (data.searchHistory.length > HISTORY_LIMIT) {
		data.searchHistory.sort((a, b) => b.last - a.last);
		data.searchHistory.length = HISTORY_LIMIT;
	}
}

function addSearch(query) {
	const q = str(query, 200).trim();
	if (!q) return;
	const key = q.toLowerCase();
	const h = data.searchHistory.find((x) => x.q.toLowerCase() === key);
	if (h) {
		h.q = q;
		h.count++;
		h.last = Date.now();
	} else {
		data.searchHistory.push({ q, count: 1, last: Date.now() });
		trimHistory();
	}
	scheduleSave();
	changed('searches');
}

function removeSearch(query) {
	const key = String(query).toLowerCase();
	data.searchHistory = data.searchHistory.filter((x) => x.q.toLowerCase() !== key);
	scheduleSave();
	changed('searches');
}

function clearSearches() {
	data.searchHistory = [];
	scheduleSave();
	changed('searches');
}

function searchCount() {
	return data.searchHistory.length;
}

// Подсказки из истории: совпадения с началом запроса выше, дальше — свежие
function searchSuggestions(query, limit) {
	const key = String(query).trim().toLowerCase();
	let list = data.searchHistory;
	if (key) list = list.filter((h) => h.q.toLowerCase() !== key && h.q.toLowerCase().includes(key));
	return list
		.slice()
		.sort((a, b) => {
			if (key) {
				const as = a.q.toLowerCase().startsWith(key);
				const bs = b.q.toLowerCase().startsWith(key);
				if (as !== bs) return as ? -1 : 1;
			}
			return b.last - a.last;
		})
		.slice(0, limit)
		.map((h) => h.q);
}

// ---------- Закладки ----------

function bookmarksState() {
	return { bookmarks: data.bookmarks, folders: data.folders };
}

function findBookmarkByUrl(url) {
	return data.bookmarks.find((b) => b.url === url) || null;
}

function folderIdSet() {
	return new Set(data.folders.map((f) => f.id));
}

function addBookmark(b) {
	if (data.bookmarks.length >= BOOKMARKS_LIMIT) throw new Error('Слишком много закладок');
	const bm = sanitizeBookmark({ ...b, id: '', added: Date.now() }, folderIdSet(), new Set(data.bookmarks.map((x) => x.id)));
	if (!bm) throw new Error(BAD_URL);
	const existing = findBookmarkByUrl(bm.url);
	if (existing) return existing;
	data.bookmarks.push(bm);
	scheduleSave();
	changed('bookmarks');
	return bm;
}

function updateBookmark(id, patch) {
	const b = data.bookmarks.find((x) => x.id === id);
	if (!b) throw new Error('Закладка не найдена');
	if (patch.url !== undefined) {
		const url = cleanUrl(patch.url);
		if (!url) throw new Error(BAD_URL);
		b.url = url;
	}
	if (patch.title !== undefined) b.title = str(patch.title, 300).trim() || b.url;
	if (patch.folder !== undefined) b.folder = folderIdSet().has(patch.folder) ? patch.folder : null;
	scheduleSave();
	changed('bookmarks');
}

function removeBookmark(id) {
	data.bookmarks = data.bookmarks.filter((x) => x.id !== id);
	scheduleSave();
	changed('bookmarks');
}

// Для «Отменить» после удаления: возвращает закладку с прежним id и датой
function restoreBookmark(raw) {
	const bm = sanitizeBookmark(raw, folderIdSet(), new Set(data.bookmarks.map((x) => x.id)));
	if (bm && !findBookmarkByUrl(bm.url)) {
		data.bookmarks.push(bm);
		scheduleSave();
		changed('bookmarks');
	}
}

function addFolder(name) {
	const n = str(name, 100).trim();
	if (!n) throw new Error('Введи название папки');
	const existing = data.folders.find((f) => f.name.toLowerCase() === n.toLowerCase());
	if (existing) return existing;
	const f = { id: newId(), name: n };
	data.folders.push(f);
	scheduleSave();
	changed('bookmarks');
	return f;
}

function renameFolder(id, name) {
	const f = data.folders.find((x) => x.id === id);
	const n = str(name, 100).trim();
	if (!f) throw new Error('Папка не найдена');
	if (!n) throw new Error('Введи название папки');
	f.name = n;
	scheduleSave();
	changed('bookmarks');
}

// Закладки из удалённой папки остаются, просто без папки
function removeFolder(id) {
	data.folders = data.folders.filter((f) => f.id !== id);
	for (const b of data.bookmarks) {
		if (b.folder === id) b.folder = null;
	}
	scheduleSave();
	changed('bookmarks');
}

// Импорт закладок из HTML других браузеров: уже существующие адреса пропускаются
function importBookmarkItems(items) {
	if (!Array.isArray(items)) throw new Error('Некорректные данные');
	const urls = new Set(data.bookmarks.map((b) => b.url));
	const base = Date.now();
	let added = 0;
	let skipped = 0;
	let folders = 0;
	items.slice(0, BOOKMARKS_LIMIT).forEach((it, index) => {
		const url = it && typeof it === 'object' ? cleanUrl(it.url) : '';
		if (!url || urls.has(url)) {
			skipped++;
			return;
		}
		urls.add(url);
		let folder = null;
		const name = str(it.folder, 100).trim();
		if (name) {
			let f = data.folders.find((x) => x.name.toLowerCase() === name.toLowerCase());
			if (!f) {
				f = { id: newId(), name };
				data.folders.push(f);
				folders++;
			}
			folder = f.id;
		}
		data.bookmarks.push({ id: newId(), title: str(it.title, 300).trim() || url, url, icon: '', folder, added: base - index });
		added++;
	});
	scheduleSave();
	changed('bookmarks');
	return { added, skipped, folders };
}

function escapeHtml(s) {
	return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// Формат Netscape — его понимают Chrome, Firefox, Vivaldi и остальные
function exportBookmarksHtml() {
	const line = (b, indent) => indent + '<DT><A HREF="' + escapeHtml(b.url) + '" ADD_DATE="' + Math.floor(b.added / 1000) + '"'
		+ (b.icon ? ' ICON_URI="' + escapeHtml(b.icon) + '"' : '') + '>' + escapeHtml(b.title) + '</A>';
	const out = [
		'<!DOCTYPE NETSCAPE-Bookmark-file-1>',
		'<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
		'<TITLE>Bookmarks</TITLE>',
		'<H1>Bookmarks</H1>',
		'<DL><p>',
	];
	for (const f of data.folders) {
		out.push('\t<DT><H3>' + escapeHtml(f.name) + '</H3>', '\t<DL><p>');
		for (const b of data.bookmarks) {
			if (b.folder === f.id) out.push(line(b, '\t\t'));
		}
		out.push('\t</DL><p>');
	}
	for (const b of data.bookmarks) {
		if (!b.folder) out.push(line(b, '\t'));
	}
	out.push('</DL><p>', '');
	return out.join('\n');
}

// ---------- Резервная копия ----------

function exportData() {
	return {
		app: 'problet',
		version: 1,
		exported: new Date().toISOString(),
		settings: data.settings,
		folders: data.folders,
		bookmarks: data.bookmarks,
		searchHistory: data.searchHistory,
	};
}

function looksLikeBackup(raw) {
	return !!raw && typeof raw === 'object' && !Array.isArray(raw)
		&& (raw.app === 'problet' || Array.isArray(raw.bookmarks) || Array.isArray(raw.searchHistory));
}

// mode: 'merge' — добавить к текущим (настройки не трогаем), 'replace' — заменить всё
function importData(raw, mode) {
	const inc = sanitize(raw);
	if (mode === 'replace') {
		const hasSettings = raw.settings && typeof raw.settings === 'object';
		data = {
			...inc,
			settings: hasSettings ? inc.settings : data.settings,
			session: data.session,
			cacheClearedAt: data.cacheClearedAt,
			visits: data.visits,
			downloads: data.downloads,
			zoom: data.zoom,
			blockedTotal: data.blockedTotal,
		};
		trimHistory();
		scheduleSave();
		changed('all');
		return { bookmarks: inc.bookmarks.length, folders: inc.folders.length, searches: inc.searchHistory.length, skipped: 0 };
	}

	const folderMap = new Map();
	let folders = 0;
	for (const f of inc.folders) {
		let target = data.folders.find((x) => x.name.toLowerCase() === f.name.toLowerCase());
		if (!target) {
			target = { id: data.folders.some((x) => x.id === f.id) ? newId() : f.id, name: f.name };
			data.folders.push(target);
			folders++;
		}
		folderMap.set(f.id, target.id);
	}

	const urls = new Set(data.bookmarks.map((b) => b.url));
	const ids = new Set(data.bookmarks.map((b) => b.id));
	let bookmarks = 0;
	let skipped = 0;
	for (const b of inc.bookmarks) {
		if (urls.has(b.url)) {
			skipped++;
			continue;
		}
		urls.add(b.url);
		const id = ids.has(b.id) ? newId() : b.id;
		ids.add(id);
		data.bookmarks.push({ ...b, id, folder: b.folder ? folderMap.get(b.folder) || null : null });
		bookmarks++;
	}

	let searches = 0;
	for (const h of inc.searchHistory) {
		const cur = data.searchHistory.find((x) => x.q.toLowerCase() === h.q.toLowerCase());
		if (cur) {
			cur.count += h.count;
			cur.last = Math.max(cur.last, h.last);
		} else {
			data.searchHistory.push(h);
			searches++;
		}
	}
	trimHistory();
	scheduleSave();
	changed('all');
	return { bookmarks, folders, searches, skipped };
}

module.exports = {
	init, flush,
	getSettings, setSettings, resetSettings, engineList, searchUrl,
	addSearch, removeSearch, clearSearches, searchCount, searchSuggestions,
	bookmarksState, findBookmarkByUrl, addBookmark, updateBookmark, removeBookmark, restoreBookmark,
	addFolder, renameFolder, removeFolder, importBookmarkItems, exportBookmarksHtml,
	exportData, looksLikeBackup, importData,
	getSession, setSession, getCacheClearedAt, setCacheClearedAt,
	onChange, notify: changed, DEFAULT_SPACE,
	addBlocked, blockedTotal,
	getZoom, setZoom,
	addVisit, isSearchUrl, updateVisitTitle, visitsList, removeVisit, clearVisits, searchVisits, getDownloads, setDownloads,
};
