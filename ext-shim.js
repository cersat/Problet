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

	// Вход должен переживать перезапуск браузера. Расширение держит токены в storage.session, а он очищается при каждом запуске
	// (в Chrome после этого расширение входит заново само через chrome.identity, которого в Electron нет).
	// Поэтому ключи входа дублируются в storage.local, а при чтении подставляются оттуда, если в сеансе их нет
	const sess = c.storage && c.storage.session;
	if (sess && !sess.__probletKeep) {
		const KEEP = ['accessToken', 'refreshToken', 'tokenExpiry', 'tokenOrg', 'tokenScope', 'tokenOrgUuid', 'accountUuid', 'tokenHandOffAt'];
		const loc = c.storage.local;
		const pre = '__problet_keep:';
		const keys = (k) => (k == null ? null : typeof k === 'string' ? [k] : Array.isArray(k) ? k : Object.keys(k));
		const origGet = sess.get.bind(sess);
		const origSet = sess.set.bind(sess);
		const origRemove = sess.remove.bind(sess);
		const origClear = sess.clear ? sess.clear.bind(sess) : null;
		const run = (a, fn) => {
			const cb = typeof a[a.length - 1] === 'function' ? a[a.length - 1] : null;
			const p = fn(cb ? a.slice(0, -1) : a);
			if (!cb) return p;
			p.then((v) => cb(v), () => cb(undefined));
			return undefined;
		};
		try {
			sess.get = (...a) => run(a, async (b) => {
				const want = keys(b[0]);
				const got = (await origGet(...b)) || {};
				const miss = (want || KEEP).filter((k) => KEEP.includes(k) && got[k] === undefined);
				if (!miss.length) return got;
				try {
					const back = await loc.get(miss.map((k) => pre + k));
					for (const k of miss) if (back[pre + k] !== undefined) got[k] = back[pre + k];
				} catch (err) { /* без копии вход после перезапуска не восстановится */ }
				return got;
			});
			sess.set = (...a) => run(a, async (b) => {
				const mirror = {};
				for (const k of Object.keys(b[0] || {})) if (KEEP.includes(k)) mirror[pre + k] = b[0][k];
				const r = await origSet(...b);
				if (Object.keys(mirror).length) await loc.set(mirror).catch(() => {});
				return r;
			});
			sess.remove = (...a) => run(a, async (b) => {
				const gone = (keys(b[0]) || []).filter((k) => KEEP.includes(k)).map((k) => pre + k);
				const r = await origRemove(...b);
				if (gone.length) await loc.remove(gone).catch(() => {});
				return r;
			});
			if (origClear) sess.clear = (...a) => run(a, async (b) => {
				const r = await origClear(...b);
				await loc.remove(KEEP.map((k) => pre + k)).catch(() => {});
				return r;
			});
			sess.__probletKeep = true;
		} catch (err) { /* останется родной storage.session */ }
	}

	ensure('cookies', { getAllCookieStores: (...a) => reply(a, [{ id: '0', tabIds: [] }]), get: (...a) => reply(a, null), getAll: (...a) => reply(a, []) });
	ensure('webRequest');
	ensure('declarativeNetRequest', { getDynamicRules: (...a) => reply(a, []), getSessionRules: (...a) => reply(a, []) });
	ensure('contextMenus');
	ensure('notifications');
	ensure('webNavigation');
	ensure('windows');
	ensure('commands');
	const simGroups = !c.tabGroups;
	ensure('tabGroups', {
		Color: { GREY: 'grey', BLUE: 'blue', RED: 'red', YELLOW: 'yellow', GREEN: 'green', PINK: 'pink', PURPLE: 'purple', CYAN: 'cyan', ORANGE: 'orange' },
		TAB_GROUP_ID_NONE: -1,
		query: (...a) => reply(a, []),
		get: (...a) => reply(a, undefined),
		update: (...a) => reply(a, undefined),
		move: (...a) => reply(a, undefined),
	});
	ensure('sidePanel', { setPanelBehavior: (...a) => reply(a, undefined), setOptions: (...a) => reply(a, undefined), getOptions: (...a) => reply(a, {}), open: (...a) => reply(a, undefined) });
	// Связь с браузером: запросы уходят в канал, на другом конце боковая панель передаёт их главному процессу (нужна открытая панель)
	const bus = new BroadcastChannel('problet-dbg');
	const waits = new Map();
	bus.addEventListener('message', (m) => {
		const d = m.data || {};
		if (d.rid && waits.has(d.rid)) waits.get(d.rid)(d);
	});
	const rpc = (req) => new Promise((resolve, reject) => {
		const rid = Math.random().toString(36).slice(2);
		const timer = setTimeout(() => { waits.delete(rid); reject(new Error('The browser is not available: the side panel is closed.')); }, 60000);
		waits.set(rid, (d) => {
			clearTimeout(timer);
			waits.delete(rid);
			if (d.ok) resolve(d.value); else reject(new Error(d.error));
		});
		bus.postMessage({ rid, req });
	});
	// Вызов в стиле chrome: колбэк последним аргументом либо промис; ошибка попадает в chrome.runtime.lastError
	const call = (a, req, fix) => {
		const cb = a.length && typeof a[a.length - 1] === 'function' ? a[a.length - 1] : null;
		const p = rpc(req).then((v) => (fix ? fix(v) : v));
		if (!cb) return p;
		p.then((v) => cb(v), (e) => {
			c.runtime.lastError = { message: String((e && e.message) || e) };
			try { cb(undefined); } finally { c.runtime.lastError = undefined; }
		});
		return undefined;
	};
	// chrome.debugger: события отладчика приходят из браузера через тот же канал
	if (!c.debugger) {
		const onEvent = event();
		const onDetach = event();
		bus.addEventListener('message', (m) => {
			const d = m.data || {};
			if (!d.ev) return;
			if (d.ev.detach) onDetach._fire({ tabId: d.ev.tabId }, d.ev.reason || 'target_closed');
			else onEvent._fire({ tabId: d.ev.tabId, ...(d.ev.sessionId ? { sessionId: d.ev.sessionId } : {}) }, d.ev.method, d.ev.params);
		});
		c.debugger = {
			onEvent,
			onDetach,
			attach: (...a) => call(a, { op: 'attach', tabId: a[0] && a[0].tabId, version: a[1] }),
			detach: (...a) => call(a, { op: 'detach', tabId: a[0] && a[0].tabId }),
			sendCommand: (...a) => call(a, { op: 'send', tabId: a[0] && a[0].tabId, sessionId: a[0] && a[0].sessionId, method: a[1], params: a[2] && typeof a[2] === 'object' ? a[2] : {} }),
			getTargets: (...a) => call(a, { op: 'targets' }),
		};
	}
	// Фоновому процессу в Electron не хватает работы с вкладками и окном (создать и закрыть вкладку, назад/вперёд, размер окна, скрытая страница)
	if (typeof ServiceWorkerGlobalScope !== 'undefined' && c.tabs) {
		const tabOf = (t) => ({ id: t.id, index: 0, windowId: 1, groupId: -1, active: !!t.active, highlighted: !!t.active, selected: !!t.active, pinned: false, incognito: false, discarded: false, autoDiscardable: true, url: t.url || '', pendingUrl: t.url || '', title: t.title || '', status: 'loading' });
		const winOf = (w) => ({ ...w, tabs: undefined });
		const first = (a) => (typeof a[0] === 'object' && a[0] ? a[0] : {});
		c.tabs.create = (...a) => call(a, { op: 'tab-create', url: first(a).url, active: first(a).active }, tabOf);
		c.tabs.remove = (...a) => call(a, { op: 'tab-remove', ids: [].concat(a[0]).filter((x) => typeof x === 'number') });
		c.tabs.goBack = (...a) => call(a, { op: 'tab-nav', tabId: typeof a[0] === 'number' ? a[0] : undefined, dir: -1 });
		c.tabs.goForward = (...a) => call(a, { op: 'tab-nav', tabId: typeof a[0] === 'number' ? a[0] : undefined, dir: 1 });
		const W = c.windows;
		if (W) {
			Object.assign(W, {
				WINDOW_ID_NONE: -1,
				WINDOW_ID_CURRENT: -2,
				get: (...a) => call(a, { op: 'win-get' }, winOf),
				getCurrent: (...a) => call(a, { op: 'win-get' }, winOf),
				getLastFocused: (...a) => call(a, { op: 'win-get' }, winOf),
				getAll: (...a) => call(a, { op: 'win-get' }, (w) => [winOf(w)]),
				update: (...a) => call(a, { op: 'win-set', props: a[1] && typeof a[1] === 'object' ? a[1] : {} }, winOf),
				create: (...a) => call(a, { op: 'tab-create', url: [].concat(first(a).url || [])[0], active: first(a).focused !== false }, (t) => ({ ...winOf({ id: 1, focused: true, type: 'normal', state: 'normal', incognito: false }), tabs: [tabOf(t)] })),
				remove: (...a) => reply(a, undefined),
			});
		}
		if (!c.offscreen) {
			c.offscreen = {
				Reason: new Proxy({}, { get: (t, k) => (typeof k === 'string' ? k : undefined) }),
				createDocument: (...a) => call(a, { op: 'offscreen-create', url: first(a).url }),
				hasDocument: (...a) => call(a, { op: 'offscreen-has' }),
				closeDocument: (...a) => call(a, { op: 'offscreen-close' }),
			};
		}
	}
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
	// В Electron chrome.runtime.onStartup не срабатывает вообще, а расширения на нём заново входят в аккаунт и поднимают свои службы.
	// Подменяем событие своим и один раз за запуск браузера (память сеанса storage.session пустеет при перезапуске) сами его вызываем
	if (typeof ServiceWorkerGlobalScope !== 'undefined' && c.runtime && c.storage && c.storage.session) {
		const own = event();
		try {
			Object.defineProperty(c.runtime, 'onStartup', { value: own, configurable: true, writable: true });
		} catch (err) { /* останется родное событие */ }
		if (c.runtime.onStartup === own) {
			setTimeout(async () => {
				try {
					const k = '__problet_started';
					if ((await c.storage.session.get(k))[k]) return;
					await c.storage.session.set({ [k]: Date.now() });
					own._fire();
				} catch (err) { /* без этого вход после перезапуска может не восстановиться */ }
			}, 1500);
		}
	}
	if (typeof ServiceWorkerGlobalScope !== 'undefined' && c.runtime) {
		// Боковая панель Chrome — не вкладка: у её сообщений нет sender.tab, и расширение по этому отличает панель от страницы.
		// Electron считает панель вкладкой и добавляет tab, поэтому для страниц sidepanel*.html убираем его
		const own = new RegExp('^chrome-extension://' + c.runtime.id + '/sidepanel[^/]*\\.html');
		const clean = (s) => {
			if (!s || !s.tab || typeof s.url !== 'string' || !own.test(s.url)) return s;
			const { tab, ...rest } = s;
			return rest;
		};
		const om = c.runtime.onMessage;
		if (om && om.addListener) {
			const map = new Map();
			const addM = om.addListener.bind(om);
			const rmM = om.removeListener.bind(om);
			try {
				om.addListener = (f) => {
					const w = (msg, sender, send) => f(msg, clean(sender), send);
					map.set(f, w);
					addM(w);
				};
				om.removeListener = (f) => { const w = map.get(f); if (w) { map.delete(f); rmM(w); } };
				om.hasListener = (f) => map.has(f);
			} catch (err) { /* останется родное событие */ }
		}
		// Сообщения от рамки claude.ai в боковой панели приходят по каналу от браузера: отдаём их слушателям onMessageExternal
		const ne = c.runtime.onMessageExternal;
		if (ne && ne.addListener) {
			const bridge = [];
			const addE = ne.addListener.bind(ne);
			try {
				ne.addListener = (f) => { bridge.push(f); addE(f); };
			} catch (err) { /* без моста чат в панели не получит ответов */ }
			const chx = new BroadcastChannel('problet-ext');
			chx.onmessage = (e) => {
				const d = e.data && e.data.ext;
				if (!d) return;
				let answered = false;
				const reply = (v) => {
					if (answered) return;
					answered = true;
					chx.postMessage({ reply: d.id, value: v === undefined ? null : v });
				};
				const sender = { id: c.runtime.id, origin: d.origin, url: d.url, frameId: 1 };
				let any = false;
				for (const f of bridge.slice()) {
					try { if (f(d.msg, sender, reply) === true) any = true; } catch (err) { /* следующий */ }
				}
				setTimeout(() => reply(undefined), any ? 25000 : 0);
			};
		}
	}
	// Группы вкладок: в Electron их нет, а расширение собирает в группу вкладки, которыми управляет. Здесь группы только
	// воображаемые: помним, какая вкладка в какой группе, и отдаём это через chrome.tabGroups и поле groupId у вкладок
	if (simGroups && c.tabs && c.tabGroups) {
		const KEY = '__problet_groups';
		const store = c.storage && c.storage.session;
		let mem = { next: 1, groups: {}, tabs: {} };
		let chain = Promise.resolve();
		const fail = (m) => { const e = new Error(m); return e; };
		const run = (a, fn) => {
			const cb = typeof a[a.length - 1] === 'function' ? a[a.length - 1] : null;
			const p = fn(cb ? a.slice(0, -1) : a);
			if (!cb) return p;
			p.then((v) => cb(v), (e) => { c.runtime.lastError = { message: String((e && e.message) || e) }; try { cb(undefined); } finally { c.runtime.lastError = undefined; } });
			return undefined;
		};
		const origQuery = c.tabs.query.bind(c.tabs);
		const origGet = c.tabs.get.bind(c.tabs);
		const origCreate = c.tabs.create ? c.tabs.create.bind(c.tabs) : null;
		const tx = (fn) => {
			const r = chain.then(async () => {
				let st = mem;
				if (store) { try { st = (await store.get(KEY))[KEY] || mem; } catch (err) { st = mem; } }
				const gone = [];
				try {
					const live = new Set(((await origQuery({})) || []).map((t) => t.id));
					if (live.size) {
						for (const id of Object.keys(st.tabs)) if (!live.has(+id)) delete st.tabs[id];
						for (const g of Object.keys(st.groups)) if (!Object.values(st.tabs).includes(+g)) { gone.push(st.groups[g]); delete st.groups[g]; }
					}
				} catch (err) { /* без списка вкладок ничего не вычищаем */ }
				const out = await fn(st, gone);
				mem = st;
				if (store) await store.set({ [KEY]: st }).catch(() => {});
				gone.forEach((g) => c.tabGroups.onRemoved && c.tabGroups.onRemoved._fire && c.tabGroups.onRemoved._fire(g));
				return out;
			});
			chain = r.catch(() => {});
			return r;
		};
		const withGroup = (t, st) => (t && typeof t === 'object' ? { ...t, windowId: t.windowId || 1, groupId: st.tabs[t.id] !== undefined ? st.tabs[t.id] : -1 } : t);
		const fire = (ev, ...v) => { const e = c.tabGroups[ev]; if (e && e._fire) e._fire(...v); };
		const ids = (v) => [].concat(v === undefined ? [] : v).map(Number);
		const sweep = (st, gone) => {
			for (const g of Object.keys(st.groups)) if (!Object.values(st.tabs).includes(+g)) { gone.push(st.groups[g]); delete st.groups[g]; }
		};
		Object.assign(c.tabGroups, {
			get: (...a) => run(a, (b) => tx(async (st) => {
				const g = st.groups[b[0]];
				if (!g) throw fail('No group with id: ' + b[0] + '.');
				return { ...g };
			})),
			query: (...a) => run(a, (b) => tx(async (st) => {
				const q = b[0] || {};
				const pat = typeof q.title === 'string' ? new RegExp('^' + q.title.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$') : null;
				return Object.values(st.groups).filter((g) => (!pat || pat.test(g.title || '')) && (q.color === undefined || g.color === q.color) && (q.collapsed === undefined || g.collapsed === q.collapsed) && (q.windowId === undefined || q.windowId === -2 || g.windowId === q.windowId) && (q.shared === undefined || g.shared === q.shared)).map((g) => ({ ...g }));
			})),
			update: (...a) => run(a, (b) => tx(async (st) => {
				const g = st.groups[b[0]];
				if (!g) throw fail('No group with id: ' + b[0] + '.');
				const p = b[1] || {};
				for (const k of ['title', 'color', 'collapsed']) if (p[k] !== undefined) g[k] = p[k];
				fire('onUpdated', { ...g });
				return { ...g };
			})),
			move: (...a) => run(a, (b) => tx(async (st) => {
				const g = st.groups[b[0]];
				if (!g) throw fail('No group with id: ' + b[0] + '.');
				return { ...g };
			})),
		});
		c.tabs.group = (...a) => run(a, (b) => tx(async (st, gone) => {
			const o = b[0] || {};
			const list = ids(o.tabIds);
			if (!list.length) throw fail('No tabs specified.');
			let gid = o.groupId;
			if (gid === undefined || gid === null) {
				gid = st.next++;
				const wid = (o.createProperties && o.createProperties.windowId) || 1;
				st.groups[gid] = { id: gid, collapsed: false, color: 'grey', title: '', windowId: wid, shared: false };
				fire('onCreated', { ...st.groups[gid] });
			} else if (!st.groups[gid]) throw fail('No group with id: ' + gid + '.');
			for (const t of list) st.tabs[t] = gid;
			sweep(st, gone);
			return gid;
		}));
		c.tabs.ungroup = (...a) => run(a, (b) => tx(async (st, gone) => {
			for (const t of ids(b[0])) delete st.tabs[t];
			sweep(st, gone);
		}));
		c.tabs.get = (...a) => run(a, (b) => tx(async (st) => withGroup(await origGet(...b), st)));
		c.tabs.query = (...a) => run(a, (b) => tx(async (st) => {
			const q = { ...(b[0] || {}) };
			const gid = q.groupId;
			delete q.groupId;
			let out = ((await origQuery(q)) || []).map((t) => withGroup(t, st));
			if (gid !== undefined) out = out.filter((t) => t.groupId === gid);
			return out;
		}));
		if (origCreate) c.tabs.create = (...a) => run(a, (b) => tx(async (st) => withGroup(await origCreate(...b), st)));
	}
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
