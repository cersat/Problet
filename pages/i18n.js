// Английская локализация Problet. Исходные строки в коде русские; здесь они переводятся по словарю из i18n-en.js.
// Строки с подстановками записаны шаблонами: {} — любая вставка (в переводе можно {1}, {2}, если порядок другой).
// Работает и в главном процессе (require), и на внутренних страницах и панелях Problet (script). Сайты не затрагиваются.
(function (root) {
	const CY = /[А-Яа-яЁё]/;
	const PAIRS = typeof module !== 'undefined' && module.exports ? require('./i18n-en.js') : root.PROBLET_EN || [];

	const exact = new Map();
	const patterns = [];
	const esc = (s) => s.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
	for (const [ru, en] of PAIRS) {
		if (ru.includes('{}')) {
			const parts = ru.split('{}');
			const re = new RegExp('^' + parts.map((p) => esc(p).replace(/\s+/g, '\\s+')).join('([\\s\\S]*?)') + '$');
			patterns.push({ re, en, fixed: parts.join('').length });
		} else exact.set(ru.replace(/\s+/g, ' ').trim(), en.trim());
	}
	patterns.sort((a, b) => b.fixed - a.fixed); // сначала самые определённые шаблоны

	function fill(en, m) {
		return en.replace(/\{(\d*)\}/g, (_x, n) => {
			const idx = n ? Number(n) : (fill.i = (fill.i || 0) + 1);
			return translate(m[idx] === undefined ? '' : m[idx]);
		});
	}
	// Точное совпадение; «menu|Обновить» — вариант слова для меню
	function exactOf(s, ctx) {
		const key = s.replace(/\s+/g, ' ');
		if (ctx && exact.has(ctx + '|' + key)) return exact.get(ctx + '|' + key);
		return exact.has(key) ? exact.get(key) : null;
	}
	function patternOf(s) {
		for (const p of patterns) {
			const m = p.re.exec(s);
			if (m) { fill.i = 0; return fill(p.en, m); }
		}
		return null;
	}
	const core = (s, ctx) => {
		const r = exactOf(s, ctx);
		return r !== null ? r : patternOf(s);
	};
	// Предложение за предложением и строка за строкой: «Первое. Второе.»
	function pieces(s) {
		for (const sep of [/\n/, /(?<=[.!?…:])\s+/, /,\s+/]) {
			const parts = s.split(sep);
			if (parts.length < 2) continue;
			const seps = s.match(new RegExp(sep.source, 'g')) || [];
			let ok = false;
			const out = parts.map((p) => {
				if (!CY.test(p)) return p;
				const r = translate(p);
				if (CY.test(r)) return p;
				ok = true;
				return r;
			});
			if (ok) return out.reduce((acc, p, i) => acc + p + (seps[i] === undefined ? '' : seps[i]), '');
		}
		return null;
	}
	function translate(s, ctx) {
		if (typeof s !== 'string' || !CY.test(s)) return s;
		const lead = /^\s*/.exec(s)[0];
		const trail = /\s*$/.exec(s)[0];
		const body = s.slice(lead.length, s.length - trail.length);
		if (!body) return s;
		let r = exactOf(body, ctx);
		if (r === null && /[.:]$/.test(body)) { // «Хранить свои данные.» — то же без точки
			const x = exactOf(body.slice(0, -1), ctx);
			if (x !== null) r = x + body.slice(-1);
		}
		if (r === null) r = patternOf(body);
		if (r === null) { // «Назад (Alt+←)» — подпись и сочетание клавиш отдельно
			const m = /^([\s\S]*?)(\s*)(\([^()]*\))$/.exec(body);
			if (m && CY.test(m[1])) {
				const x = core(m[1], ctx);
				if (x !== null) r = x + m[2] + (core(m[3], ctx) || (CY.test(m[3]) ? '(' + translate(m[3].slice(1, -1), ctx) + ')' : m[3]));
			}
		}
		if (r === null) r = pieces(body);
		return r === null ? s : lead + r + trail;
	}
	// Тексты, которые ещё остались по-русски (для проверки полноты словаря)
	const missing = (s) => CY.test(translate(s));

	const api = { translate, missing, exact, patterns };
	if (typeof module !== 'undefined' && module.exports) {
		module.exports = api;
		return;
	}

	// ---- Страница: переводим текст и подписи, пока в <html data-lang> стоит «en» ----
	const doc = root.document;
	if (!doc) return;
	const ATTRS = ['placeholder', 'title', 'aria-label', 'alt', 'label'];
	const SKIP_TAG = new Set(['SCRIPT', 'STYLE', 'TEXTAREA']);
	const state = new WeakMap(); // узел или элемент -> что было по-русски и что мы поставили
	const known = new Set(); // слабые ссылки на всё переведённое, чтобы вернуть русский
	let lang = 'ru';
	let observer = null;

	const skipped = (el) => {
		for (let e = el; e && e.nodeType === 1; e = e.parentNode) {
			if (SKIP_TAG.has(e.tagName)) return true;
			const t = e.getAttribute('translate');
			if (t) return t === 'no'; // translate="no" — чужие данные (названия закладок, адреса, имена); "yes" внутри возвращает перевод
		}
		return false;
	};
	function text(node) {
		if (!CY.test(node.data) || skipped(node.parentNode)) return;
		const st = state.get(node);
		if (st && st.en === node.data) return;
		const en = translate(node.data);
		if (en === node.data) return;
		state.set(node, { ru: node.data, en });
		known.add(new WeakRef(node));
		node.data = en;
	}
	function attrs(el) {
		if (skipped(el)) return;
		for (const a of ATTRS) {
			const v = el.getAttribute(a);
			if (!v || !CY.test(v)) continue;
			const key = '\0' + a;
			const st = (state.get(el) || {})[key];
			if (st && st.en === v) continue;
			const en = translate(v);
			if (en === v) continue;
			const rec = state.get(el) || {};
			rec[key] = { ru: v, en };
			state.set(el, rec);
			known.add(new WeakRef(el));
			el.setAttribute(a, en);
		}
		if (el.tagName === 'INPUT' && /^(button|submit|reset)$/.test(el.type) && CY.test(el.value)) el.value = translate(el.value);
	}
	// Абзац с разметкой внутри (<code>, <b>) переводим целиком: порядок слов в языках разный. Отмечается атрибутом data-html
	function html(el) {
		const st = state.get(el) || {};
		const cur = el.innerHTML;
		if (st['\0html'] && st['\0html'].en === cur) return;
		const key = cur.replace(/\s+/g, ' ').trim();
		const en = exact.get(key);
		if (en === undefined) return;
		st['\0html'] = { ru: cur, en };
		state.set(el, st);
		known.add(new WeakRef(el));
		el.innerHTML = en;
	}
	function walk(node) {
		if (node.nodeType === 3) return text(node);
		if (node.nodeType !== 1 && node.nodeType !== 9 && node.nodeType !== 11) return;
		if (node.nodeType === 1) {
			attrs(node);
			if (node.hasAttribute('data-html') && !skipped(node)) return html(node);
		}
		for (let c = node.firstChild; c; c = c.nextSibling) walk(c);
	}
	function restore() {
		for (const ref of known) {
			const n = ref.deref();
			if (!n) continue;
			const st = state.get(n);
			if (!st) continue;
			if (n.nodeType === 3) {
				if (st.en === n.data) n.data = st.ru;
			} else {
				for (const [k, v] of Object.entries(st)) {
					if (k === '\0html') {
						if (n.innerHTML === v.en) n.innerHTML = v.ru;
					} else if (n.getAttribute(k.slice(1)) === v.en) n.setAttribute(k.slice(1), v.ru);
				}
			}
			state.delete(n);
		}
		known.clear();
	}
	function start() {
		if (observer || !doc.documentElement) return;
		observer = new MutationObserver((list) => {
			if (lang !== 'en') return;
			for (const m of list) {
				if (m.type === 'characterData') text(m.target);
				else if (m.type === 'attributes') attrs(m.target);
				else for (const n of m.addedNodes) walk(n);
			}
		});
		observer.observe(doc, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
	}
	function apply() {
		const next = doc.documentElement && doc.documentElement.dataset.lang === 'en' ? 'en' : 'ru';
		if (next === lang && observer) return;
		const was = lang;
		lang = next;
		start();
		if (lang === 'en') {
			doc.documentElement.lang = 'en';
			walk(doc);
		} else if (was === 'en') {
			doc.documentElement.lang = 'ru';
			restore();
		}
	}
	apply();
	if (doc.documentElement) new MutationObserver(apply).observe(doc.documentElement, { attributes: true, attributeFilter: ['data-lang'] });
	doc.addEventListener('DOMContentLoaded', apply);
	root.probletLocale = () => (lang === 'en' ? 'en-GB' : 'ru-RU'); // даты и числа; en-GB — 24-часовое время
	root.probletTr = (s) => (lang === 'en' ? translate(s) : s); // для страниц: перевести строку вручную
}(typeof self !== 'undefined' ? self : globalThis));
