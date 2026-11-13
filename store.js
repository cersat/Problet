// Хранилище: настройки, закладки, папки, история поиска. Всё лежит в одном data.json

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ACCENTS, HEX, TINTS, CONTRASTS, UI_SCALES, PRESETS } = require('./theme');
const accel = require('./pages/accel');

const ENGINES = {
	duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s' },
	google: { name: 'Google', url: 'https://www.google.com/search?q=%s' },
	brave: { name: 'Brave Search', url: 'https://search.brave.com/search?q=%s' },
	bing: { name: 'Bing', url: 'https://www.bing.com/search?q=%s' },
	yandex: { name: 'Яндекс', url: 'https://yandex.com/search/?text=%s' },
};
// Панель вкладок можно растянуть до двойного размера; вкладки в два слоя — когда она растянута хотя бы настолько
const TWO_ROWS_MIN = 1.8;

// Стрелки «назад» и «вперёд» (в панели, в настройках перемещения кнопок)
const ARROWS = { tri: ['◀', '▶'], arrow: ['←', '→'], angle: ['‹', '›'], heavy: ['❮', '❯'], double: ['«', '»'], dbl: ['⇐', '⇒'], outline: ['◁', '▷'], curved: ['↩', '↪'] };

// Панели в порядке сверху вниз; page — окно со страницей. Всё, что выше page, находится над страницей, ниже — под ней
const PANELS = ['tabs', 'toolbar', 'bmbar'];
const DEFAULT_ORDER = ['tabs', 'toolbar', 'bmbar', 'page'];
// Кнопки на панелях. m:… — главный элемент панели (вкладки, адресная строка, закладки): его нельзя убрать или переселить, он нужен только как точка отсчёта
const MAIN_OF = { 'm:tabs': 'tabs', 'm:address': 'toolbar', 'm:bookmarks': 'bmbar' };
// sp1–sp3 — переменные промежутки: занимают свободное место на панели; на одной панели не больше одного
const SPACERS = ['sp1', 'sp2', 'sp3'];
// x:<id расширения> — кнопка расширения, у каждого своя
const EXT_BTN = /^x:([a-p]{32}|@[a-z0-9][a-z0-9-]{0,39})$/; // расширение Chrome или @аддон Problet
const BUTTONS = ['spaces', 'newtab', 'winctl', ...SPACERS, 'back', 'forward', 'reload', 'update', 'darkpage', 'chars', 'bookmarks', 'passwords', 'history', 'downloads', 'settings'];
function defaultButtons() {
	return {
		tabs: ['spaces', 'm:tabs', 'newtab', 'sp1', 'winctl'],
		toolbar: ['back', 'forward', 'reload', 'm:address', 'update', 'chars', 'bookmarks', 'passwords', 'history', 'downloads', 'settings'],
		bmbar: ['m:bookmarks', 'sp3'],
		hidden: ['sp2', 'darkpage'],
	};
}

// Свои кнопки: название, значок и действие (адрес, скрипт на странице или команда браузера)
const CUSTOM_LIMIT = 20;
const CUSTOM_TYPES = ['url', 'script', 'action'];
function cleanCustom(raw) {
	const out = [];
	const used = new Set();
	for (const c of Array.isArray(raw) ? raw.slice(0, CUSTOM_LIMIT) : []) {
		if (!c || typeof c !== 'object' || !CUSTOM_TYPES.includes(c.type)) continue;
		const id = typeof c.id === 'string' && /^cb:[a-z0-9]{6,16}$/.test(c.id) && !used.has(c.id) ? c.id : '';
		if (!id) continue;
		let value = '';
		if (c.type === 'url') value = cleanUrl(c.value);
		else if (c.type === 'script') value = str(c.value, 20000).trim();
		else value = accel.ACTIONS.some((a) => a.id === c.value) ? c.value : '';
		if (!value) continue;
		used.add(id);
		const name = str(c.name, 40).trim() || 'Кнопка';
		out.push({ id, name, icon: str(c.icon, 4).trim() || name[0].toUpperCase(), svg: cleanCustomIcon(c.svg), type: c.type, value, newTab: c.type === 'url' && c.newTab === true });
	}
	return out;
}

// Порядок панелей: перестановка из tabs, toolbar, bmbar, page; что угодно другое — порядок по умолчанию
function cleanOrder(raw) {
	if (Array.isArray(raw) && raw.length === DEFAULT_ORDER.length && DEFAULT_ORDER.every((k) => raw.includes(k))) return [...raw];
	return [...DEFAULT_ORDER];
}

// Расположение кнопок: каждая кнопка ровно в одной панели (или в hidden), главные элементы на своих панелях
function cleanButtons(raw, customIds = []) {
	const def = defaultButtons();
	const r = raw && typeof raw === 'object' ? raw : {};
	const out = { tabs: [], toolbar: [], bmbar: [], hidden: [] };
	const seen = new Set();
	for (const key of [...PANELS, 'hidden']) {
		if (!Array.isArray(r[key])) continue;
		for (const id of r[key]) {
			if (typeof id !== 'string' || seen.has(id)) continue;
			if (Object.hasOwn(MAIN_OF, id) ? MAIN_OF[id] !== key : !BUTTONS.includes(id) && !customIds.includes(id) && !EXT_BTN.test(id)) continue;
			seen.add(id);
			out[key].push(id);
		}
	}
	// чего не хватает — на своё место по умолчанию: после ближайшей из стоявших перед ней кнопок (главные элементы в начале панели)
	for (const key of PANELS) {
		def[key].forEach((id, i) => {
			if (seen.has(id)) return;
			seen.add(id);
			if (Object.hasOwn(MAIN_OF, id)) {
				out[key].unshift(id);
				return;
			}
			for (let j = i - 1; j >= 0; j--) {
				const at = out[key].indexOf(def[key][j]);
				if (at >= 0) {
					out[key].splice(at + 1, 0, id);
					return;
				}
			}
			out[key].push(id);
		});
	}
	for (const id of def.hidden) if (!seen.has(id)) out.hidden.push(id);
	for (const id of customIds) if (!seen.has(id)) out.toolbar.push(id); // новая своя кнопка встаёт в конец панели инструментов
	// переменный промежуток на панели только один, остальные уходят в скрытые
	for (const key of PANELS) {
		const extra = out[key].filter((id) => SPACERS.includes(id)).slice(1);
		out[key] = out[key].filter((id) => !extra.includes(id));
		out.hidden.push(...extra);
	}
	return out;
}

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
	accent: 'default', // имя готового цвета или свой цвет #rrggbb
	bgTint: 'neutral',
	contrast: 'normal',
	uiScale: 100, // масштаб панелей и окошек браузера, %
	themePresets: [], // свои наборы тем
	cacheKeep: 'always',
	cacheIcons: true,
	cachePages: true,
	cacheImages: true,
	askDownload: false,
	saveHistory: true,
	adblock: false,
	adblockYoutube: true,
	adblockStub: true,
	hideCookieBanners: false,
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
	tabsPos: 'row',
	tabsScale: 1,
	tabsTwoRows: false,
	panelOrder: [...DEFAULT_ORDER],
	btnLayout: defaultButtons(),
	customButtons: [],
	arrows: 'tri',
	bmOnlyIcons: false,
	bookmarksBar: true,
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
	bmDefaultFolder: '', // куда класть новую закладку: '' — без папки, 'last' — в последнюю выбранную, иначе id папки
	bmLastFolder: '', // последняя папка, выбранная в окошке закладки
	bmStar: 'dialog', // что делает ☆: dialog — добавить и показать окошко, toggle — молча добавить или убрать
	bmBackup: 'week', // автоматическая резервная копия закладок: off, day, week
	bmBackupDir: '', // папка для копий; пустая — папка данных браузера
	bmBackupKeep: '10', // сколько последних копий хранить
	hotkeys: {}, // только изменённые: { действие: 'Ctrl+Shift+X' }, пустая строка — клавиша отключена
};
const BOOL_SETTINGS = ['showUrlInTabs', 'showTabIcons', 'settingsAsTab', 'darkTheme', 'cacheIcons', 'cachePages', 'cacheImages', 'askDownload', 'saveHistory', 'adblock', 'adblockYoutube', 'adblockStub', 'hideCookieBanners', 'calcSuggest', 'searchSuggest', 'dnt', 'autoUpdate', 'updateFaster', 'autoRestart', 'pwOffer', 'pwFill', 'urlSuggest', 'incognitoAsk', 'bmOnlyIcons', 'bookmarksBar', 'tabsTwoRows', 'spacesPopup', 'spacesMerged', 'noDuplicateTabs', 'freezeStart', 'freezeSpaces', 'freezeDiscard', 'warnInsecure', 'bmNewTab'];
const ENUM_SETTINGS = {
	startup: ['newtab', 'url', 'session'],
	tabOverflow: ['shrink', 'scroll'],
	bgTint: Object.keys(TINTS),
	contrast: Object.keys(CONTRASTS),
	cacheKeep: ['always', 'month', 'week', 'day', 'hour', 'restart'],
	maskAs: ['chrome', 'problet', 'firefox'],
	tabsPos: ['row', 'left', 'right'], // row — панель вкладок в ряду остальных панелей, left/right — сбоку от страницы
	arrows: Object.keys(ARROWS),
	freezeAfter: ['1', '2', '5', '10', '30', '60', '120', '300', '600', '1440', '0'], // через сколько минут без просмотра вкладка замораживается; 0 — никогда
	updateEvery: ['15', '30', '60', '180', '360', '720', '1440'], // период авто-проверки обновлений в минутах
	pwLock: ['5', '15', '60', '0'],
	bmStar: ['dialog', 'toggle'],
	bmBackup: ['off', 'day', 'week'],
	bmBackupKeep: ['3', '5', '10', '30'], // через сколько минут бездействия хранилище паролей запирается; 0 — никогда
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

// Своя иконка закладки — svg в виде data-адреса
function cleanCustomIcon(v) {
	return typeof v === 'string' && v.length <= 300000 && v.startsWith('data:image/svg+xml;') ? v : '';
}

function validTemplate(t) {
	return typeof t === 'string' && t.length <= 500 && /^https?:\/\/\S+$/i.test(t.trim()) && t.includes('%s');
}

// Оставляем только известные действия с допустимыми сочетаниями, без повторов
// customIds — свои кнопки: у них по умолчанию нет клавиши, но её можно назначить
function cleanHotkeys(raw, customIds = []) {
	const out = {};
	if (!raw || typeof raw !== 'object') return out;
	const all = [...accel.ACTIONS, ...customIds.map((id) => ({ id, key: '' }))];
	const known = new Map(all.map((a) => [a.id, a.key]));
	const used = new Set();
	for (const a of all) {
		const v = Object.hasOwn(raw, a.id) ? raw[a.id] : undefined;
		if (typeof v !== 'string' || !accel.valid(v) || v === known.get(a.id)) continue;
		out[a.id] = v;
	}
	// Сочетание не должно назначаться двум действиям сразу
	for (const a of all) {
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

// Кнопку настроек нельзя скрыть, пока у настроек нет горячей клавиши: иначе до них не добраться
function keepSettingsButton(st) {
	if (settingsReachableByKey(st.hotkeys) || !st.btnLayout.hidden.includes('settings')) return;
	st.btnLayout = { ...st.btnLayout, hidden: st.btnLayout.hidden.filter((x) => x !== 'settings'), toolbar: [...st.btnLayout.toolbar, 'settings'] };
}

function cleanScale(v) {
	const n = Number(v);
	return Number.isFinite(n) ? Math.round(Math.min(2, Math.max(1, n)) * 100) / 100 : 1;
}

// Цвет акцента: готовый по имени или свой #rrggbb
function cleanAccent(v) {
	if (typeof v !== 'string') return '';
	if (Object.hasOwn(ACCENTS, v)) return v;
	return HEX.test(v) ? v.toLowerCase() : '';
}

// Набор темы: все параметры раздела «Тема». Чего нет или что записано неверно — берётся из стандартного набора
const PRESET_LIMIT = 40;
function cleanTheme(t) {
	const base = PRESETS[0].theme;
	const r = t && typeof t === 'object' ? t : {};
	return {
		darkTheme: typeof r.darkTheme === 'boolean' ? r.darkTheme : base.darkTheme,
		accent: cleanAccent(r.accent) || base.accent,
		bgTint: Object.hasOwn(TINTS, r.bgTint) ? r.bgTint : base.bgTint,
		contrast: Object.hasOwn(CONTRASTS, r.contrast) ? r.contrast : base.contrast,
		uiScale: UI_SCALES.includes(r.uiScale) ? r.uiScale : base.uiScale,
		arrows: Object.hasOwn(ARROWS, r.arrows) ? r.arrows : base.arrows,
	};
}
function cleanPresets(list) {
	const out = [];
	const seen = new Set();
	for (const p of Array.isArray(list) ? list : []) {
		if (!p || typeof p !== 'object') continue;
		const name = str(p.name, 40).trim();
		const id = typeof p.id === 'string' && /^t:[a-z0-9]{1,16}$/.test(p.id) ? p.id : '';
		if (!name || !id || seen.has(id)) continue;
		seen.add(id);
		out.push({ id, name, theme: cleanTheme(p.theme) });
		if (out.length >= PRESET_LIMIT) break;
	}
	return out;
}

// Ссылка на папку закладок в настройках: '' (без папки), 'last' (последняя выбранная) или id папки
function cleanFolderRef(v, allowLast) {
	if (typeof v !== 'string' || v.length > 64) return '';
	if (v === 'last') return allowLast ? 'last' : '';
	return /^[\w-]+$/.test(v) ? v : '';
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
	out.customButtons = cleanCustom(r.customButtons);
	const customIds = out.customButtons.map((c) => c.id);
	// Файлы старых версий: положение вкладок и закладок и переключатели кнопок
	const legacy = !Object.hasOwn(r, 'btnLayout') && !Object.hasOwn(r, 'panelOrder');
	if (legacy) {
		if (r.tabsPos === 'left' || r.tabsPos === 'right') out.tabsPos = r.tabsPos;
		const tabsBottom = r.tabsPos === 'bottom';
		const bmBottom = r.bmPos === 'bottom';
		const rest = bmBottom ? ['toolbar', 'page', 'bmbar'] : ['toolbar', 'bmbar', 'page'];
		out.panelOrder = tabsBottom ? [...rest, 'tabs'] : ['tabs', ...rest];
		const hide = [['appSpaces', 'spaces'], ['tabsNewButton', 'newtab'], ['winButtons', 'winctl'], ['appUpdate', 'update'], ['appChars', 'chars'], ['appBookmarks', 'bookmarks'], ['appPasswords', 'passwords'], ['appHistory', 'history'], ['appDownloads', 'downloads'], ['appSettings', 'settings']];
		const b = defaultButtons();
		for (const [old, id] of hide) {
			if (r[old] !== false) continue;
			for (const key of PANELS) b[key] = b[key].filter((x) => x !== id);
			b.hidden.push(id);
		}
		out.btnLayout = cleanButtons(b, customIds);
	} else {
		out.panelOrder = cleanOrder(r.panelOrder);
		out.btnLayout = cleanButtons(r.btnLayout, customIds);
	}
	out.tabsScale = cleanScale(r.tabsScale);
	out.accent = cleanAccent(r.accent) || 'default';
	out.uiScale = UI_SCALES.includes(r.uiScale) ? r.uiScale : 100;
	out.themePresets = cleanPresets(r.themePresets);
	out.hotkeys = cleanHotkeys(r.hotkeys, customIds);
	out.startupUrl = str(r.startupUrl, 2048).trim();
	out.customBlock = str(r.customBlock, 200000);
	out.bmBackupDir = typeof r.bmBackupDir === 'string' && r.bmBackupDir.length <= 1024 && path.isAbsolute(r.bmBackupDir) ? r.bmBackupDir : '';
	out.bmDefaultFolder = cleanFolderRef(r.bmDefaultFolder, true);
	out.bmLastFolder = cleanFolderRef(r.bmLastFolder, false);
	out.downloadDir = typeof r.downloadDir === 'string' && r.downloadDir.length <= 1024 && path.isAbsolute(r.downloadDir) ? r.downloadDir : '';
	keepSettingsButton(out);
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
		customIcon: cleanCustomIcon(b.customIcon),
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
	scheduleSave(5000); // на страницах с рекламой счётчик растёт десятки раз в секунду: ради него файл пишется не чаще раза в 5 секунд
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
		out.folders.push({ id, name, color: cleanFolderColor(f.color) });
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

let saveAt = 0; // когда сработает уже назначенное сохранение
function scheduleSave(delay = 300) {
	const at = Date.now() + delay;
	if (timer && saveAt <= at) return;
	clearTimeout(timer);
	saveAt = at;
	timer = setTimeout(save, delay);
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
	if (p.accent !== undefined) {
		const a = cleanAccent(p.accent);
		if (!a) throw new Error('Некорректный цвет: нужен вид #rrggbb');
		next.accent = a;
	}
	if (p.uiScale !== undefined) {
		if (!UI_SCALES.includes(p.uiScale)) throw new Error('Некорректный масштаб интерфейса');
		next.uiScale = p.uiScale;
	}
	if (p.themePresets !== undefined) {
		if (!Array.isArray(p.themePresets)) throw new Error('Некорректные наборы тем');
		const clean = cleanPresets(p.themePresets);
		if (clean.length !== Math.min(p.themePresets.length, PRESET_LIMIT)) throw new Error(p.themePresets.length > PRESET_LIMIT ? 'Слишком много наборов тем' : 'У набора темы нужно название');
		next.themePresets = clean;
	}
	if (p.hotkeys !== undefined) {
		if (!p.hotkeys || typeof p.hotkeys !== 'object' || Array.isArray(p.hotkeys)) throw new Error('Некорректные горячие клавиши');
		const ids = next.customButtons.map((c) => c.id);
		const all = [...accel.ACTIONS, ...ids.map((id) => ({ id, key: '' }))];
		const clean = cleanHotkeys(p.hotkeys, ids);
		const given = Object.keys(p.hotkeys).filter((k) => all.some((a) => a.id === k) && p.hotkeys[k] !== all.find((a) => a.id === k).key);
		if (given.some((k) => !Object.hasOwn(clean, k))) throw new Error('Такое сочетание уже занято или записано неверно');
		next.hotkeys = clean;
	}
	if (p.tabsScale !== undefined) {
		if (typeof p.tabsScale !== 'number' || !Number.isFinite(p.tabsScale)) throw new Error('Некорректный размер панели вкладок');
		next.tabsScale = cleanScale(p.tabsScale);
	}
	if (p.tabsTwoRows && next.tabsScale < TWO_ROWS_MIN) throw new Error('Сначала растяни панель вкладок почти вдвое: потяни её за край');
	if (p.panelOrder !== undefined) {
		if (cleanOrder(p.panelOrder).join() !== (Array.isArray(p.panelOrder) ? p.panelOrder.join() : null)) throw new Error('Некорректный порядок панелей');
		next.panelOrder = [...p.panelOrder];
	}
	if (p.customButtons !== undefined) {
		if (!Array.isArray(p.customButtons)) throw new Error('Некорректные свои кнопки');
		const clean = cleanCustom(p.customButtons);
		if (clean.length !== Math.min(p.customButtons.length, CUSTOM_LIMIT)) throw new Error(p.customButtons.length > CUSTOM_LIMIT ? 'Слишком много своих кнопок' : 'Заполни название и действие кнопки: адрес должен начинаться с http:// или https://');
		next.customButtons = clean;
		next.hotkeys = cleanHotkeys(next.hotkeys, clean.map((c) => c.id)); // клавиши убранных кнопок пропадают
		next.btnLayout = cleanButtons(next.btnLayout, clean.map((c) => c.id)); // убранные кнопки уходят с панелей, новые встают в конец панели инструментов
	}
	if (p.btnLayout !== undefined) {
		const clean = cleanButtons(p.btnLayout, next.customButtons.map((c) => c.id));
		const same = p.btnLayout && typeof p.btnLayout === 'object' && Object.keys(clean).every((k) => Array.isArray(p.btnLayout[k]) && p.btnLayout[k].join() === clean[k].join());
		if (!same) throw new Error('Некорректное расположение кнопок');
		next.btnLayout = clean;
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
	if (p.bmBackupDir !== undefined) {
		if (typeof p.bmBackupDir !== 'string' || p.bmBackupDir.length > 1024 || (p.bmBackupDir && !path.isAbsolute(p.bmBackupDir))) throw new Error('Некорректная папка для копий');
		next.bmBackupDir = p.bmBackupDir;
	}
	for (const key of ['bmDefaultFolder', 'bmLastFolder']) {
		if (p[key] === undefined) continue;
		const v = cleanFolderRef(p[key], key === 'bmDefaultFolder');
		if (v !== p[key] || (v && v !== 'last' && !data.folders.some((f) => f.id === v))) throw new Error('Нет такой папки');
		next[key] = v;
	}
	if (p.downloadDir !== undefined) {
		if (typeof p.downloadDir !== 'string' || p.downloadDir.length > 1024 || (p.downloadDir && !path.isAbsolute(p.downloadDir))) throw new Error('Некорректная папка загрузок');
		next.downloadDir = p.downloadDir;
	}
	if (next.engine === 'custom' && !next.customTemplate) throw new Error('Укажи шаблон адреса для своего поисковика');
	// Панель настроек нельзя убрать, пока у настроек нет горячей клавиши: иначе до них не добраться
	keepSettingsButton(next);
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
	return { bookmarks: data.bookmarks, folders: data.folders, colors: FOLDER_COLORS };
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
	if (patch.customIcon !== undefined) b.customIcon = cleanCustomIcon(patch.customIcon);
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

// Цвета папок: в закладках хранится только hex из этого списка
const FOLDER_COLORS = [
	{ name: 'Красный', hex: '#e5646e' }, { name: 'Оранжевый', hex: '#e8955a' }, { name: 'Жёлтый', hex: '#e2c04d' },
	{ name: 'Зелёный', hex: '#6fc283' }, { name: 'Бирюзовый', hex: '#4fc1c7' }, { name: 'Синий', hex: '#6c8cf0' },
	{ name: 'Фиолетовый', hex: '#a98af0' }, { name: 'Розовый', hex: '#ec86bf' },
];
const cleanFolderColor = (v) => (FOLDER_COLORS.some((c) => c.hex === v) ? v : '');

function setFolderColor(id, color) {
	const f = data.folders.find((x) => x.id === id);
	if (!f) throw new Error('Папка не найдена');
	f.color = cleanFolderColor(color);
	scheduleSave();
	changed('bookmarks');
}

function addFolder(name) {
	const n = str(name, 100).trim();
	if (!n) throw new Error('Введи название папки');
	const existing = data.folders.find((f) => f.name.toLowerCase() === n.toLowerCase());
	if (existing) return existing;
	const f = { id: newId(), name: n, color: '' };
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
	for (const key of ['bmDefaultFolder', 'bmLastFolder']) if (data.settings[key] === id) data.settings[key] = ''; // папки больше нет: закладки снова кладутся без папки
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
				f = { id: newId(), name, color: '' };
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

// Резервная копия только закладок и папок
function bookmarksBackup() {
	return { app: 'problet', kind: 'bookmarks', version: 1, exported: new Date().toISOString(), folders: data.folders, bookmarks: data.bookmarks };
}

// Восстановление из копии: закладки и папки заменяются целиком, остальное не трогается
function restoreBookmarks(raw) {
	if (!raw || typeof raw !== 'object' || !Array.isArray(raw.bookmarks)) throw new Error('Это не копия закладок');
	const inc = sanitize({ folders: raw.folders, bookmarks: raw.bookmarks });
	data.folders = inc.folders;
	data.bookmarks = inc.bookmarks;
	const ids = new Set(data.folders.map((f) => f.id));
	for (const key of ['bmDefaultFolder', 'bmLastFolder']) {
		const v = data.settings[key];
		if (v && v !== 'last' && !ids.has(v)) data.settings[key] = '';
	}
	scheduleSave();
	changed('bookmarks');
	return { bookmarks: data.bookmarks.length, folders: data.folders.length };
}

// Папка, куда класть новую закладку по настройке
function defaultFolder() {
	const s = data.settings;
	const id = s.bmDefaultFolder === 'last' ? s.bmLastFolder : s.bmDefaultFolder;
	return id && data.folders.some((f) => f.id === id) ? id : null;
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
			target = { id: data.folders.some((x) => x.id === f.id) ? newId() : f.id, name: f.name, color: cleanFolderColor(f.color) };
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
	TWO_ROWS_MIN, EXT_BTN,
	init, flush,
	getSettings, setSettings, resetSettings, engineList, searchUrl, ARROWS,
	addSearch, removeSearch, clearSearches, searchCount, searchSuggestions,
	bookmarksState, findBookmarkByUrl, addBookmark, updateBookmark, removeBookmark, restoreBookmark,
	addFolder, renameFolder, removeFolder, setFolderColor, FOLDER_COLORS, importBookmarkItems, exportBookmarksHtml, bookmarksBackup, restoreBookmarks, defaultFolder,
	exportData, looksLikeBackup, importData,
	getSession, setSession, getCacheClearedAt, setCacheClearedAt,
	onChange, notify: changed, DEFAULT_SPACE,
	addBlocked, blockedTotal,
	getZoom, setZoom,
	addVisit, isSearchUrl, updateVisitTitle, visitsList, removeVisit, clearVisits, searchVisits, getDownloads, setDownloads,
};
