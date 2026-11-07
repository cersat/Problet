const { contextBridge, ipcRenderer, webFrame } = require('electron');

function applyTheme(t) {
	const root = document.documentElement;
	if (!root) return;
	root.dataset.theme = t.dark ? 'dark' : 'light';
	root.style.setProperty('--accent', t.accent);
	root.style.setProperty('--accent-soft', t.accentSoft);
	root.style.setProperty('--on-accent', t.onAccent);
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
		debug: (action) => call('debug:run', action),
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
		importBookmarkItems: (items) => call('bookmarks:import-items', items),
		bookmarks: () => call('bookmarks:state'),
		addBookmark: (b) => call('bookmarks:add', b),
		updateBookmark: (id, patch) => call('bookmarks:update', id, patch),
		removeBookmark: (id) => call('bookmarks:remove', id),
		restoreBookmark: (b) => call('bookmarks:restore', b),
		addFolder: (name) => call('folders:add', name),
		renameFolder: (id, name) => call('folders:rename', id, name),
		removeFolder: (id) => call('folders:remove', id),
	});
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
	const fieldsFor = (el) => {
		const pass = el.type === 'password' ? el : [...document.querySelectorAll('input[type=password]')].find(visible);
		if (!pass || !visible(pass)) return null;
		const login = loginFieldFor(pass);
		return el === pass || el === login ? { pass, login } : null;
	};
	ipcRenderer.on('pw:fill', (_e, entry) => {
		const f = lastField && document.contains(lastField) && fieldsFor(lastField);
		if (!f) return;
		if (f.login && entry.username) setValue(f.login, entry.username);
		setValue(f.pass, entry.password);
		filled = entry.password;
	});
	const onUserFocus = (e) => {
		const el = e.target;
		// Только настоящее нажатие человека, не скрипт страницы
		if (!isField(el) || !e.isTrusted || !navigator.userActivation.isActive || !fieldsFor(el)) return;
		lastField = el;
		ipcRenderer.send('pw:need-fill');
	};
	// click нужен для поля, которое уже в фокусе (например, autofocus): новое focusin тогда не придёт
	document.addEventListener('focusin', onUserFocus, true);
	document.addEventListener('click', onUserFocus, true);
}
