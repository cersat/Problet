// Внутренние страницы: каждая открывается без ошибок в консоли, на русском и на английском;
// в английском интерфейсе на странице не остаётся русского текста (кроме данных)
module.exports = {
	title: 'Внутренние страницы: открываются без ошибок, английский перевод полный',
	gui: true,
	async run(t) {
		// Страницы, которые открывают вручную (панели и служебные открываются сами по ходу дела)
		const PAGES = ['newtab', 'settings', 'bookmarks', 'history', 'downloads', 'passwords', 'version', 'spaces', 'blocklist', 'files', 'svgedit', 'offline', 'game', 'chars'];
		// Текст, который по смыслу остаётся русским: данные пользователя, названия, примеры
		const DATA_OK = (txt) => /^(Русский|Українська|Auto \/ Авто)$/.test(txt); // названия языков пишутся на самих языках
		for (const lang of ['ru', 'en']) {
			const b = await t.browser({ profile: 'p-' + lang, lang });
			for (const name of PAGES) {
				const before = b.errors.length;
				await b.go('problet://' + name + '/', 1200);
				const s = await b.st();
				const info = await b.fe(`({ title: d.title, text: (d.body && d.body.innerText || '').trim().length })`).catch((e) => ({ error: String(e) }));
				t.check(lang + ': problet://' + name + ' открылась', s.virtual && info.title && info.text > 0, { s, info });
				const errs = b.errors.slice(before);
				t.check(lang + ': problet://' + name + ' без ошибок в консоли', errs.length === 0, errs.slice(0, 3));
				if (lang === 'en') {
					// Все видимые тексты, подписи и подсказки
					const left = await b.fe(`(() => {
						const out = [];
						const walk = d.createTreeWalker(d.body, NodeFilter.SHOW_TEXT);
						let n;
						while ((n = walk.nextNode())) {
							const el = n.parentElement;
							if (!el || el.closest('script,style,textarea,[contenteditable],[data-noi18n],.mz-hud,#grid,.chars')) continue;
							const txt = n.textContent.trim();
							if (/[А-Яа-яЁё]/.test(txt)) out.push(txt.slice(0, 80));
						}
						for (const el of d.querySelectorAll('[placeholder],[title],[aria-label]')) for (const a of ['placeholder', 'title', 'aria-label']) {
							const v = el.getAttribute(a);
							if (v && /[А-Яа-яЁё]/.test(v)) out.push(a + ': ' + v.slice(0, 80));
						}
						return out;
					})()`).catch((e) => [String(e)]);
					const really = left.filter((x) => !DATA_OK(x));
					t.check('en: problet://' + name + ' без русского текста', really.length === 0, really.slice(0, 8));
				}
			}
			// Панель инструментов тоже переведена
			if (lang === 'en') {
				const tb = await b.tb.ev(`[...document.querySelectorAll('[title],[placeholder],[aria-label]')].map(e => e.getAttribute('title') || e.getAttribute('placeholder') || e.getAttribute('aria-label')).filter(v => /[А-Яа-яЁё]/.test(v))`);
				t.check('en: подсказки на панели инструментов переведены', tb.length === 0, tb.slice(0, 8));
			}
		}
	},
};
