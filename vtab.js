// Виртуальные вкладки: внутренние страницы problet:// без собственного процесса.
// Страница живёт рамкой (iframe) в окне панели браузера, а вкладка получает объект, который для остального кода
// выглядит как WebContentsView: те же методы и события. Так каждая внутренняя страница не заводит процесс отрисовки (~15–20 МБ)
const { EventEmitter } = require('events');
const { nativeImage } = require('electron');

// Окно панели открыто по адресу problet://ui/, рамки страниц — problet://ui/<страница>/…: один сайт, значит один процесс
const FRAME_BASE = 'problet://ui/';
let nextId = 1000000; // номера не пересекаются с webContents.id настоящих страниц

const NO_VIRTUAL_HOSTS = new Set(['blocked', '']); // заглушки заблокированного остаются обычными страницами

function isVirtualUrl(url) {
	try {
		const u = new URL(String(url));
		return u.protocol === 'problet:' && !NO_VIRTUAL_HOSTS.has(u.host);
	} catch (e) {
		return false;
	}
}

// В Node схема problet «необычная»: у problet://settings путь пустой, а в Chromium он «/». Приводим к виду Chromium
function normalize(url) {
	const u = new URL(String(url));
	if (u.protocol === 'problet:' && !u.pathname) u.pathname = '/';
	return u.href;
}

// problet://settings/?a → problet://ui/settings/?a
function toFrameUrl(url) {
	const u = new URL(normalize(url));
	return FRAME_BASE + u.host + u.pathname + u.search + u.hash;
}

// problet://ui/settings/?a → problet://settings/?a
function fromFrameUrl(url) {
	const u = new URL(url);
	if (u.host !== 'ui') return url;
	const m = /^\/([^/]*)(.*)$/.exec(u.pathname);
	return 'problet://' + m[1] + (m[2] || '/') + u.search + u.hash;
}

// Поиск по странице: подсветка через CSS Highlight API, без изменения самой страницы
const FIND_JS = function (q, forward, restart) {
	const S = window.__probletFind || (window.__probletFind = { q: '', ranges: [], i: -1 });
	if (!window.CSS || !CSS.highlights) return { active: 0, total: 0 };
	if (!document.getElementById('__problet_find')) {
		const st = document.createElement('style');
		st.id = '__problet_find';
		st.textContent = '::highlight(problet-find){background:#ffd54f;color:#000}::highlight(problet-find-cur){background:#ff9100;color:#000}';
		(document.head || document.documentElement).append(st);
	}
	if (restart || S.q !== q) {
		S.q = q;
		S.ranges = [];
		const needle = q.toLowerCase();
		const walk = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT, {
			acceptNode: (n) => {
				const p = n.parentElement;
				if (!p || /^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA)$/.test(p.tagName)) return NodeFilter.FILTER_REJECT;
				return p.getClientRects().length ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
			},
		});
		for (let n = walk.nextNode(); n; n = walk.nextNode()) {
			const t = n.data.toLowerCase();
			for (let at = t.indexOf(needle); at >= 0 && S.ranges.length < 5000; at = t.indexOf(needle, at + needle.length)) {
				const r = new Range();
				r.setStart(n, at);
				r.setEnd(n, at + needle.length);
				S.ranges.push(r);
			}
		}
		S.i = S.ranges.length ? (forward ? 0 : S.ranges.length - 1) : -1;
	} else if (S.ranges.length) {
		S.i = (S.i + (forward ? 1 : -1) + S.ranges.length) % S.ranges.length;
	}
	CSS.highlights.set('problet-find', new Highlight(...S.ranges));
	if (S.i >= 0) {
		CSS.highlights.set('problet-find-cur', new Highlight(S.ranges[S.i]));
		const el = S.ranges[S.i].startContainer.parentElement;
		if (el) el.scrollIntoView({ block: 'center', inline: 'nearest' });
	} else {
		CSS.highlights.delete('problet-find-cur');
	}
	return { active: S.i + 1, total: S.ranges.length };
}.toString();
const FIND_CLEAR_JS = '(() => { if (window.CSS && CSS.highlights) { CSS.highlights.delete("problet-find"); CSS.highlights.delete("problet-find-cur"); } window.__probletFind = null; })()';

// host: { send(msg), focus(vc), external(vc, url), toolbar(), rect(), cssZoom(level), bounds(), print(vc, opts, cb) }
class VirtualContents extends EventEmitter {
	constructor(host) {
		super();
		this.host = host;
		this.id = nextId++;
		this.virtual = true;
		this.entries = []; // { url, title }
		this.index = -1;
		this.title = '';
		this.loading = false;
		this.destroyed = false;
		this.frame = null; // рамка страницы (WebFrameMain), появляется после загрузки
		this.expect = ''; // адрес рамки, на который мы её сами отправили
		this.opened = false;
		this.zoomLevel = 0;
		this.waiters = [];
		const self = this;
		this.navigationHistory = {
			canGoBack: () => self.index > 0,
			canGoForward: () => self.index < self.entries.length - 1,
			goBack: () => self.goToIndex(self.index - 1),
			goForward: () => self.goToIndex(self.index + 1),
			getActiveIndex: () => self.index,
			getAllEntries: () => self.entries.map((e) => ({ url: e.url, title: e.title })),
			restore: ({ entries, index }) => {
				const list = (entries || []).filter((e) => e && isVirtualUrl(e.url)).map((e) => ({ url: e.url, title: e.title || '' }));
				if (!list.length) return Promise.resolve();
				self.entries = list;
				self.index = Math.min(Math.max(0, Number(index) || 0), list.length - 1);
				return self.load(list[self.index].url);
			},
		};
		// Отладчик к внутренней странице не подключить, как и к chrome:// в Chrome
		this.debugger = {
			isAttached: () => false,
			attach: () => { throw new Error('К внутренней странице браузера отладчик не подключается'); },
			detach: () => {},
			sendCommand: () => Promise.reject(new Error('К внутренней странице браузера отладчик не подключается')),
		};
	}

	getURL() {
		const e = this.entries[this.index];
		return e ? e.url : '';
	}
	getTitle() { return this.title || this.getURL(); }
	isLoading() { return this.loading; }
	isDestroyed() { return this.destroyed; }
	isCurrentlyAudible() { return false; }
	setUserAgent() {}
	setWindowOpenHandler() {}
	setBackgroundThrottling() {}

	loadURL(url) {
		let display;
		try {
			display = normalize(url);
		} catch (e) {
			return Promise.reject(new Error('Неверный адрес'));
		}
		if (!isVirtualUrl(display)) {
			this.host.external(this, display);
			return Promise.resolve();
		}
		this.entries.splice(this.index + 1);
		this.entries.push({ url: display, title: '' });
		this.index = this.entries.length - 1;
		return this.load(display);
	}

	goToIndex(i) {
		if (i < 0 || i >= this.entries.length || i === this.index) return;
		this.index = i;
		this.load(this.entries[i].url);
	}

	reload() { if (this.getURL()) this.load(this.getURL()); }
	stop() {}

	// Рамку отправляем по адресу; события те же, что у настоящей страницы, и в том же порядке
	load(display) {
		if (this.destroyed) return Promise.resolve();
		this.loading = true;
		this.title = '';
		this.emit('did-start-navigation', { url: display, isMainFrame: true, isSameDocument: false, frame: null });
		this.emit('did-start-loading');
		this.expect = toFrameUrl(display);
		this.host.send({ op: this.opened ? 'nav' : 'open', id: this.id, src: this.expect, zoom: this.host.cssZoom(this.zoomLevel) });
		this.opened = true;
		return new Promise((resolve) => this.waiters.push(resolve));
	}

	// Страница сама уходит на другой адрес (ссылка, location.href). true — переход надо отменить
	pageNavigate(url) {
		if (url.startsWith(FRAME_BASE)) {
			if (url === this.expect) return false;
			// Переход внутри страниц браузера, о котором мы не знали: записываем его в историю вкладки
			this.expect = url;
			const display = fromFrameUrl(url);
			this.entries.splice(this.index + 1);
			this.entries.push({ url: display, title: '' });
			this.index = this.entries.length - 1;
			this.loading = true;
			this.title = '';
			this.emit('did-start-navigation', { url: display, isMainFrame: true, isSameDocument: false, frame: null });
			this.emit('did-start-loading');
			return false;
		}
		if (/^(javascript|about|blob|data):/i.test(url)) return false;
		setImmediate(() => this.loadURL(url));
		return true;
	}

	// Рамка загрузилась (сообщение из её прелоада)
	loaded(frame, title) {
		this.frame = frame;
		const display = fromFrameUrl(frame.url);
		const cur = this.entries[this.index];
		if (cur) cur.url = display;
		this.expect = frame.url;
		this.loading = false;
		this.title = String(title || '');
		if (cur) cur.title = this.title;
		this.emit('did-navigate', {}, display, 200, 'OK');
		this.emit('dom-ready');
		if (this.title) this.emit('page-title-updated', {}, this.title, false);
		this.emit('did-finish-load');
		this.emit('did-stop-loading');
		for (const w of this.waiters.splice(0)) w();
	}

	titled(title) {
		this.title = String(title || '');
		const cur = this.entries[this.index];
		if (cur) cur.title = this.title;
		this.emit('page-title-updated', {}, this.title, false);
	}

	focus() { this.host.focus(this); }

	send(channel, ...args) {
		if (!this.frame) return;
		try {
			if (!this.frame.isDestroyed()) this.frame.send(channel, ...args);
		} catch (e) { /* рамка уже ушла */ }
	}

	executeJavaScript(code, userGesture) {
		if (!this.frame || this.frame.isDestroyed()) return Promise.reject(new Error('Страница ещё не загружена'));
		return this.frame.executeJavaScript(String(code), !!userGesture);
	}

	insertCSS(css) {
		return this.executeJavaScript('(() => { const s = document.createElement("style"); s.textContent = ' + JSON.stringify(String(css)) + '; document.documentElement.append(s); return ""; })()');
	}

	getZoomLevel() { return this.zoomLevel; }
	setZoomLevel(level) {
		this.zoomLevel = Number(level) || 0;
		this.host.send({ op: 'zoom', id: this.id, zoom: this.host.cssZoom(this.zoomLevel) });
	}
	// Масштаб интерфейса поменялся: рамке нужен новый пересчёт
	refreshZoom() { this.setZoomLevel(this.zoomLevel); }

	findInPage(text, opts = {}) {
		const requestId = (this.findSeq = (this.findSeq || 0) + 1);
		this.executeJavaScript('(' + FIND_JS + ')(' + JSON.stringify(String(text)) + ', ' + (opts.forward !== false) + ', ' + (opts.findNext !== false) + ')')
			.then((r) => this.emit('found-in-page', {}, { requestId, activeMatchOrdinal: r.active, matches: r.total, finalUpdate: true }))
			.catch(() => {});
		return requestId;
	}
	stopFindInPage() { this.executeJavaScript(FIND_CLEAR_JS).catch(() => {}); }

	// Инструменты разработчика и прочее — у окна панели: рамка видна в нём как обычный фрейм
	openDevTools(opts) { this.host.toolbar().openDevTools(opts || { mode: 'detach' }); }
	closeDevTools() { this.host.toolbar().closeDevTools(); }
	isDevToolsOpened() { return this.host.toolbar().isDevToolsOpened(); }
	inspectElement(x, y) { this.host.toolbar().inspectElement(x, y); }
	copyImageAt(x, y) { this.host.toolbar().copyImageAt(x, y); }
	downloadURL(url) { this.host.toolbar().downloadURL(url); }

	printToPDF(opts) {
		if (!this.frame || this.frame.isDestroyed()) return Promise.reject(new Error('Страница ещё не загружена'));
		return this.frame.printToPDF(opts || {});
	}
	print(opts, cb) { this.host.print(this, opts, cb); }

	// Снимок видимой части: область страницы в окне панели
	async capturePage() {
		const tb = this.host.toolbar();
		const r = this.host.rect();
		const dbg = tb.debugger;
		const attached = dbg.isAttached();
		try {
			if (!attached) dbg.attach('1.3');
			const clip = { x: r.x, y: r.y, width: Math.max(1, r.width), height: Math.max(1, r.height), scale: 1 };
			// У скрытого окна готового кадра может не быть: сначала просим отрисовать заново
			const shot = await dbg.sendCommand('Page.captureScreenshot', { format: 'png', fromSurface: false, clip }).catch(() => dbg.sendCommand('Page.captureScreenshot', { format: 'png', clip }));
			return nativeImage.createFromBuffer(Buffer.from(shot.data, 'base64'));
		} finally {
			if (!attached) {
				try {
					dbg.detach();
				} catch (e) { /* уже отключён */ }
			}
		}
	}

	close() {
		if (this.destroyed) return;
		this.destroyed = true;
		this.host.send({ op: 'close', id: this.id });
		this.frame = null;
		for (const w of this.waiters.splice(0)) w();
		this.emit('destroyed');
	}
}

class VirtualView {
	constructor(host) {
		this.virtual = true;
		this.host = host;
		this.webContents = new VirtualContents(host);
		this.visible = false;
	}
	// Все рамки лежат в одной области окна панели: её положение общее
	setBounds() { this.host.bounds(); }
	setVisible(v) {
		v = !!v;
		if (v === this.visible) return;
		this.visible = v;
		if (!this.webContents.destroyed) this.host.send({ op: v ? 'show' : 'hide', id: this.webContents.id });
	}
	setBackgroundColor() {}
}

module.exports = { VirtualView, isVirtualUrl, toFrameUrl, fromFrameUrl, FRAME_BASE };
