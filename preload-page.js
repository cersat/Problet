const { contextBridge, ipcRenderer, webFrame } = require('electron');

function applyTheme(t) {
	const root = document.documentElement;
	if (!root) return;
	root.dataset.theme = t.dark ? 'dark' : 'light';
	root.dataset.lang = t.lang === 'en' ? 'en' : 'ru'; // язык интерфейса: по нему pages/i18n.js переводит надписи
	root.style.setProperty('--accent', t.accent);
	root.style.setProperty('--accent-soft', t.accentSoft);
	root.style.setProperty('--on-accent', t.onAccent);
	for (const [k, v] of Object.entries(t.vars || {})) root.style.setProperty(k, v); // оттенок фона и контраст
}
function watchTheme() {
	let current = ipcRenderer.sendSync('theme:get');
	const apply = () => applyTheme(current);
	if (document.documentElement) apply();
	else new MutationObserver((_m, obs) => { if (document.documentElement) { obs.disconnect(); apply(); } }).observe(document, { childList: true });
	ipcRenderer.on('theme', (_e, t) => { current = t; apply(); });
}

// Окно панели браузера (вкладки, адресная строка): problet://ui/. Рамки внутренних страниц в нём получают API страниц ниже
const isToolbar = location.protocol === 'problet:' && location.host === 'ui' && window === window.top;
if (isToolbar) {
	watchTheme();
	contextBridge.exposeInMainWorld('problet', {
		go: (text) => ipcRenderer.send('go', text),
		back: () => ipcRenderer.send('back'),
		forward: () => ipcRenderer.send('forward'),
		reload: () => ipcRenderer.send('reload'),
		toggleBookmark: () => ipcRenderer.send('toggle-bookmark'),
		openInternal: (name) => ipcRenderer.send('open-internal', name),
		newTab: () => ipcRenderer.send('tab-new'),
		activateTab: (id) => ipcRenderer.send('tab-activate', id),
		closeTab: (id) => ipcRenderer.send('tab-close', id),
		tabMenu: (id) => ipcRenderer.send('tab-menu', id),
		tabRename: (id, name) => ipcRenderer.send('tab-rename', id, name),
		onTabRename: (cb) => ipcRenderer.on('tab-rename', (_e, id) => cb(id)),
		tabsScale: (v) => ipcRenderer.send('tabs-scale', v),
		customButton: (id) => ipcRenderer.send('custom-button', id),
		barMenu: (id) => ipcRenderer.send('bar:menu', id),
		moveTab: (id, to) => ipcRenderer.send('tab-move', id, to),
		suggestQuery: (msg) => ipcRenderer.send('suggest-query', msg),
		suggestMove: (dir) => ipcRenderer.send('suggest-move', dir),
		suggestHide: () => ipcRenderer.send('suggest-hide'),
		onState: (cb) => ipcRenderer.on('state', (_e, state) => cb(state)),
		pwOfferAccept: () => ipcRenderer.send('pw-offer-accept'),
		zoomReset: () => ipcRenderer.send('zoom-reset'),
		updateTip: (rect) => ipcRenderer.send('update-tip', rect),
		updateApply: () => ipcRenderer.send('update-apply'),
		updateState: () => ipcRenderer.sendSync('update-get'),
		darkPage: () => ipcRenderer.send('dark-page'),
		translatePage: () => ipcRenderer.send('translate-page'),
		extClick: (id, rect) => ipcRenderer.send('bar:ext', id, rect),
		onUpdate: (cb) => ipcRenderer.on('update-state', (_e, st) => cb(st)),
		onDownloadsBusy: (cb) => ipcRenderer.on('downloads-busy', (_e, n) => cb(n)),
		onDownloadDone: (cb) => ipcRenderer.on('download-done', () => cb()),
		openCalendar: () => ipcRenderer.send('open-calendar'),
		onTabs: (cb) => ipcRenderer.on('tabs', (_e, data) => cb(data)),
		onFocusAddress: (cb) => ipcRenderer.on('focus-address', () => cb()),
		onSetAddress: (cb) => ipcRenderer.on('set-address', (_e, msg) => cb(msg)),
		layout: () => ipcRenderer.sendSync('layout:get'),
		onLayout: (cb) => ipcRenderer.on('layout', (_e, l) => cb(l)),
		bar: () => ipcRenderer.sendSync('bar:get'),
		onBar: (cb) => ipcRenderer.on('bar', (_e, b) => cb(b)),
		barOpen: (id, newTab) => ipcRenderer.send('bar:open', id, !!newTab),
		barFolder: (id, rect) => ipcRenderer.send('bar:folder', id, rect),
		barFolderMenu: (id, rect) => ipcRenderer.send('bar:folder-menu', id, rect),
		newTabMenu: () => ipcRenderer.send('newtab-menu'),
		openApplet: (kind, rect) => ipcRenderer.send('applet-open', kind, rect),
		winMinimize: () => ipcRenderer.send('win:minimize'),
		winMaximize: () => ipcRenderer.send('win:maximize'),
		winClose: () => ipcRenderer.send('win:close'),
		safeExit: () => ipcRenderer.send('safe-exit'),
		onSuggestVisible: (cb) => ipcRenderer.on('suggest-visible', (_e, visible) => cb(visible)),
		onVt: (cb) => ipcRenderer.on('vt', (_e, msg) => cb(msg)),
	});
}

// Рамка внутренней страницы в окне панели (виртуальная вкладка): сообщаем браузеру, что загрузилась, и её название
if (location.protocol === 'problet:' && location.host === 'ui' && window !== window.top && window.parent === window.top) {
	let lastTitle = null;
	const sendTitle = () => {
		if (document.title === lastTitle) return;
		lastTitle = document.title;
		ipcRenderer.send('vt:title', document.title);
	};
	window.addEventListener('load', () => {
		lastTitle = document.title;
		ipcRenderer.send('vt:loaded', document.title);
		new MutationObserver(sendTitle).observe(document.head || document.documentElement, { subtree: true, childList: true, characterData: true });
	});
}

// Этот прелоад подключён к любой странице, поэтому API и тему выдаём только внутренним адресам problet://
if (location.protocol === 'problet:' && !isToolbar) {
	watchTheme();
	const call = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
	contextBridge.exposeInMainWorld('problet', {
		getSettings: () => call('settings:get'),
		setSettings: (patch) => call('settings:set', patch),
		setSafeMode: (on) => call('safe:set', !!on),
		clearSearchHistory: () => call('history:clear'),
		clearCache: () => call('cache:clear'),
		cacheSize: () => call('cache:size'),
		cacheDirPick: () => call('cache:dir-pick'),
		pwExport: (master) => call('pw:export', master),
		pwImport: (master) => call('pw:import', master),
		onChange: (cb) => ipcRenderer.on('data-changed', (_e, kinds) => cb(kinds)),
		adblockStats: () => call('adblock:stats'),
		versionInfo: () => call('version:info'),
		parentalStatus: () => call('parental:status'),
		parentalSetOn: (on, pw) => call('parental:set-on', on, pw),
		parentalSetAdmin: (on) => call('parental:set-admin', on),
		parentalUnlock: (pw) => call('parental:unlock', pw),
		parentalGet: () => call('parental:get'),
		parentalSet: (patch) => call('parental:set', patch),
		parentalStats: () => call('parental:stats'),
		parentalBlocked: () => call('parental:blocked'),
		parentalEnter: (url, pw) => call('parental:enter', url, pw),
		pwStatus: () => call('pw:status'),
		pwCreate: (master) => call('pw:create', master),
		pwUnlock: (master) => call('pw:unlock', master),
		pwLock: () => call('pw:lock'),
		pwList: () => call('pw:list'),
		pwAdd: (item) => call('pw:add', item),
		pwUpdate: (id, patch) => call('pw:update', id, patch),
		pwRemove: (id) => call('pw:remove', id),
		pwReveal: (id) => call('pw:reveal', id),
		pwChangeMaster: (oldMaster, newMaster) => call('pw:change-master', oldMaster, newMaster),
		pwFillOptions: () => call('pw:fill-options'),
		pwFillPick: (i) => call('pw:fill-pick', i),
		pwOfferCurrent: () => call('pw:offer-current'),
		pwPendingSave: (tabId) => call('pw:pending-save', tabId),
		pwPendingDrop: (tabId) => call('pw:pending-drop', tabId),
		captureHotkeys: (on) => call('hotkeys:capture', on),
		updateState: () => call('update:state'),
		checkUpdate: () => call('update:check'),
		applyUpdate: () => call('update:apply'),
		search: (text) => call('search:run', text),
		filesOpen: (p, asIs) => call('files:open', p, asIs),
		filesList: (dir) => call('files:list', dir),
		filesPlaces: () => call('files:places'),
		filesThumb: (p) => call('files:thumb', p),
		filesPin: (dir, on) => call('files:pin', dir, on),
		filesOp: (kind, args) => call('files:op', kind, args),
		filesTab: (dir) => call('files:tab', dir),
		filesClip: (mode, paths) => (mode === undefined ? call('files:clip') : call('files:clip', mode, paths)),
		filesLaunch: (p, how) => call('files:launch', p, how),
		filesDefault: () => call('files-default:get'),
		setFilesDefault: (on) => call('files-default:set', !!on),
		svgRead: (p) => call('svg:read', p),
		bmIconGet: (id) => call('bm:icon-get', id),
		bmIconSet: (id, svg) => call('bm:icon-set', id, svg),
		svgWrite: (p, text) => call('svg:write', p, text),
		pngRead: (p) => call('png:read', p),
		pngWrite: (p, dataUrl) => call('png:write', p, dataUrl),
		svgSavePng: (dataUrl, name) => call('svg:save-png', dataUrl, name),
		svgSaveAs: (text) => call('svg:save-as', text),
		svgCopyPng: (dataUrl) => call('svg:copy-png', dataUrl),
		debug: (action) => call('debug:run', action),
		restart: () => call('app:restart'),
		insecureProceed: (url) => call('insecure:proceed', url),
		openInNewTab: (name) => call('page:open-tab', name),
		homeOpen: (what) => call('home:open', what),
		welcomeDone: () => call('welcome:done'),
		canUninstall: () => call('app:can-uninstall'),
		uninstallApp: () => call('app:uninstall'),
		spaces: () => call('spaces:state'),
		spacesSwitch: (id) => call('spaces:switch', id),
		spacesAdd: (name) => call('spaces:add', name),
		spacesRename: (id, name) => call('spaces:rename', id, name),
		spacesRemove: (id) => call('spaces:remove', id),
		openSpacesApplet: () => call('spaces:open-applet'),
		panelClose: () => call('panel:close'),
		charPick: (ch) => call('chars:pick', ch),
		visits: () => call('visits:list'),
		removeVisit: (id) => call('visits:remove', id),
		clearVisits: () => call('visits:clear'),
		clearVisitsSince: (period) => call('visits:clear-since', period),
		topSites: () => call('visits:top'),
		recentVisits: () => call('visits:recent'),
		downloads: () => call('downloads:list'),
		notepadRead: (p) => call('notepad:read', p),
		notepadImage: () => call('notepad:image'),
		notepadWrite: (p, text) => call('notepad:write', p, text),
		offlineList: () => call('offline:list'),
		offlineOpen: (id) => call('offline:open', id),
		offlineDelete: (id) => call('offline:delete', id),
		offlineSaveAll: () => call('offline:save-all'),
		openDownload: (id) => call('downloads:open', id),
		showDownload: (id) => call('downloads:show', id),
		cancelDownload: (id) => call('downloads:cancel', id),
		removeDownload: (id) => call('downloads:remove', id),
		clearDownloads: () => call('downloads:clear'),
		exportData: () => call('data:export'),
		importData: () => call('data:import'),
		exportBookmarksHtml: () => call('bookmarks:export-html'),
		pickDownloadDir: () => call('dir:pick'),
		importSources: () => call('import:detect'),
		importFrom: (id) => call('import:run', id),
		makeDefaultBrowser: () => call('default-browser:set'),
		extList: () => call('ext:list'),
		extAdd: () => call('ext:add'),
		extStore: (input) => call('ext:store', input),
		extRemove: (p) => call('ext:remove', p),
		addonCatalog: () => call('addon:catalog'),
		addonInstallCatalog: (id) => call('addon:install-catalog', id),
		addonInstallUrl: (url) => call('addon:install-url', url),
		addonInstallZip: () => call('addon:install-zip'),
		addonRemove: (id) => call('addon:remove', id),
		addonReset: (id) => call('addon:reset', id),
		addonOptions: (id) => call('addon:options', id),
		addonDevtools: (id) => call('addon:devtools', id),
		importBookmarkItems: (items) => call('bookmarks:import-items', items),
		bookmarks: () => call('bookmarks:state'),
		bmStarGet: (id) => call('bm:star-get', id),
		bmStarSave: (id, p) => call('bm:star-save', id, p),
		bmStarRemove: (id) => call('bm:star-remove', id),
		bmBackupList: () => call('bm:backup-list'),
		bmBackupNow: () => call('bm:backup-now'),
		bmBackupRestore: (name) => call('bm:backup-restore', name),
		bmBackupDirPick: () => call('bm:backup-dir-pick'),
		bmBackupOpen: () => call('bm:backup-open'),
		bmCheck: () => call('bm:check'),
		onBmCheckProgress: (cb) => ipcRenderer.on('bm-check-progress', (_e, done, total) => cb(done, total)),
		addBookmark: (b) => call('bookmarks:add', b),
		updateBookmark: (id, patch) => call('bookmarks:update', id, patch),
		removeBookmark: (id) => call('bookmarks:remove', id),
		hideBookmark: (id) => call('bookmarks:hide', id),
		unhideBookmark: (id) => call('bookmarks:unhide', id),
		restoreBookmark: (b) => call('bookmarks:restore', b),
		addFolder: (name) => call('folders:add', name),
		renameFolder: (id, name) => call('folders:rename', id, name),
		removeFolder: (id) => call('folders:remove', id),
		setFolderColor: (id, color) => call('folders:color', id, color),
		folderOpen: (url, newTab) => call('folder:open', url, newTab),
		folderOpenAll: (id) => call('folder:open-all', id),
		folderDelete: (id) => call('folder:delete', id),
	});
	// Ссылку на локальный файл (закладка, запись истории) страница problet:// сама открыть не может: Chromium запрещает такой переход. Открывает главный процесс
	const openFile = (e) => {
		const a = e.target instanceof Element ? e.target.closest('a[href]') : null;
		if (!a || e.defaultPrevented || !/^file:/i.test(a.href) || (e.type === 'auxclick' && e.button !== 1)) return;
		e.preventDefault();
		call('page:open-file', a.href, e.type === 'auxclick' || a.target === '_blank' || e.ctrlKey || e.metaKey).catch(() => {});
	};
	document.addEventListener('click', openFile);
	document.addEventListener('auxclick', openFile);
}

// Ключи доступа (WebAuthn) в Electron не работают: запрос ждёт окна системы, которого нет, и сайт зависает.
// Говорим сайтам сразу, что такого способа входа нет, чтобы они предложили обычный пароль
if (location.protocol !== 'problet:') {
	try {
		webFrame.executeJavaScript('(' + function () {
			const fail = () => Promise.reject(new DOMException('Ключи доступа в этом браузере недоступны', 'NotAllowedError'));
			const creds = navigator.credentials;
			if (creds) {
				for (const name of ['get', 'create']) {
					const orig = creds[name] && creds[name].bind(creds);
					if (!orig) continue;
					creds[name] = function (options) {
						if (options && options.publicKey) return fail();
						return orig(options);
					};
				}
			}
			// Для сайтов браузер вообще не знает ключей доступа: так они не предлагают этот способ первым
			try {
				delete window.PublicKeyCredential;
			} catch (e) { /* останется отказ выше */ }
			if (window.PublicKeyCredential) {
				const no = () => Promise.resolve(false);
				PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable = no;
				PublicKeyCredential.isConditionalMediationAvailable = no;
			}
		}.toString() + ')()');
	} catch (e) { /* без этого сайт просто может зависнуть */ }
}

// ---------- Аддоны Problet ----------

// Фон аддона и его страницы (окошко кнопки, настройки) получают объект problet. Всё опасное проверяет и спрашивает главный процесс
// Рамка claude.ai в боковой панели расширения: сообщения расширению идут через браузер, потому что ответы напрямую до рамки не доходят
if (window !== window.top && location.protocol === 'https:' && location.hostname === 'claude.ai') {
	try {
		contextBridge.exposeInMainWorld('__probletExternal', (id, msg) => ipcRenderer.invoke('ext:external', id, msg));
		webFrame.executeJavaScript('(' + function () {
			const ask = window.__probletExternal;
			delete window.__probletExternal;
			const c = window.chrome || (window.chrome = {});
			c.runtime = c.runtime || {};
			const orig = c.runtime.sendMessage;
			c.runtime.sendMessage = function (id, msg, opts, cb) {
				if (typeof id !== 'string' || typeof msg === 'function' || msg === undefined) return orig ? orig.apply(this, arguments) : undefined;
				if (typeof opts === 'function') cb = opts;
				const p = ask(id, msg);
				if (typeof cb === 'function') {
					p.then((v) => { c.runtime.lastError = undefined; cb(v); }, (e) => { c.runtime.lastError = { message: String((e && e.message) || e) }; cb(undefined); c.runtime.lastError = undefined; });
					return undefined;
				}
				return p;
			};
		}.toString() + ')()');
	} catch (e) { /* без этого рамка работает как раньше */ }
}

// Страницы расширений Chrome (окна настроек и входа): в Electron нет chrome.tabs.create, а расширения открывают им страницу входа
if (location.protocol === 'chrome-extension:') {
	try {
		// Те же заплатки для недостающих chrome.*, что и у фонового процесса: страницы расширений без них падают
		const shim = ipcRenderer.sendSync('ext:shim');
		if (shim) webFrame.executeJavaScript(shim);
		// Скрытая страница-посредник (problet-relay.html) передаёт браузеру запросы фонового процесса расширения (вкладки, окно, chrome.debugger из ext-shim.js)
		if (ipcRenderer.sendSync('ext:is-relay')) {
			const dch = new BroadcastChannel('problet-dbg');
			dch.onmessage = (m) => {
				const d = m.data;
				if (!d || !d.req || !d.rid) return;
				ipcRenderer.invoke('ext:dbg', d.req).then(
					(value) => dch.postMessage({ rid: d.rid, ok: true, value: value === undefined ? null : value }),
					(err) => dch.postMessage({ rid: d.rid, ok: false, error: String((err && err.message) || err).replace(/^Error invoking remote method '[^']*': (Error: )?/, '') })
				);
			};
			ipcRenderer.on('dbg:event', (e, ev) => dch.postMessage({ ev }));
			ipcRenderer.on('tab:event', (e, tabEv) => dch.postMessage({ tabEv }));
			dch.postMessage({ relayReady: true }); // запросы, отправленные до запуска посредника, уйдут заново
		}
		webFrame.executeJavaScript('(' + function () {
			const c = window.chrome;
			if (!c || !c.tabs) return;
			// Боковая панель — не вкладка: getCurrent у неё должен отвечать «ничего», иначе расширение решит, что страница открыта не там
			if (/\/sidepanel[^/]*\.html$/i.test(location.pathname)) {
				c.tabs.getCurrent = function (cb) {
					if (typeof cb === 'function') {
						setTimeout(() => cb(undefined), 0);
						return undefined;
					}
					return Promise.resolve(undefined);
				};
			}
			if (c.tabs.create) return;
			c.tabs.create = function (props, cb) {
				const url = props && typeof props.url === 'string' ? props.url : '';
				if (url) window.open(url, '_blank');
				const tab = { id: -1, url, active: !props || props.active !== false, windowId: 1, index: 0 };
				if (typeof cb === 'function') {
					setTimeout(() => cb(tab), 0);
					return undefined;
				}
				return Promise.resolve(tab);
			};
		}.toString() + ')()');
	} catch (e) { /* без этого вход через расширение не откроется */ }
}

if (location.protocol === 'problet-addon:') {
	const call = (method, ...args) => ipcRenderer.invoke('addon:call', method, args);
	const listeners = new Map();
	ipcRenderer.on('addon:event', async (_e, name, data, id) => {
		let result;
		for (const cb of listeners.get(name) || []) {
			try {
				const r = await cb(data);
				if (r !== undefined && result === undefined) result = r;
			} catch (e) {
				console.error(e);
			}
		}
		if (id) ipcRenderer.send('addon:reply', id, result === undefined ? null : result);
	});
	const m = (name) => (...args) => call(name, ...args);
	contextBridge.exposeInMainWorld('problet', {
		lang: ipcRenderer.sendSync('theme:get').lang === 'en' ? 'en' : 'ru', // язык интерфейса браузера: на нём аддон показывает свои надписи
		info: m('info'),
		on: (name, cb) => {
			if (typeof cb !== 'function') return;
			if (!listeners.has(name)) listeners.set(name, []);
			listeners.get(name).push(cb);
		},
		storage: { get: m('storage.get'), set: m('storage.set'), remove: m('storage.remove') },
		tabs: { list: m('tabs.list'), active: m('tabs.active'), open: m('tabs.open'), close: m('tabs.close'), activate: m('tabs.activate'), navigate: m('tabs.navigate'), reload: m('tabs.reload'), eval: m('tabs.eval'), send: m('tabs.send') },
		notify: m('notify'),
		fetch: m('fetch'),
		bookmarks: { list: m('bookmarks.list'), add: m('bookmarks.add') },
		history: { list: m('history.list') },
		clipboard: { read: m('clipboard.read'), write: m('clipboard.write') },
		files: { pick: m('files.pick'), read: m('files.read'), write: m('files.write'), list: m('files.list'), reveal: m('files.reveal') },
		exec: m('exec'),
		button: { setTitle: m('button.setTitle') },
		settings: { get: m('settings.get'), set: m('settings.set') },
		requests: { setRules: m('requests.setRules') },
		sidebar: { toggle: m('sidebar.toggle') },
		openOptions: m('options.open'),
	});
}

// Скрипты аддонов на страницах сайтов: у каждого аддона свой изолированный мир, страница их не видит
if (/^(https?|file):$/.test(location.protocol) && window === window.top) {
	let list = [];
	try {
		list = ipcRenderer.sendSync('addon:content-get', location.href) || [];
	} catch (e) { /* без аддонов */ }
	if (list.length) {
		const handlers = new Map();
		ipcRenderer.on('addon:to-content', (_e, id, msg) => {
			for (const cb of handlers.get(id) || []) {
				try {
					cb(msg);
				} catch (e) { /* ошибка в скрипте аддона */ }
			}
		});
		const lang = ipcRenderer.sendSync('theme:get').lang === 'en' ? 'en' : 'ru';
		for (const x of list) {
			const send = (kind, args) => ipcRenderer.invoke('addon:content', x.id, kind, args);
			contextBridge.exposeInIsolatedWorld(x.world, 'problet', {
				id: x.id,
				lang,
				send: (msg) => send('send', [msg]),
				onMessage: (cb) => {
					if (typeof cb !== 'function') return;
					if (!handlers.has(x.id)) handlers.set(x.id, []);
					handlers.get(x.id).push(cb);
				},
				stored: x.data,
				storage: x.storage ? { get: (k) => send('storage.get', [k]), set: (k, v) => send('storage.set', [k, v]) } : undefined,
			});
			for (const css of x.css) webFrame.insertCSS(css);
			const run = (arr) => {
				if (arr.length) webFrame.executeJavaScriptInIsolatedWorld(x.world, arr).catch((e) => console.error('Аддон ' + x.id + ':', e));
			};
			run(x.js.start);
			if (x.js.end.length) document.addEventListener('DOMContentLoaded', () => run(x.js.end), { once: true });
			if (x.js.idle.length) window.addEventListener('load', () => run(x.js.idle), { once: true });
		}
	}
}

// Для внешних сайтов подменяем то, что видно из JavaScript: navigator.userAgentData, vendor и т.п., чтобы совпадало с выбранной маскировкой.
// Заголовки (User-Agent, Sec-CH-UA, DNT) подменяет главный процесс. В iframe других сайтов эта подмена не действует.
if (location.protocol !== 'problet:' && window === window.top) {
	try {
		const id = ipcRenderer.sendSync('identity:get');
		const code = '(' + function (id) {
			const def = (obj, name, get) => {
				try {
					Object.defineProperty(obj, name, { get, configurable: true, enumerable: true });
				} catch (e) { /* не получилось — оставляем как есть */ }
			};
			const nav = Navigator.prototype;
			if (id.dnt) def(nav, 'doNotTrack', () => '1');
			// Сайт может узнать Problet, только если мы не маскируемся под другой браузер
			if (id.kind === 'problet') {
				try {
					Object.defineProperty(window, 'isProblet', { value: true, configurable: true });
					Object.defineProperty(window, 'problet', { value: Object.freeze({ isProblet: true }), configurable: true });
				} catch (e) { /* ничего */ }
			}
			if (id.userAgent) {
				def(nav, 'userAgent', () => id.userAgent);
				def(nav, 'appVersion', () => id.userAgent.replace('Mozilla/', ''));
			}
			// «Скрывать метаданные системы»: вместо настоящих системы и железа — одинаковые у всех значения (Windows 10, x64)
			if (id.hide) {
				def(nav, 'platform', () => 'Win32');
				def(nav, 'vendor', () => (id.kind === 'firefox' ? '' : 'Google Inc.'));
				def(nav, 'oscpu', () => (id.kind === 'firefox' ? 'Windows NT 10.0; Win64; x64' : undefined));
				def(nav, 'hardwareConcurrency', () => 4); // число нужно сайтам для пулов воркеров, поэтому одинаковое у всех, а не настоящее
				def(nav, 'deviceMemory', () => undefined);
				def(nav, 'cpuClass', () => undefined);
				// Видеокарта через WebGL
				for (const G of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
					if (!G) continue;
					const orig = G.prototype.getParameter;
					G.prototype.getParameter = function (p) {
						if (p === 0x9245 || p === 0x9246) return 'Google Inc.'; // UNMASKED_VENDOR_WEBGL, UNMASKED_RENDERER_WEBGL: настоящую видеокарту не называем
						return orig.call(this, p);
					};
				}
			}
			if (id.kind === 'firefox') {
				try {
					delete nav.userAgentData;
				} catch (e) { /* ничего */ }
				def(nav, 'vendor', () => '');
				def(nav, 'productSub', () => '20100101');
				return;
			}
			const brands = id.brands.map((b) => ({ brand: b.brand, version: b.version }));
			const data = {
				brands,
				mobile: false,
				platform: id.platform,
				// С «Скрывать метаданные системы» архитектура и версия системы — одинаковые у всех
				getHighEntropyValues: (hints) => Promise.resolve({
					brands,
					mobile: false,
					platform: id.platform,
					...(id.hide ? { architecture: 'x86', bitness: '64', model: '', platformVersion: '10.0.0', wow64: false, formFactors: ['Desktop'] } : {}),
					fullVersionList: id.fullBrands.map((b) => ({ brand: b.brand, version: b.version })),
					uaFullVersion: id.full,
				}),
				toJSON: () => ({ brands, mobile: false, platform: id.platform }),
			};
			def(nav, 'userAgentData', () => data);
		}.toString() + ')(' + JSON.stringify(id) + ')';
		webFrame.executeJavaScript(code);
	} catch (e) { /* без подмены страница всё равно работает */ }
}

// Реклама YouTube приходит с тех же адресов, что и видео, поэтому по доменам её не отрезать: вырезаем её из ответов плеера, прячем рекламные блоки и пропускаем то, что всё же показалось
let yt = null;
if (/^https?:$/.test(location.protocol) && /(^|\.)youtube(-nocookie)?\.com$/.test(location.hostname) && (yt = ipcRenderer.sendSync('adblock:youtube'))) {
	try {
		webFrame.executeJavaScript('(' + function (stubB64) {
			const KEYS = ['adPlacements', 'playerAds', 'adSlots', 'adBreakHeartbeatParams'];
			// Вместо вырезанной рекламы плеер на секунду показывает «Реклама заблокирована» (видео из страницы, сети оно не касается)
			let stubUrl = null;
			let lastStub = 0;
			const showStub = (tries) => {
				if (!stubB64) return;
				const player = document.querySelector('.html5-video-player');
				const main = player && player.querySelector('video.html5-main-video');
				if (!main) {
					if (tries < 40) setTimeout(() => showStub(tries + 1), 250);
					return;
				}
				if (main.currentTime > 1 || Date.now() - lastStub < 3000) return; // только начало ролика, и не чаще раза в 3 секунды
				lastStub = Date.now();
				if (!stubUrl) {
					const bin = atob(stubB64);
					const bytes = new Uint8Array(bin.length);
					for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
					stubUrl = URL.createObjectURL(new Blob([bytes], { type: 'video/webm' }));
				}
				// Играющее видео ставим на паузу и потом продолжаем; ещё не начавшее играть не трогаем (пауза отменила бы его автозапуск), а только глушим на время заставки
				const wasPlaying = !main.paused;
				const wasMuted = main.muted;
				main.muted = true;
				if (wasPlaying) main.pause();
				const box = document.createElement('div');
				box.id = 'problet-adstub';
				box.style.cssText = 'position:absolute;inset:0;z-index:60;background:#16161d;display:flex;align-items:center;justify-content:center';
				const v = document.createElement('video');
				v.muted = true;
				v.playsInline = true;
				v.src = stubUrl;
				v.style.cssText = 'width:100%;height:100%;object-fit:contain';
				box.appendChild(v);
				player.appendChild(box);
				let done = false;
				const finish = () => {
					if (done) return;
					done = true;
					box.remove();
					main.muted = wasMuted;
					if (wasPlaying) main.play().catch(() => {});
				};
				v.addEventListener('ended', finish);
				v.addEventListener('error', finish);
				setTimeout(finish, 1800);
				v.play().catch(finish);
			};
			const strip = (o) => {
				if (o && typeof o === 'object') {
					for (const k of KEYS) {
						if (!(k in o)) continue;
						if (k === 'adPlacements' || k === 'playerAds') {
							if (Array.isArray(o[k]) ? o[k].length : o[k]) showStub(0);
						}
						delete o[k];
					}
					if (o.playerResponse) strip(o.playerResponse);
					if (o.response) strip(o.response);
					if (Array.isArray(o)) o.forEach(strip);
				}
				return o;
			};
			// Первый ответ плеера лежит прямо в странице
			let initial;
			try {
				Object.defineProperty(window, 'ytInitialPlayerResponse', { configurable: true, get: () => initial, set: (v) => { initial = strip(v); } });
			} catch (e) { /* останется очистка ниже */ }
			// Остальные приходят запросами и разбираются через JSON.parse / Response.json
			const parse = JSON.parse;
			JSON.parse = function () {
				return strip(parse.apply(this, arguments));
			};
			const json = Response.prototype.json;
			Response.prototype.json = function () {
				return json.apply(this, arguments).then(strip);
			};
			// То, что всё же показалось: нажимаем «Пропустить» и домотываем ролик до конца
			const skip = () => {
				const player = document.querySelector('.html5-video-player.ad-showing');
				if (!player) return;
				const video = player.querySelector('video');
				if (video && isFinite(video.duration) && video.duration > 0) {
					video.muted = true;
					video.currentTime = video.duration;
				}
				const btn = document.querySelector('.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button, .ytp-ad-overlay-close-button');
				if (btn) btn.click();
			};
			setInterval(skip, 300);
			const css = document.createElement('style');
			css.textContent = '#masthead-ad, #player-ads, ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer, ytd-display-ad-renderer, ytd-promoted-sparkles-web-renderer, ytd-banner-promo-renderer, ytd-statement-banner-renderer, .ytp-ad-overlay-container, .ytp-ad-module, ytd-merch-shelf-renderer, ytd-companion-slot-renderer { display: none !important; }';
			const put = () => (document.head || document.documentElement).appendChild(css);
			if (document.documentElement) put();
			else document.addEventListener('readystatechange', put, { once: true });
		}.toString() + ')(' + JSON.stringify(yt.stub) + ')');
	} catch (e) { /* без этого реклама просто останется */ }
}

// Пароли на обычных сайтах: замечаем отправку формы с паролем и подставляем сохранённое, когда на поле нажимает сам человек
if (location.protocol !== 'problet:' && window === window.top) {
	const isField = (el) => el instanceof HTMLInputElement;
	const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
	const TEXT_TYPES = ['text', 'email', 'tel', ''];

	// Логин — ближайшее перед паролем текстовое поле в той же форме (или на странице)
	function loginFieldFor(pass) {
		const scope = pass.form || document;
		const inputs = [...scope.querySelectorAll('input')];
		const at = inputs.indexOf(pass);
		const before = inputs.slice(0, at).reverse().filter((el) => TEXT_TYPES.includes(el.type) && visible(el) && !el.disabled);
		// В регистрации перед паролем часто стоят имя и фамилия: берём ближайшее поле, похожее на логин, а не на имя
		return before.find((el) => el.type === 'email' || el.type === 'tel' || /username|email/i.test(el.autocomplete) || LOGINISH.test(el.name + ' ' + el.id) && !isPersonName(el))
			|| before.find((el) => !isPersonName(el)) || before[0] || null;
	}

	document.addEventListener('submit', (e) => {
		try {
			const form = e.target;
			if (!(form instanceof HTMLFormElement)) return;
			const passes = [...form.querySelectorAll('input[type=password]')].filter((p) => p.value);
			if (!passes.length) return;
			// В форме регистрации или смены пароля берём последнее поле: там новый пароль
			const pass = passes[passes.length - 1];
			const login = loginFieldFor(pass);
			if (filled && pass.value === filled) return; // подставили мы, сохранять нечего
			ipcRenderer.send('pw:submit', { username: login ? login.value : '', password: pass.value });
		} catch (err) { /* сайт всё равно должен работать */ }
	}, true);

	const setValue = (el, value) => {
		const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
		setter.call(el, value);
		el.dispatchEvent(new Event('input', { bubbles: true }));
		el.dispatchEvent(new Event('change', { bubbles: true }));
	};

	let filled = ''; // пароль, который подставили мы: его отправка не повод предлагать сохранение
	let lastField = null;
	// Похоже на логин. Голого name здесь нет: имя и фамилия (firstName, fullname) — не логин, а username ловит user
	const LOGINISH = /user|login|email|e-mail|mail|phone|account|acc|identifier|логин|почт|телефон/i;
	const PERSON_NAME = /(first|last|full|given|family|sur|middle|display|real)[-_ ]?name|^name$|имя|фамил/i;
	const isPersonName = (el) => el.type !== 'email' && el.type !== 'tel' && (PERSON_NAME.test(el.name) || PERSON_NAME.test(el.id) || /name/i.test(el.autocomplete) && !/username/i.test(el.autocomplete));
	const fieldsFor = (el) => {
		const scope = el.form || document;
		const pass = el.type === 'password' ? el : [...scope.querySelectorAll('input[type=password]')].find(visible) || null;
		if (pass && !visible(pass)) return null;
		if (el.type === 'password') return { pass, login: loginFieldFor(pass) };
		if (!TEXT_TYPES.includes(el.type) || !visible(el) || el.disabled) return null;
		if (pass) {
			const login = loginFieldFor(pass);
			return el === login ? { pass, login } : null;
		}
		// Вход в два шага: пароля на странице ещё нет, но поле похоже на логин
		const hint = el.type + ' ' + el.autocomplete + ' ' + el.name + ' ' + el.id;
		if (isPersonName(el)) return null;
		return el.type === 'email' || el.type === 'tel' || LOGINISH.test(hint) ? { pass: null, login: el } : null;
	};
	// Форма создания аккаунта: поле нового пароля, два поля пароля или адрес страницы регистрации
	const SIGNUP_URL = /sign.?up|regist|join|create.?(account|user)|new.?account|reg(\/|$|\?)|зарегистр/i;
	const isSignup = (f) => {
		if (!f) return false;
		const scope = (f.login && f.login.form) || document;
		const passes = [...scope.querySelectorAll('input[type=password]')].filter(visible);
		if (passes.some((p) => /new-password/i.test(p.autocomplete))) return true;
		if (passes.length >= 2) return true;
		return SIGNUP_URL.test(location.pathname + location.search + location.hash);
	};
	ipcRenderer.on('pw:fill', (_e, entry) => {
		const f = lastField && document.contains(lastField) && fieldsFor(lastField);
		if (!f) return;
		if (f.login && entry.username) setValue(f.login, entry.username);
		if (f.pass && entry.password) {
			setValue(f.pass, entry.password);
			filled = entry.password;
		}
	});
	const onUserFocus = (e) => {
		const el = e.target;
		// Только настоящее нажатие человека, не скрипт страницы
		const f = isField(el) && e.isTrusted && navigator.userActivation.isActive ? fieldsFor(el) : null;
		if (!f) return;
		lastField = el;
		// Подсказка с шаблонными логинами нужна только на поле логина, а не пароля
		ipcRenderer.send('pw:need-fill', !!f.pass, el !== f.pass && isSignup(f));
	};
	// click нужен для поля, которое уже в фокусе (например, autofocus): новое focusin тогда не придёт
	document.addEventListener('focusin', onUserFocus, true);
	document.addEventListener('click', onUserFocus, true);
}
