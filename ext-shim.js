// Подкладывается к фоновому процессу расширений из магазина: в Electron нет части chrome.* (cookies, webRequest, contextMenus,
// declarativeNetRequest, alarms, action и др.), и без них фоновый скрипт падает на первой же строке.
// Недостающее заменяется заглушками, а то, что в Electron есть, не трогается.
(function () {
	const root = typeof self !== 'undefined' ? self : globalThis;
	const c = root.chrome;
	if (!c) return;

	const event = () => {
		const ls = new Set();
		return { addListener: (f) => ls.add(f), removeListener: (f) => ls.delete(f), hasListener: (f) => ls.has(f), hasListeners: () => ls.size > 0, _fire: (...a) => ls.forEach((f) => f(...a)) };
	};
	// Вызов в стиле chrome: либо колбэк последним аргументом, либо промис
	const reply = (args, value) => {
		const cb = args.length && typeof args[args.length - 1] === 'function' ? args[args.length - 1] : null;
		if (cb) {
			setTimeout(() => cb(value), 0);
			return undefined;
		}
		return Promise.resolve(value);
	};
	// Запасной вариант для любого неизвестного пространства имён: onX — события, остальное — функции, ничего не делающие
	const blank = (fixed) => new Proxy(fixed || {}, {
		get(t, k) {
			if (k in t) return t[k];
			if (typeof k !== 'string') return undefined;
			if (/^on[A-Z]/.test(k)) return (t[k] = event());
			if (/^[A-Z_]+$/.test(k)) return k;
			return (t[k] = (...a) => reply(a, undefined));
		},
	});
	const ensure = (name, fixed) => {
		if (!c[name]) c[name] = blank(fixed);
	};

	ensure('cookies', { getAllCookieStores: (...a) => reply(a, [{ id: '0', tabIds: [] }]), get: (...a) => reply(a, null), getAll: (...a) => reply(a, []) });
	ensure('webRequest');
	ensure('declarativeNetRequest', { getDynamicRules: (...a) => reply(a, []), getSessionRules: (...a) => reply(a, []) });
	ensure('contextMenus');
	ensure('notifications');
	ensure('webNavigation');
	ensure('windows');
	ensure('commands');
	ensure('tabGroups', {
		Color: { GREY: 'grey', BLUE: 'blue', RED: 'red', YELLOW: 'yellow', GREEN: 'green', PINK: 'pink', PURPLE: 'purple', CYAN: 'cyan', ORANGE: 'orange' },
		TAB_GROUP_ID_NONE: -1,
		query: (...a) => reply(a, []),
		get: (...a) => reply(a, undefined),
		update: (...a) => reply(a, undefined),
		move: (...a) => reply(a, undefined),
	});
	ensure('sidePanel', { setPanelBehavior: (...a) => reply(a, undefined), setOptions: (...a) => reply(a, undefined), getOptions: (...a) => reply(a, {}), open: (...a) => reply(a, undefined) });
	for (const n of ['debugger', 'idle', 'history', 'bookmarks', 'downloads', 'sessions', 'power', 'system', 'topSites', 'webNavigation', 'proxy', 'privacy', 'browsingData', 'identity', 'tts', 'contentSettings', 'fontSettings', 'readingList', 'search', 'userScripts', 'sidePanel']) ensure(n);
	// Переходы вкладок, о которых сообщает браузер (через страницу problet-callback.html): фоновый процесс видит их как обычные события
	try {
		const ch = new BroadcastChannel('problet-nav');
		ch.onmessage = (e) => {
			const url = e.data && e.data.url;
			if (typeof url !== 'string') return;
			(root.__probletNavs = root.__probletNavs || []).push(url);
			const wn = c.webNavigation && c.webNavigation.onBeforeNavigate;
			if (wn && wn._fire) wn._fire({ url, tabId: -1, frameId: 0, parentFrameId: -1, timeStamp: Date.now() });
			const tu = c.tabs && c.tabs.onUpdated;
			if (tu && tu._fire) tu._fire(-1, { url, status: 'loading' }, { id: -1, url });
		};
	} catch (err) { /* без канала вход через сайт не завершится */ }
	// Electron считает вкладкой любое окно, в том числе саму боковую панель, и ставит ей active: подменяем ответ на настоящую открытую страницу
	if (typeof root.__probletActiveTab === 'function' && c.tabs && c.tabs.query && !c.tabs.__probletQuery) {
		const query = c.tabs.query.bind(c.tabs);
		c.tabs.__probletQuery = true;
		c.tabs.query = (...a) => {
			const info = typeof a[0] === 'object' && a[0] ? a[0] : {};
			const cb = typeof a[a.length - 1] === 'function' ? a[a.length - 1] : null;
			const own = location.protocol === 'chrome-extension:' ? location.origin + '/' : '';
			const run = query({}).then((list) => {
				const act = root.__probletActiveTab();
				let out = (list || []).filter((t) => !(own && root.__probletSidePanel && String(t.url || '').startsWith(own + 'sidepanel'))).map((t) => ({ ...t, active: t.id === act, windowId: 1 }));
				if (info.active !== undefined) out = out.filter((t) => t.active === !!info.active);
				if (typeof info.url === 'string' || Array.isArray(info.url)) {
					const pats = [].concat(info.url).map((p) => new RegExp('^' + p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$'));
					out = out.filter((t) => pats.some((r) => r.test(t.url || '')));
				}
				return out;
			});
			if (cb) {
				run.then((v) => cb(v), () => cb([]));
				return undefined;
			}
			return run;
		};
	}
	if (root.__probletSidePanel && c.tabs) c.tabs.getCurrent = (...a) => reply(a, undefined);
	if (c.tabs && c.tabs.TAB_ID_NONE === undefined) c.tabs.TAB_ID_NONE = -1;
	ensure('action', { getUserSettings: (...a) => reply(a, { isOnToolbar: true }) });
	if (!c.menus) c.menus = c.contextMenus;

	ensure('permissions', {
		contains: (...a) => reply(a, false),
		request: (...a) => reply(a, false),
		remove: (...a) => reply(a, false),
		getAll: (...a) => reply(a, { permissions: [], origins: (c.runtime.getManifest().host_permissions || []).slice() }),
	});

	// Таймеры: фоновый процесс может засыпать, но пока он жив, будильники работают
	if (!c.alarms) {
		const timers = new Map();
		const onAlarm = event();
		const fire = (name) => onAlarm._fire({ name, scheduledTime: Date.now() });
		c.alarms = {
			onAlarm,
			create: (...a) => {
				const name = typeof a[0] === 'string' ? a[0] : '';
				const info = (typeof a[0] === 'string' ? a[1] : a[0]) || {};
				if (timers.has(name)) clearTimeout(timers.get(name).id);
				const period = info.periodInMinutes ? info.periodInMinutes * 60000 : 0;
				const first = info.when ? Math.max(0, info.when - Date.now()) : (info.delayInMinutes != null ? info.delayInMinutes : info.periodInMinutes || 0) * 60000;
				const rec = { info, id: 0 };
				const run = () => {
					fire(name);
					if (period) rec.id = setTimeout(run, period);
					else timers.delete(name);
				};
				rec.id = setTimeout(run, first);
				timers.set(name, rec);
				return reply(a, undefined);
			},
			get: (...a) => {
				const name = typeof a[0] === 'string' ? a[0] : '';
				const rec = timers.get(name);
				return reply(a, rec ? { name, scheduledTime: Date.now(), periodInMinutes: rec.info.periodInMinutes } : undefined);
			},
			getAll: (...a) => reply(a, [...timers.keys()].map((name) => ({ name, scheduledTime: Date.now() }))),
			clear: (...a) => {
				const name = typeof a[0] === 'string' ? a[0] : '';
				const had = timers.has(name);
				if (had) clearTimeout(timers.get(name).id);
				timers.delete(name);
				return reply(a, had);
			},
			clearAll: (...a) => {
				timers.forEach((r) => clearTimeout(r.id));
				timers.clear();
				return reply(a, true);
			},
		};
	}

	// chrome.storage.session нужен многим расширениям; если его нет — хранится в памяти
	if (c.storage && !c.storage.session) {
		const mem = {};
		c.storage.session = {
			get: (...a) => {
				const k = typeof a[0] === 'function' ? null : a[0];
				const keys = k == null ? Object.keys(mem) : typeof k === 'string' ? [k] : Array.isArray(k) ? k : Object.keys(k);
				const out = typeof k === 'object' && k && !Array.isArray(k) ? { ...k } : {};
				keys.forEach((x) => { if (x in mem) out[x] = mem[x]; });
				return reply(a, out);
			},
			set: (...a) => {
				Object.assign(mem, a[0]);
				return reply(a, undefined);
			},
			remove: (...a) => {
				[].concat(a[0]).forEach((x) => delete mem[x]);
				return reply(a, undefined);
			},
			clear: (...a) => {
				Object.keys(mem).forEach((x) => delete mem[x]);
				return reply(a, undefined);
			},
			onChanged: event(),
		};
	}
	if (c.runtime) {
		for (const n of ['onInstalled', 'onStartup', 'onConnect', 'onMessage', 'onSuspend', 'onUpdateAvailable']) if (!c.runtime[n]) c.runtime[n] = event();
		if (!c.runtime.setUninstallURL) c.runtime.setUninstallURL = (...a) => reply(a, undefined);
	}
	if (c.scripting && !c.scripting.registerContentScripts) {
		c.scripting.registerContentScripts = (...a) => reply(a, undefined);
		c.scripting.unregisterContentScripts = (...a) => reply(a, undefined);
		c.scripting.getRegisteredContentScripts = (...a) => reply(a, []);
	}
	if (c.management && !c.management.getSelf) c.management.getSelf = (...a) => reply(a, { id: c.runtime.id, installType: 'normal', name: c.runtime.getManifest().name });
})();
