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

// Этот прелоад подключён к любой странице, поэтому API и тему выдаём только внутренним адресам problet://
if (location.protocol === 'problet:') {
	watchTheme();
	const call = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
	contextBridge.exposeInMainWorld('api', {
		getSettings: () => call('settings:get'),
		setSettings: (patch) => call('settings:set', patch),
		clearSearchHistory: () => call('history:clear'),
		clearCache: () => call('cache:clear'),
		pwExport: (master) => call('pw:export', master),
		pwImport: (master) => call('pw:import', master),
		onChange: (cb) => ipcRenderer.on('data-changed', (_e, kinds) => cb(kinds)),
		adblockStats: () => call('adblock:stats'),
		versionInfo: () => call('version:info'),
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
		downloads: () => call('downloads:list'),
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
				} catch (e) { /* ничего */ }
			}
			if (id.userAgent) {
				def(nav, 'userAgent', () => id.userAgent);
				def(nav, 'appVersion', () => id.userAgent.replace('Mozilla/', ''));
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
				getHighEntropyValues: (hints) => Promise.resolve({
					brands,
					mobile: false,
					platform: id.platform,
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
		for (let i = at - 1; i >= 0; i--) {
			const el = inputs[i];
			if (TEXT_TYPES.includes(el.type) && visible(el) && !el.disabled) return el;
		}
		return null;
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
	const LOGINISH = /user|login|email|e-mail|mail|phone|account|acc|name|логин|почт|телефон/i;
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
		return el.type === 'email' || el.type === 'tel' || LOGINISH.test(hint) ? { pass: null, login: el } : null;
	};
	ipcRenderer.on('pw:fill', (_e, entry) => {
		const f = lastField && document.contains(lastField) && fieldsFor(lastField);
		if (!f) return;
		if (f.login && entry.username) setValue(f.login, entry.username);
		if (f.pass) {
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
		ipcRenderer.send('pw:need-fill', !!f.pass);
	};
	// click нужен для поля, которое уже в фокусе (например, autofocus): новое focusin тогда не придёт
	document.addEventListener('focusin', onUserFocus, true);
	document.addEventListener('click', onUserFocus, true);
}
