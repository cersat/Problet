// Недостающие в Electron API расширений Chrome: cookies, contextMenus, notifications, webNavigation, declarativeNetRequest.
// Фоновый процесс расширения (ext-shim.js) шлёт сюда запросы через страницу-посредник, а события возвращаются тем же путём.
// Браузер сам подставляет id расширения из страницы-посредника, поэтому одно расширение не может говорить за другое.

const fs = require('fs');
const path = require('path');
const { Notification, nativeImage } = require('electron');

let H = null; // { session, relays, dataDir, tabInfo }
// h.session() — сессия расширений, h.relays() — Map id → окно-посредник, h.dataDir() — папка данных, h.tabInfo(wc) — вкладка в виде chrome.tabs.Tab
function init(h) {
	H = h;
}

const manifestOf = (id) => {
	try {
		const e = H.session().extensions.getExtension(id);
		return (e && e.manifest) || null;
	} catch (err) {
		return null;
	}
};
const can = (id, perm) => {
	const m = manifestOf(id);
	return !!m && [].concat(m.permissions || [], m.optional_permissions || []).includes(perm);
};
const need = (id, perm) => {
	if (!can(id, perm)) throw new Error("Extension doesn't have the permission '" + perm + "'.");
};

// Событие расширению: страница-посредник передаёт его фоновому процессу
function emit(extId, name, args) {
	const w = H.relays().get(extId);
	if (w && !w.isDestroyed()) w.webContents.send('api:event', { name, args });
}
function emitAll(perm, name, args) {
	for (const id of H.relays().keys()) if (can(id, perm)) emit(id, name, args);
}

// ---------- cookies ----------

const SAME = { unspecified: 'unspecified', no_restriction: 'no_restriction', lax: 'lax', strict: 'strict' };
const cookieOut = (c) => ({
	name: c.name, value: c.value, domain: c.domain || '', hostOnly: !!c.hostOnly, path: c.path || '/', secure: !!c.secure, httpOnly: !!c.httpOnly,
	sameSite: SAME[c.sameSite] || 'unspecified', session: !c.expirationDate, ...(c.expirationDate ? { expirationDate: c.expirationDate } : {}), storeId: '0',
});

async function cookiesGetAll(d) {
	d = d || {};
	const f = {};
	if (d.url) f.url = String(d.url);
	if (d.name !== undefined) f.name = String(d.name);
	if (d.domain !== undefined) f.domain = String(d.domain);
	if (d.path !== undefined) f.path = String(d.path);
	if (d.secure !== undefined) f.secure = !!d.secure;
	if (d.session !== undefined) f.session = !!d.session;
	const list = await H.session().cookies.get(f);
	return list.map(cookieOut);
}

function hookCookies(ses) {
	ses.cookies.on('changed', (e, cookie, cause, removed) => {
		emitAll('cookies', 'cookies.onChanged', [{ removed: !!removed, cookie: cookieOut(cookie), cause: String(cause).replace(/-/g, '_') }]);
	});
}

// ---------- contextMenus ----------

const menus = new Map(); // id расширения → список пунктов (как их создало расширение)

const patternRe = (p) => {
	if (p === '<all_urls>') return /^(https?|file|ftp):\/\//;
	const m = /^(\*|https?|file|ftp):\/\/([^/]*)(\/.*)$/.exec(String(p));
	if (!m) return null;
	const esc = (s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
	const scheme = m[1] === '*' ? 'https?' : m[1];
	const host = m[2] === '*' ? '[^/]*' : m[2].startsWith('*.') ? '([^/]*\\.)?' + esc(m[2].slice(2)) : esc(m[2]);
	return new RegExp('^' + scheme + '://' + host + esc(m[3]) + '$');
};
const urlMatches = (patterns, url) => !patterns || !patterns.length || patterns.some((p) => { const r = patternRe(p); return r && r.test(url || ''); });

// Пункты расширений для меню страницы: [{ label, click } | { type: 'separator' } | { label, submenu }]
function menuItems(tab, params, click) {
	const out = [];
	const ctxs = new Set(['all', 'page']);
	if (params.selectionText) ctxs.add('selection');
	if (params.linkURL) ctxs.add('link');
	if (params.isEditable) ctxs.add('editable');
	if (params.mediaType === 'image') ctxs.add('image');
	if (params.mediaType === 'video') ctxs.add('video');
	if (params.mediaType === 'audio') ctxs.add('audio');
	if (params.frameURL && params.frameURL !== params.pageURL) ctxs.add('frame');
	// страница считается «page», когда нет ничего более частного (как в Chrome)
	const special = ['selection', 'link', 'editable', 'image', 'video', 'audio'].some((c) => ctxs.has(c));
	if (special) ctxs.delete('page');
	const pageUrl = params.pageURL || '';
	for (const [extId, items] of menus) {
		const ok = (it) => it.visible !== false && (it.contexts || ['page']).some((c) => ctxs.has(c))
			&& urlMatches(it.documentUrlPatterns, pageUrl) && (!params.linkURL && !params.srcURL || urlMatches(it.targetUrlPatterns, params.linkURL || params.srcURL));
		const build = (it) => {
			if (it.type === 'separator') return { type: 'separator' };
			const kids = items.filter((x) => x.parentId === it.id);
			let label = String(it.title || '').replace(/%s/g, (params.selectionText || '').trim().slice(0, 30));
			label = label.replace(/&/g, '&&');
			const row = { label, enabled: it.enabled !== false };
			if (it.type === 'checkbox' || it.type === 'radio') {
				row.type = it.type;
				row.checked = !!it.checked;
			}
			if (kids.length) {
				const sub = kids.filter((k) => k.visible !== false).map(build);
				if (!sub.length) return null;
				row.submenu = sub;
			} else {
				row.click = () => click(extId, it, params, tab);
			}
			return row;
		};
		const top = items.filter((it) => !it.parentId && (ok(it) || items.some((k) => k.parentId === it.id && ok(k))));
		if (!top.length) continue;
		const rows = top.map((it) => (it.type !== 'separator' && items.some((k) => k.parentId === it.id) ? build({ ...it, contexts: ['all'] }) : build(it))).filter(Boolean);
		if (!rows.length) continue;
		// Несколько пунктов одного расширения складываются в подменю с его названием
		const m = manifestOf(extId);
		const name = (m && typeof m.name === 'string' && !m.name.startsWith('__MSG_') ? m.name : 'Расширение');
		out.push(rows.length > 1 ? { label: name, submenu: rows } : rows[0]);
	}
	return out;
}

// Нажали пункт: расширению уходит onClicked (флажки и переключатели обновляем у себя и сообщаем)
function menuClicked(extId, it, params, tab) {
	const info = { menuItemId: it.id, pageUrl: params.pageURL || undefined, frameUrl: params.frameURL || undefined, editable: !!params.isEditable };
	if (it.parentId !== undefined) info.parentMenuItemId = it.parentId;
	if (params.linkURL) info.linkUrl = params.linkURL;
	if (params.srcURL) info.srcUrl = params.srcURL;
	if (params.mediaType && params.mediaType !== 'none') info.mediaType = params.mediaType;
	if (params.selectionText) info.selectionText = params.selectionText;
	if (it.type === 'checkbox' || it.type === 'radio') {
		info.wasChecked = !!it.checked;
		if (it.type === 'checkbox') it.checked = !it.checked;
		else for (const k of menus.get(extId) || []) if (k.type === 'radio' && k.parentId === it.parentId) k.checked = k === it;
		info.checked = !!it.checked;
	}
	emit(extId, 'contextMenus.onClicked', [info, tab]);
}

// ---------- notifications ----------

const shown = new Map(); // id расширения + ':' + id уведомления → Notification
function notify(extId, id, o) {
	need(extId, 'notifications');
	const key = extId + ':' + id;
	const old = shown.get(key);
	if (old) old.removeAllListeners('close'), old.close();
	let icon;
	const u = String(o.iconUrl || '');
	try {
		if (/^data:/.test(u)) icon = nativeImage.createFromDataURL(u);
		else if (u && !/^[a-z]+:/i.test(u)) {
			const m = manifestOf(extId);
			const dir = m && H.session().extensions.getExtension(extId).path;
			if (dir) icon = nativeImage.createFromPath(path.join(dir, u));
		}
	} catch (e) { /* без значка */ }
	const body = o.type === 'list' && Array.isArray(o.items) ? o.items.map((i) => (i.title ? i.title + ' ' : '') + (i.message || '')).join('\n') : String(o.message || '');
	// Кнопки уведомлений есть только на macOS: на других системах Electron их не показывает
	const buttons = Array.isArray(o.buttons) ? o.buttons.slice(0, 2).map((b) => ({ type: 'button', text: String((b && b.title) || '') })) : [];
	const n = new Notification({ title: String(o.title || ''), body, silent: !!o.silent, ...(icon && !icon.isEmpty() ? { icon } : {}), ...(buttons.length && process.platform === 'darwin' ? { actions: buttons } : {}) });
	n.on('action', (_e, index) => emit(extId, 'notifications.onButtonClicked', [id, index]));
	n.on('click', () => emit(extId, 'notifications.onClicked', [id]));
	n.on('close', () => {
		if (shown.get(key) === n) shown.delete(key);
		emit(extId, 'notifications.onClosed', [id, true]);
	});
	shown.set(key, n);
	n.show();
}
function notifyClear(extId, id) {
	const key = extId + ':' + id;
	const n = shown.get(key);
	if (!n) return false;
	shown.delete(key);
	n.removeAllListeners('close');
	n.close();
	emit(extId, 'notifications.onClosed', [id, false]);
	return true;
}

// ---------- webNavigation ----------

const frameId = (f, wc) => (f === wc.mainFrame ? 0 : f.routingId);
function hookNavigation(wc) {
	if (wc.__probletNav) return;
	wc.__probletNav = true;
	const stamp = () => Date.now();
	const base = (url, f, isMain) => ({ tabId: wc.id, url, frameId: isMain ? 0 : f ? f.routingId : 0, parentFrameId: isMain ? -1 : f && f.parent ? frameId(f.parent, wc) : 0, processId: f ? f.processId : -1, timeStamp: stamp() });
	const go = (name, d) => emitAll('webNavigation', 'webNavigation.' + name, [d]);
	wc.on('did-start-navigation', (e) => {
		if (e.isSameDocument) return;
		const d = base(e.url, e.frame, e.isMainFrame);
		go('onBeforeNavigate', d);
	});
	wc.on('did-frame-navigate', (_e, url, code, text, isMain, processId, routingId) => {
		const f = isMain ? wc.mainFrame : (wc.mainFrame.framesInSubtree || []).find((x) => x.routingId === routingId);
		go('onCommitted', { ...base(url, f, isMain), transitionType: 'link', transitionQualifiers: [] });
	});
	wc.on('dom-ready', () => go('onDOMContentLoaded', base(wc.getURL(), wc.mainFrame, true)));
	wc.on('did-frame-finish-load', (_e, isMain, processId, routingId) => {
		const f = isMain ? wc.mainFrame : (wc.mainFrame.framesInSubtree || []).find((x) => x.routingId === routingId);
		go('onCompleted', base(f ? f.url : wc.getURL(), f, isMain));
	});
	wc.on('did-navigate-in-page', (_e, url, isMain, processId, routingId) => {
		const f = isMain ? wc.mainFrame : (wc.mainFrame.framesInSubtree || []).find((x) => x.routingId === routingId);
		const d = base(url, f, isMain);
		go('onHistoryStateUpdated', { ...d, transitionType: 'link', transitionQualifiers: [] });
		if (/#/.test(url)) go('onReferenceFragmentUpdated', { ...d, transitionType: 'link', transitionQualifiers: [] });
	});
	wc.on('did-fail-load', (_e, code, text, url, isMain, processId, routingId) => {
		if (code === -3) return; // отмена перехода — не ошибка
		const f = isMain ? wc.mainFrame : (wc.mainFrame.framesInSubtree || []).find((x) => x.routingId === routingId);
		go('onErrorOccurred', { ...base(url, f, isMain), error: String(text || code) });
	});
}
function frameDetails(wc, f) {
	const isMain = f === wc.mainFrame;
	return { frameId: frameId(f, wc), parentFrameId: isMain ? -1 : f.parent ? frameId(f.parent, wc) : 0, url: f.url, processId: f.processId, errorOccurred: false, documentLifecycle: 'active', frameType: isMain ? 'outermost_frame' : 'sub_frame' };
}

// ---------- declarativeNetRequest ----------

const DNR_TYPES = { mainFrame: 'main_frame', subFrame: 'sub_frame', stylesheet: 'stylesheet', script: 'script', image: 'image', font: 'font', object: 'object', xhr: 'xmlhttprequest', ping: 'ping', cspReport: 'csp_report', media: 'media', webSocket: 'websocket', other: 'other' };
const dnrFile = () => path.join(H.dataDir(), 'ext-dnr.json');
let dnrSaved = {}; // id расширения → { dynamic: [правила], enabled: [id наборов] | null }
const session_ = new Map(); // id расширения → правила сеанса
const compiled = new Map(); // id расширения → { key, rules }

function loadSaved() {
	try {
		dnrSaved = JSON.parse(fs.readFileSync(dnrFile(), 'utf8')) || {};
	} catch (e) {
		dnrSaved = {};
	}
}
function saveSaved() {
	try {
		fs.writeFileSync(dnrFile(), JSON.stringify(dnrSaved), 'utf8');
	} catch (e) { /* не страшно: правила расширение зададит заново */ }
}
const mine = (id) => (dnrSaved[id] = dnrSaved[id] || { dynamic: [], enabled: null });

// urlFilter → регулярное выражение: || — начало домена, | — начало и конец адреса, ^ — разделитель, * — что угодно
function filterRe(f, sens) {
	let s = String(f);
	let pre = '';
	if (s.startsWith('||')) {
		pre = '^[a-z][a-z0-9+.-]*://([^/?#]*\\.)?';
		s = s.slice(2);
	} else if (s.startsWith('|')) {
		pre = '^';
		s = s.slice(1);
	}
	let post = '';
	if (s.endsWith('|')) {
		post = '$';
		s = s.slice(0, -1);
	}
	const body = s.replace(/[.+?${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\^/g, '([^\\w\\-.%]|$)');
	return new RegExp(pre + body + post, sens ? '' : 'i');
}
const literal = (f) => (String(f).replace(/^\|\|?/, '').replace(/\|$/, '').split(/[*^]/).sort((a, b) => b.length - a.length)[0] || '').toLowerCase();
const domainIn = (host, list) => list.some((d) => host === d || host.endsWith('.' + d));

function compileRule(r, extId) {
	if (!r || typeof r !== 'object' || !r.action || !r.condition) return null;
	const c = r.condition;
	const out = { id: r.id, priority: r.priority || 1, type: r.action.type, action: r.action, c };
	try {
		if (c.regexFilter) out.re = new RegExp(c.regexFilter, c.isUrlFilterCaseSensitive ? '' : 'i');
		else if (c.urlFilter) {
			out.re = filterRe(c.urlFilter, c.isUrlFilterCaseSensitive);
			out.lit = c.isUrlFilterCaseSensitive ? '' : literal(c.urlFilter);
		}
	} catch (e) {
		return null;
	}
	out.types = c.resourceTypes ? new Set(c.resourceTypes) : null;
	out.notTypes = c.excludedResourceTypes ? new Set(c.excludedResourceTypes) : null;
	if (!out.types && !out.notTypes) out.notTypes = new Set(['main_frame']);
	out.ext = extId;
	return out;
}

function rulesOf(extId) {
	const m = manifestOf(extId);
	const dnr = m && m.declarative_net_request;
	if (!dnr && !(dnrSaved[extId] || {}).dynamic && !session_.has(extId)) return [];
	const st = mine(extId);
	const key = JSON.stringify([st.enabled, st.dynamic.length, (session_.get(extId) || []).length, st.rev || 0]);
	const have = compiled.get(extId);
	if (have && have.key === key) return have.rules;
	const rules = [];
	const ext = H.session().extensions.getExtension(extId);
	for (const rs of (dnr && dnr.rule_resources) || []) {
		const on = st.enabled ? st.enabled.includes(rs.id) : rs.enabled;
		if (!on || !ext) continue;
		try {
			for (const r of JSON.parse(fs.readFileSync(path.join(ext.path, rs.path), 'utf8'))) {
				const c = compileRule(r, extId);
				if (c) rules.push(c);
			}
		} catch (e) { /* набор не прочитался: остальные работают */ }
	}
	for (const r of st.dynamic) {
		const c = compileRule(r, extId);
		if (c) rules.push(c);
	}
	for (const r of session_.get(extId) || []) {
		const c = compileRule(r, extId);
		if (c) rules.push(c);
	}
	compiled.set(extId, { key, rules });
	return rules;
}

const ORDER = { allow: 0, allowAllRequests: 1, block: 2, upgradeScheme: 3, redirect: 4, modifyHeaders: 5 };
function matches(r, d, ctx) {
	const c = r.c;
	const type = DNR_TYPES[d.resourceType] || 'other';
	if (r.types && !r.types.has(type)) return false;
	if (r.notTypes && r.notTypes.has(type)) return false;
	if (c.requestMethods && !c.requestMethods.includes(String(d.method || 'GET').toLowerCase())) return false;
	if (c.excludedRequestMethods && c.excludedRequestMethods.includes(String(d.method || 'GET').toLowerCase())) return false;
	if (r.lit && !ctx.lower.includes(r.lit)) return false;
	if (r.re && !r.re.test(d.url)) return false;
	const dom = c.requestDomains || c.domains;
	if (dom && !domainIn(ctx.host, dom.map((x) => String(x).toLowerCase()))) return false;
	const nodom = c.excludedRequestDomains || c.excludedDomains;
	if (nodom && domainIn(ctx.host, nodom.map((x) => String(x).toLowerCase()))) return false;
	const ini = c.initiatorDomains || c.domains;
	if (c.initiatorDomains && !(ctx.init && domainIn(ctx.init, c.initiatorDomains.map((x) => String(x).toLowerCase())))) return false;
	if (c.excludedInitiatorDomains && ctx.init && domainIn(ctx.init, c.excludedInitiatorDomains.map((x) => String(x).toLowerCase()))) return false;
	void ini;
	if (c.domainType) {
		const third = !!ctx.init && ctx.init !== ctx.host && !ctx.init.endsWith('.' + ctx.host) && !ctx.host.endsWith('.' + ctx.init);
		if (c.domainType === 'thirdParty' && !third) return false;
		if (c.domainType === 'firstParty' && third) return false;
	}
	return true;
}

function requestCtx(d) {
	let u;
	try {
		u = new URL(d.url);
	} catch (e) {
		return null;
	}
	let init = '';
	try {
		init = new URL(d.referrer || (d.frame && d.frame.url) || (d.webContents && d.webContents.getURL()) || '').hostname.toLowerCase();
	} catch (e) { /* без источника запроса */ }
	return { u, host: u.hostname.toLowerCase(), lower: d.url.toLowerCase(), init };
}

function best(d) {
	if (!H || !H.relays().size) return null;
	const ctx = requestCtx(d);
	if (!ctx) return null;
	const hits = [];
	for (const [extId] of H.relays()) {
		for (const r of rulesOf(extId)) if (matches(r, d, ctx)) hits.push(r);
	}
	return { hits, ctx };
}

function redirectTarget(r, d, ctx) {
	const red = r.action.redirect || {};
	if (red.url) return red.url;
	if (red.extensionPath) return 'chrome-extension://' + r.ext + (String(red.extensionPath).startsWith('/') ? '' : '/') + red.extensionPath;
	if (red.regexSubstitution && r.re) {
		const m = r.re.exec(d.url);
		if (m) return red.regexSubstitution.replace(/\\(\d)/g, (_x, n) => m[Number(n)] || '');
	}
	if (red.transform) {
		const t = red.transform;
		const u = new URL(d.url);
		if (t.scheme) u.protocol = t.scheme;
		if (t.host) u.hostname = t.host;
		if (t.port !== undefined) u.port = t.port;
		if (t.path !== undefined) u.pathname = t.path;
		if (t.query !== undefined) u.search = t.query;
		if (t.fragment !== undefined) u.hash = t.fragment;
		if (t.username !== undefined) u.username = t.username;
		if (t.password !== undefined) u.password = t.password;
		if (t.queryTransform) {
			for (const k of t.queryTransform.removeParams || []) u.searchParams.delete(k);
			for (const p of t.queryTransform.addOrReplaceParams || []) u.searchParams.set(p.key, p.value);
		}
		return u.href;
	}
	void ctx;
	return null;
}

// Перед запросом: { cancel } или { redirectURL }, если подошло правило расширения; иначе null
function beforeRequest(d) {
	if (!H || /^(problet|problet-addon|chrome-extension|devtools|file|data|blob):/i.test(d.url)) return null;
	const found = best(d);
	if (!found || !found.hits.length) return null;
	const top = found.hits.filter((r) => r.type !== 'modifyHeaders').sort((a, b) => b.priority - a.priority || ORDER[a.type] - ORDER[b.type])[0];
	if (!top || top.type === 'allow' || top.type === 'allowAllRequests') return null;
	if (top.type === 'block') return { cancel: true };
	if (top.type === 'upgradeScheme') return found.ctx.u.protocol === 'http:' ? { redirectURL: d.url.replace(/^http:/, 'https:') } : null;
	if (top.type === 'redirect') {
		const to = redirectTarget(top, d, found.ctx);
		return to && to !== d.url ? { redirectURL: to } : null;
	}
	return null;
}

// Заголовки запроса: правила modifyHeaders (set, append, remove)
function requestHeaders(d, headers) {
	if (!H || !H.relays().size || /^(problet|problet-addon|chrome-extension):/i.test(d.url)) return;
	const found = best(d);
	if (!found) return;
	const blocked = found.hits.some((r) => r.type === 'allow' || r.type === 'allowAllRequests');
	if (blocked) return;
	for (const r of found.hits.filter((x) => x.type === 'modifyHeaders').sort((a, b) => b.priority - a.priority)) {
		for (const h of r.action.requestHeaders || []) {
			const name = String(h.header);
			const have = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
			if (h.operation === 'remove') {
				if (have) delete headers[have];
			} else if (h.operation === 'set') {
				if (have) delete headers[have];
				headers[name] = String(h.value);
			} else if (h.operation === 'append') {
				headers[have || name] = have ? headers[have] + ', ' + h.value : String(h.value);
			}
		}
	}
}

// Заголовки ответа: правила modifyHeaders с responseHeaders; вернёт true, если что-то изменилось
function responseHeaders(d, headers) {
	if (!H || !H.relays().size || /^(problet|problet-addon|chrome-extension):/i.test(d.url)) return false;
	const found = best(d);
	if (!found || found.hits.some((r) => r.type === 'allow' || r.type === 'allowAllRequests')) return false;
	let changed = false;
	for (const r of found.hits.filter((x) => x.type === 'modifyHeaders').sort((a, b) => b.priority - a.priority)) {
		for (const h of r.action.responseHeaders || []) {
			const name = String(h.header);
			const have = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
			if (h.operation === 'remove') {
				if (have) delete headers[have];
			} else if (h.operation === 'set') {
				if (have) delete headers[have];
				headers[name] = [String(h.value)];
			} else if (h.operation === 'append') {
				headers[have || name] = [...(have ? [].concat(headers[have]) : []), String(h.value)];
			}
			changed = true;
		}
	}
	return changed;
}

function dnrUpdate(extId, kind, o) {
	need(extId, 'declarativeNetRequest');
	o = o || {};
	const st = mine(extId);
	const list = kind === 'dynamic' ? st.dynamic : (session_.get(extId) || []);
	const drop = new Set(o.removeRuleIds || []);
	let next = list.filter((r) => !drop.has(r.id));
	const ids = new Set(next.map((r) => r.id));
	for (const r of o.addRules || []) {
		if (!r || !Number.isInteger(r.id) || r.id < 1) throw new Error('Rule with id ' + (r && r.id) + ' does not have a valid id.');
		if (ids.has(r.id)) throw new Error('Rule with id ' + r.id + ' does not have a unique ID.');
		if (!compileRule(r, extId)) throw new Error('Rule with id ' + r.id + ' is not valid.');
		ids.add(r.id);
		next.push(r);
	}
	if (next.length > 30000) throw new Error('Rule count exceeded.');
	if (kind === 'dynamic') {
		st.dynamic = next;
		st.rev = (st.rev || 0) + 1;
		saveSaved();
	} else {
		session_.set(extId, next);
	}
	compiled.delete(extId);
	return null;
}
function dnrGet(extId, kind, filter) {
	need(extId, 'declarativeNetRequest');
	const list = kind === 'dynamic' ? mine(extId).dynamic : (session_.get(extId) || []);
	const ids = filter && Array.isArray(filter.ruleIds) ? new Set(filter.ruleIds) : null;
	return list.filter((r) => !ids || ids.has(r.id));
}
function dnrRulesets(extId, o) {
	need(extId, 'declarativeNetRequest');
	const m = manifestOf(extId);
	const all = ((m && m.declarative_net_request && m.declarative_net_request.rule_resources) || []);
	const st = mine(extId);
	let on = st.enabled || all.filter((r) => r.enabled).map((r) => r.id);
	if (o) {
		const ids = new Set(all.map((r) => r.id));
		for (const id of [].concat(o.enableRulesetIds || [], o.disableRulesetIds || [])) if (!ids.has(id)) throw new Error('Invalid ruleset ID: ' + id);
		on = on.filter((id) => !(o.disableRulesetIds || []).includes(id));
		for (const id of o.enableRulesetIds || []) if (!on.includes(id)) on.push(id);
		st.enabled = on;
		st.rev = (st.rev || 0) + 1;
		saveSaved();
		compiled.delete(extId);
	}
	return on;
}

// ---------- commands (горячие клавиши) ----------

const PLATFORM = { linux: 'linux', win32: 'windows', darwin: 'mac' }[process.platform] || 'linux';
const KEYS = { comma: ',', period: '.', space: 'Space', home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown', insert: 'Insert', delete: 'Delete', up: 'Up', down: 'Down', left: 'Left', right: 'Right', tab: 'Tab', enter: 'Enter', esc: 'Esc' };
// «Ctrl+Shift+Y», «Alt+Shift+Comma», «MacCtrl+K» → строка в том же виде, что у горячих клавиш браузера (Ctrl, Alt, Shift, клавиша)
function normalizeShortcut(s) {
	const parts = String(s || '').split('+').map((x) => x.trim()).filter(Boolean);
	if (parts.length < 2) return /^F\d{1,2}$/i.test(parts[0] || '') ? parts[0].toUpperCase() : '';
	let key = parts.pop();
	const mods = new Set(parts.map((m) => ({ ctrl: 'Ctrl', command: 'Ctrl', macctrl: 'Ctrl', alt: 'Alt', option: 'Alt', shift: 'Shift' }[m.toLowerCase()] || '')));
	if (mods.has('')) return '';
	key = KEYS[key.toLowerCase()] || (key.length === 1 ? key.toUpperCase() : /^F\d{1,2}$/i.test(key) ? key.toUpperCase() : '');
	if (!key) return '';
	return ['Ctrl', 'Alt', 'Shift'].filter((m) => mods.has(m)).concat(key).join('+');
}
function commandsOf(extId) {
	const m = manifestOf(extId);
	const out = [];
	for (const [name, c] of Object.entries((m && m.commands) || {})) {
		const k = c && c.suggested_key;
		const raw = typeof k === 'string' ? k : k && (k[PLATFORM] || k.default) || '';
		out.push({ name, description: String((c && c.description) || ''), shortcut: normalizeShortcut(raw) });
	}
	return out;
}
// Нажатое сочетание принадлежит команде расширения: расширению уходит onCommand. Вернёт true, если сочетание занято
function hotkey(combo, tab) {
	if (!H || !combo) return false;
	for (const id of H.relays().keys()) {
		for (const c of commandsOf(id)) {
			if (c.shortcut !== combo || c.name.startsWith('_execute_')) continue;
			emit(id, 'commands.onCommand', [c.name, tab || undefined]);
			return true;
		}
	}
	return false;
}

// ---------- Запросы от расширения ----------

// Вернёт undefined, если операция не из этого модуля
async function handle(req, extId) {
	if (!H || !extId) return undefined;
	switch (req.op) {
		case 'cookies-getAll': need(extId, 'cookies'); return cookiesGetAll(req.details);
		case 'cookies-get': {
			need(extId, 'cookies');
			const list = await cookiesGetAll(req.details);
			list.sort((a, b) => b.path.length - a.path.length);
			return list[0] || null;
		}
		case 'cookies-set': {
			need(extId, 'cookies');
			const d = req.details || {};
			if (!d.url) throw new Error('No url specified.');
			const c = { url: String(d.url), name: String(d.name || ''), value: String(d.value || ''), path: d.path, secure: d.secure, httpOnly: d.httpOnly };
			if (d.domain) c.domain = String(d.domain);
			if (d.expirationDate) c.expirationDate = Number(d.expirationDate);
			if (d.sameSite) c.sameSite = d.sameSite;
			await H.session().cookies.set(c);
			const got = await cookiesGetAll({ url: c.url, name: c.name });
			return got[0] || null;
		}
		case 'cookies-remove': {
			need(extId, 'cookies');
			const d = req.details || {};
			await H.session().cookies.remove(String(d.url), String(d.name));
			return { url: d.url, name: d.name, storeId: '0' };
		}
		case 'commands-getAll': return commandsOf(extId).map((c) => ({ name: c.name, description: c.description, shortcut: c.shortcut }));
		case 'menus-sync':
			menus.set(extId, Array.isArray(req.items) ? req.items.slice(0, 500) : []);
			return null;
		case 'notif-create': notify(extId, String(req.id), req.options || {}); return null;
		case 'notif-clear': return notifyClear(extId, String(req.id));
		case 'nav-frame': {
			need(extId, 'webNavigation');
			const wc = H.tabById(Number(req.tabId));
			if (!wc) return null;
			const f = [wc.mainFrame, ...(wc.mainFrame.framesInSubtree || [])].find((x) => frameId(x, wc) === Number(req.frameId));
			return f ? frameDetails(wc, f) : null;
		}
		case 'nav-frames': {
			need(extId, 'webNavigation');
			const wc = H.tabById(Number(req.tabId));
			if (!wc) return null;
			const seen = new Set();
			return [wc.mainFrame, ...(wc.mainFrame.framesInSubtree || [])].filter((f) => !seen.has(f) && seen.add(f)).map((f) => frameDetails(wc, f));
		}
		case 'dnr-update': return dnrUpdate(extId, req.kind === 'session' ? 'session' : 'dynamic', req.options);
		case 'dnr-get': return dnrGet(extId, req.kind === 'session' ? 'session' : 'dynamic', req.filter);
		case 'dnr-rulesets': return dnrRulesets(extId, req.options);
		case 'dnr-count': {
			const m = manifestOf(extId);
			return { available: 30000, used: (mine(extId).dynamic || []).length, manifest: !!(m && m.declarative_net_request) };
		}
		default: return undefined;
	}
}

// Расширение выгружено: его пункты меню и правила больше не действуют
function forget(extId) {
	menus.delete(extId);
	session_.delete(extId);
	compiled.delete(extId);
	for (const k of [...shown.keys()]) if (k.startsWith(extId + ':')) {
		const n = shown.get(k);
		shown.delete(k);
		n.removeAllListeners('close');
		n.close();
	}
}

function start(h) {
	init(h);
	loadSaved();
	hookCookies(H.session());
}

module.exports = { start, handle, emit, menuItems, menuClicked, hookNavigation, beforeRequest, requestHeaders, responseHeaders, hotkey, normalizeShortcut, forget, patternRe, filterRe };
