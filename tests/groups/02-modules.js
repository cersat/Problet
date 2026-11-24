// Модули главного процесса по отдельности, без окна: настройки, закладки, поиск, калькулятор, CSV паролей, хранилище паролей,
// версии обновлений, подпись браузера (User-Agent)
const fs = require('fs');
const path = require('path');
const stub = require('../lib/stub');

module.exports = {
	title: 'Модули без окна: настройки, закладки, поиск, калькулятор, пароли, обновления, User-Agent',
	async run(t) {
		stub.install(path.join(t.dir, 'stub'));
		const refuse = (fn) => {
			try {
				fn();
				return false;
			} catch (e) {
				return true;
			}
		};

		// ---------- Настройки ----------
		const dataDir = path.join(t.dir, 'store');
		fs.mkdirSync(dataDir, { recursive: true });
		let store = stub.fresh('store.js');
		store.init(dataDir);
		const s0 = store.getSettings();
		t.check('настройки по умолчанию: поиск DuckDuckGo, язык — как в системе', s0.engine === 'duckduckgo' && s0.language === 'auto', { engine: s0.engine, language: s0.language });
		t.check('выравнивание вкладок по умолчанию — внизу', s0.tabsAlign === 'bottom', s0.tabsAlign);
		t.check('неизвестный поисковик отклоняется', refuse(() => store.setSettings({ engine: 'нет-такого' })));
		t.check('кривой шаблон поиска отклоняется', refuse(() => store.setSettings({ engine: 'custom', customTemplate: 'ftp://x' })));
		store.setSettings({ engine: 'custom', customTemplate: 'https://example.com/?q=%s' });
		t.check('свой шаблон поиска', store.searchUrl('кот и пёс') === 'https://example.com/?q=' + encodeURIComponent('кот и пёс'), store.searchUrl('кот и пёс'));
		store.setSettings({ tabsAlign: 'center', language: 'en' });
		t.check('выбор из списка сохраняется', store.getSettings().tabsAlign === 'center' && store.getSettings().language === 'en');
		t.check('значение вне списка не принимается', refuse(() => store.setSettings({ tabsAlign: 'вбок' })) && store.getSettings().tabsAlign === 'center');
		store.setSafe(true);
		t.check('безопасный режим подменяет настройки, но не сами сохранённые', store.isSafe() && store.rawSettings().language === 'en');
		store.setSafe(false);

		// ---------- Закладки ----------
		const bm = store.addBookmark({ url: 'https://example.com/', title: 'Пример' });
		t.check('закладка добавляется', !!bm && store.bookmarksState().bookmarks.some((b) => b.url === 'https://example.com/'));
		t.check('закладка с javascript: отклоняется', refuse(() => store.addBookmark({ url: 'javascript:alert(1)', title: 'x' })));
		const folder = store.addFolder('Папка');
		t.check('папка создаётся', !!folder && store.bookmarksState().folders.some((f) => f.name === 'Папка'));
		store.removeBookmark(store.bookmarksState().bookmarks.find((b) => b.url === 'https://example.com/').id);
		t.check('закладка удаляется', !store.bookmarksState().bookmarks.some((b) => b.url === 'https://example.com/'));

		// ---------- Перенос данных ----------
		store.addBookmark({ url: 'https://problet.test/', title: 'Тест' });
		const dump = store.exportData();
		t.check('экспорт содержит настройки и закладки', dump.app === 'problet' && dump.bookmarks.length >= 1 && dump.settings.language === 'en');
		store.flush();
		const other = path.join(t.dir, 'store2');
		fs.mkdirSync(other, { recursive: true });
		store = stub.fresh('store.js');
		store.init(other);
		store.importData(JSON.parse(JSON.stringify(dump)), 'replace');
		t.check('импорт «заменить» переносит закладки и настройки', store.bookmarksState().bookmarks.some((b) => b.url === 'https://problet.test/') && store.getSettings().language === 'en');
		store = stub.fresh('store.js');
		store.init(dataDir);
		t.check('настройки пережили перезапуск модуля', store.getSettings().tabsAlign === 'center' && store.getSettings().engine === 'custom');

		// ---------- Калькулятор в адресной строке ----------
		const calc = stub.fresh('calc.js');
		t.check('калькулятор: 2+2*2 = 6', calc.tryCalc('2+2*2') === '6', calc.tryCalc('2+2*2'));
		t.check('калькулятор: скобки и степень', calc.tryCalc('(1+2)^2') === '9', calc.tryCalc('(1+2)^2'));
		t.check('калькулятор не трогает обычный текст и адреса', calc.tryCalc('кот') === null && calc.tryCalc('example.com') === null && calc.tryCalc('42') === null);

		// ---------- CSV паролей ----------
		const csv = stub.fresh('passcsv.js');
		const rows = [{ origin: 'https://a.test', username: 'я, "кавычки"', password: 'p,a"ss\nword' }];
		const back = csv.parse(csv.toCsv(rows));
		const list = Array.isArray(back) ? back : back.entries || back.rows || [];
		t.check('CSV паролей: запятые, кавычки и переносы переживают туда-обратно', list.length === 1 && list[0].username === rows[0].username && list[0].password === rows[0].password, list);

		// ---------- Хранилище паролей ----------
		const vdir = path.join(t.dir, 'vault');
		fs.mkdirSync(vdir, { recursive: true });
		let vault = stub.fresh('vault.js');
		vault.init(vdir);
		t.check('короткий мастер-пароль не принимается', refuse(() => vault.create('1')));
		vault.create('мастер-пароль-1');
		const id = vault.add({ origin: 'https://site.test', username: 'кот', password: 'секрет' }).id;
		t.check('пароль добавляется и читается', vault.reveal(id) === 'секрет' && vault.forOrigin('https://www.site.test')[0].password === 'секрет');
		vault.add({ origin: 'https://site.test', username: 'кот', password: 'новый' });
		t.check('тот же сайт и логин — обновление, а не дубль', vault.list().length === 1 && vault.reveal(id) === 'новый');
		vault.lock();
		t.check('после запирания пароли недоступны', !vault.isUnlocked() && refuse(() => vault.reveal(id)));
		t.check('чужой мастер-пароль не открывает', refuse(() => vault.unlock('не тот')));
		const raw = fs.readdirSync(vdir).map((f) => fs.readFileSync(path.join(vdir, f), 'utf8')).join('');
		t.check('на диске пароли зашифрованы', !raw.includes('новый') && !raw.includes('site.test'));
		vault = stub.fresh('vault.js');
		vault.init(vdir);
		vault.unlock('мастер-пароль-1');
		t.check('после перезапуска открывается своим паролем', vault.forOrigin('https://site.test')[0].password === 'новый');

		// ---------- Обновления ----------
		const upd = stub.fresh('updater.js');
		t.check('сравнение версий', upd.isNewer('9.3.10', '9.3.9') && !upd.isNewer('9.3.0', '9.3.0') && !upd.isNewer('9.2.9', '9.3.0') && upd.isNewer('10.0.0', '9.99.99'));

		// ---------- Подпись браузера ----------
		const id1 = stub.fresh('identity.js');
		const chrome = id1.build('chrome', '9.3.0');
		const plain = id1.build('problet', '9.3.0', true);
		t.check('User-Agent как у Chrome', /Chrome\/\d+/.test(chrome.userAgent) && /Safari\//.test(chrome.userAgent), chrome.userAgent);
		t.check('для сайтов-определителей User-Agent — только «Problet/версия», бренд только Problet', plain.userAgent === 'Problet/9.3.0' && plain.brands.length === 1 && plain.brands[0].brand === 'Problet', plain);
		t.check('маскировка не прячет систему: она остаётся в platform', plain.platform !== '' && chrome.platform !== '', [plain.platform, chrome.platform]);
		let h = id1.applyHeaders({ 'User-Agent': 'x', 'sec-ch-ua': 'x', 'sec-ch-ua-platform': '"Linux"', 'sec-ch-ua-mobile': '?0' }, plain, false);
		t.check('без «Скрывать метаданные» Sec-CH-UA-Platform не трогается', h['sec-ch-ua'] === '"Problet";v="9"' && h['sec-ch-ua-platform'] === '"Linux"', h);
		// «Скрывать метаданные системы»
		for (const kind of ['chrome', 'problet', 'firefox']) {
			const p = id1.build(kind, '9.3.0', false, true);
			t.check('скрыть систему (' + kind + '): вместо настоящей системы у всех Windows 10 x64', !/Linux|X11|Mac/.test(p.userAgent) && p.userAgent.includes('Windows NT 10.0; Win64; x64') && p.platform === 'Windows' && p.hide, p.userAgent);
		}
		const hp = id1.build('chrome', '9.3.0', false, true);
		h = id1.applyHeaders({ 'User-Agent': 'x', 'sec-ch-ua': 'x', 'sec-ch-ua-platform': '"Linux"', 'sec-ch-ua-platform-version': '"6"', 'sec-ch-ua-mobile': '?0', 'sec-ch-ua-arch': '"x86"', 'sec-ch-ua-bitness': '"64"', 'sec-ch-ua-model': '""', 'sec-ch-ua-full-version-list': 'x' }, hp, false);
		t.check('скрыть систему: Sec-CH-UA-* — одинаковые у всех значения, бренды на месте', h['sec-ch-ua-platform'] === '"Windows"' && h['sec-ch-ua-platform-version'] === '"10.0.0"' && h['sec-ch-ua-arch'] === '"x86"' && h['sec-ch-ua-bitness'] === '"64"' && h['sec-ch-ua-mobile'] === '?0' && /Chromium/.test(h['sec-ch-ua']) && /Chromium/.test(h['sec-ch-ua-full-version-list']), h);
		const pp = id1.pagePayload(hp, false);
		t.check('скрыть систему: странице передаётся признак скрытия', pp.hide === true && pp.platform === 'Windows' && pp.userAgent === hp.userAgent, pp);
	},
};
