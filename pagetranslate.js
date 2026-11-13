// Автоперевод страниц сайтов через Google Переводчик. Текст страницы собирается в изолированном мире, уходит на translate.googleapis.com, перевод ставится на место
const { net } = require('electron');

const WORLD = 1004;
const URL_API = 'https://translate.googleapis.com/translate_a/t?client=gtx&sl=auto&format=text&tl=';
const POLL_MS = 2000;
const CHUNK_ITEMS = 60;
const CHUNK_CHARS = 4500;

const SCRIPT = `(() => {
	if (window.__ptr) return window.__ptr;
	const SKIP = /^(SCRIPT|STYLE|NOSCRIPT|CODE|PRE|TEXTAREA|KBD|SAMP|SVG|CANVAS|IFRAME|OBJECT|SELECT)$/;
	const ATTRS = ['placeholder', 'title', 'alt'];
	const ours = new WeakMap(); // узел или элемент -> то, что поставили мы
	const originals = [];
	let pending = [];
	const skipped = (el) => {
		for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
			if (SKIP.test(e.tagName) || e.isContentEditable || e.getAttribute('translate') === 'no' || e.classList.contains('notranslate')) return true;
		}
		return false;
	};
	const worth = (s) => /\\p{L}/u.test(s) && s.trim().length > 0;
	const collect = () => {
		pending = [];
		const out = [];
		if (!document.body) return out;
		const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
		for (let n = w.nextNode(); n; n = w.nextNode()) {
			if (n.nodeType === 3) {
				if (ours.get(n) === n.nodeValue || !worth(n.nodeValue) || skipped(n.parentElement)) continue;
				const m = /^(\\s*)([\\s\\S]*?)(\\s*)$/.exec(n.nodeValue);
				pending.push({ node: n, lead: m[1], trail: m[3], orig: n.nodeValue });
				out.push(m[2]);
			} else if (n.nodeType === 1) {
				if (SKIP.test(n.tagName) && n.tagName !== 'SELECT') continue;
				for (const a of ATTRS) {
					const v = n.getAttribute(a);
					if (!v || !worth(v) || ours.get(n) === a + '\\u0000' + v || skipped(n)) continue;
					pending.push({ node: n, attr: a, lead: '', trail: '', orig: v });
					out.push(v);
				}
			}
		}
		return out;
	};
	const apply = (list) => {
		pending.forEach((p, i) => {
			const t = list[i];
			if (typeof t !== 'string' || !t) return;
			if (p.attr) {
				if (!p.node.isConnected || p.node.getAttribute(p.attr) !== p.orig) return;
				p.node.setAttribute(p.attr, t);
				ours.set(p.node, p.attr + '\\u0000' + t);
				originals.push({ node: p.node, attr: p.attr, orig: p.orig, now: t });
			} else {
				if (p.node.nodeValue !== p.orig) return;
				const v = p.lead + t + p.trail;
				p.node.nodeValue = v;
				ours.set(p.node, v);
				originals.push({ node: p.node, orig: p.orig, now: v });
			}
		});
		pending = [];
	};
	const restore = () => {
		for (const o of originals) {
			if (o.attr) { if (o.node.getAttribute(o.attr) === o.now) o.node.setAttribute(o.attr, o.orig); }
			else if (o.node.nodeValue === o.now) o.node.nodeValue = o.orig;
		}
		originals.length = 0;
		pending = [];
	};
	return (window.__ptr = { collect, apply, restore });
})()`;

const run = (wc, code) => wc.executeJavaScriptInIsolatedWorld(WORLD, [{ code: SCRIPT + '.' + code }]);

async function post(texts, tl) {
	const body = new URLSearchParams();
	texts.forEach((t) => body.append('q', t));
	const res = await net.fetch(URL_API + encodeURIComponent(tl), { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: body.toString() });
	if (!res.ok) throw new Error('Google Переводчик ответил кодом ' + res.status);
	let data = await res.json();
	if (texts.length === 1 && typeof data[0] === 'string') data = [data];
	return texts.map((_, i) => {
		const r = data[i];
		return Array.isArray(r) ? { text: String(r[0] || ''), src: String(r[1] || '') } : { text: typeof r === 'string' ? r : '', src: '' };
	});
}

// Возвращает [{text, src}] в том же порядке; куски идут по три параллельно
async function translateAll(texts, tl) {
	const chunks = [];
	let cur = [];
	let chars = 0;
	texts.forEach((t, i) => {
		if (cur.length && (cur.length >= CHUNK_ITEMS || chars + t.length > CHUNK_CHARS)) {
			chunks.push(cur);
			cur = [];
			chars = 0;
		}
		cur.push(i);
		chars += t.length;
	});
	if (cur.length) chunks.push(cur);
	const out = new Array(texts.length);
	let next = 0;
	const worker = async () => {
		while (next < chunks.length) {
			const idx = chunks[next++];
			const res = await post(idx.map((i) => texts[i].slice(0, CHUNK_CHARS)), tl);
			idx.forEach((i, k) => { out[i] = res[k]; });
		}
	};
	await Promise.all([worker(), worker(), worker()]);
	return out;
}

const norm = (c) => String(c || '').toLowerCase().split('-')[0];
const translatable = (url) => /^(https?|file):/i.test(url || '');

// Одна вкладка: tab.translated — идёт ли перевод; tab.ptState хранит таймер и язык
function create({ onChange, log }) {
	const stop = (tab, restore) => {
		const st = tab.ptState;
		if (st && st.timer) clearInterval(st.timer);
		tab.ptState = null;
		const was = tab.translated;
		tab.translated = false;
		if (restore && was) {
			const wc = tab.view.webContents;
			if (!wc.isDestroyed()) run(wc, 'restore()').catch(() => {});
		}
		if (was) onChange(tab);
	};

	const pass = async (tab, st, first) => {
		const wc = tab.view.webContents;
		if (st.busy || wc.isDestroyed() || tab.ptState !== st) return;
		st.busy = true;
		try {
			const texts = await run(wc, 'collect()');
			if (!texts || !texts.length) return;
			const res = await translateAll(texts, st.tl);
			if (tab.ptState !== st || wc.isDestroyed()) return;
			if (first) {
				// страница уже на нужном языке — переводить нечего
				const langs = res.map((r) => norm(r && r.src)).filter(Boolean);
				const same = langs.filter((l) => l === norm(st.tl)).length;
				if (langs.length && same / langs.length > 0.7) {
					stop(tab, false);
					return;
				}
			}
			await run(wc, 'apply(' + JSON.stringify(res.map((r) => (r && r.text) || '')) + ')');
		} catch (e) {
			log('перевод страницы', e);
			if (first) stop(tab, true);
		} finally {
			st.busy = false;
		}
	};

	const start = (tab, tl) => {
		const wc = tab.view.webContents;
		if (!translatable(wc.getURL())) return false;
		stop(tab, true);
		const st = { tl, busy: false, timer: null };
		tab.ptState = st;
		tab.translated = true;
		onChange(tab);
		pass(tab, st, true);
		st.timer = setInterval(() => pass(tab, st, false), POLL_MS);
		return true;
	};

	return {
		start,
		stop: (tab) => stop(tab, true),
		// страница сменилась: DOM новый, восстанавливать нечего
		reset: (tab) => stop(tab, false),
		toggle: (tab, tl) => (tab.translated ? stop(tab, true) : start(tab, tl)),
		translatable,
	};
}

module.exports = { create, translatable };
