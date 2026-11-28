// Вкладки и переходы: старт, адресная строка (адрес, поиск, путь к файлу, HTML-код), назад/вперёд/обновить,
// красивый адрес (раскодирование %XX), несколько вкладок, закрытие
const fs = require('fs');
const path = require('path');

module.exports = {
	title: 'Вкладки и переходы: адресная строка, поиск, файлы, HTML-код, назад/вперёд, вкладки',
	gui: true,
	async run(t) {
		const base = t.server.base;
		const b = await t.browser({ settings: { engine: 'custom', customTemplate: base + '/a?q=%s' } });
		let s = await b.st();
		t.check('при старте одна вкладка с новой вкладкой', s.tabs.length === 1 && /problet:\/\/(newtab|ui\/newtab)/.test(s.src || ''), s);

		await b.go(base + '/a');
		s = await b.st();
		t.check('переход по адресу', s.active === 'A' && s.addr.includes('127.0.0.1') && s.addr.includes('/a'), s);
		await b.go(base + '/');
		// Настоящий щелчок по ссылке: переходы без действия человека Chromium пропускает при «назад»
		const pa = await b.page((u) => u === base + '/');
		const [lx, ly] = await pa.ev(`(() => { const r = document.getElementById('link').getBoundingClientRect(); return [r.x + 5, r.y + 5]; })()`);
		for (const type of ['mousePressed', 'mouseReleased']) await pa.send('Input.dispatchMouseEvent', { type, x: lx, y: ly, button: 'left', clickCount: 1 });
		await t.sleep(1200);
		s = await b.st();
		t.check('переход по ссылке внутри страницы', s.active === 'B' && s.back, s);
		await b.tb.ev('problet.back()');
		await t.sleep(1000);
		s = await b.st();
		t.check('назад', s.active === 'Сайт' && s.fwd, s);
		await b.tb.ev('problet.forward()');
		await t.sleep(1000);
		s = await b.st();
		t.check('вперёд', s.active === 'B', s);
		const hitsBefore = t.server.hits.filter((h) => h === '/b').length;
		await b.tb.ev('problet.reload()');
		await t.sleep(1000);
		t.check('обновить — страница запрошена снова', t.server.hits.filter((h) => h === '/b').length > hitsBefore);

		await b.go('кот и пёс');
		s = await b.st();
		t.check('текст без адреса уходит в поиск', s.active === 'A' && t.server.hits.some((h) => h.startsWith('/a?q=') && decodeURIComponent(h.slice(5)) === 'кот и пёс'), { s, hits: t.server.hits.slice(-3) });
		t.check('в адресной строке поиск раскодирован', s.addr.includes('кот') && !s.addr.includes('%D0'), s.addr);

		await b.go(base + '/папка%20с%20пробелом%2Fи%2Fслэшем?x=1%262');
		s = await b.st();
		t.check('красивый адрес: кириллица и пробелы раскодированы, %2F и %26 остались', s.addr.includes('папка с пробелом') && s.addr.includes('%2F') && s.addr.includes('%26'), s.addr);

		const file = path.join(t.dir, 'локальная страница.html');
		fs.writeFileSync(file, '<!doctype html><meta charset="utf-8"><title>Файл</title><p>с диска</p>');
		await b.go(file);
		s = await b.st();
		t.check('путь к файлу открывается как file://', s.active === 'Файл', s);

		await b.go('<title>Код</title><p id="x">из адресной строки</p>');
		s = await b.st();
		t.check('HTML-код в адресной строке открывается страницей', s.active === 'Код', s);

		// Вкладки
		await b.newTab(base + '/a');
		await b.newTab(base + '/b');
		s = await b.st();
		t.check('три вкладки, активна последняя', s.tabs.length === 3 && s.active === 'B', s.tabs);
		const ids = await b.tb.ev(`[...document.querySelectorAll('#tabs .tab')].map(e => Number(e.dataset.id))`);
		await b.tb.ev(`problet.activateTab(${ids[0]})`);
		await t.sleep(600);
		s = await b.st();
		t.check('переключение вкладок', s.active === 'Код', s);
		await b.tb.ev(`problet.closeTab(${ids[1]})`);
		await t.sleep(600);
		s = await b.st();
		t.check('закрытие вкладки', s.tabs.length === 2 && !s.tabs.includes('A'), s.tabs);

		await b.go('problet://нет-такой-страницы/');
		s = await b.st();
		const maze = await b.fe(`!!d.querySelector('.mz-canvas, canvas')`).catch(() => false);
		t.check('неизвестная внутренняя страница — 404 с лабиринтом', s.virtual && maze, s);
		await b.go(base + '/нет');
		s = await b.st();
		t.check('404 сайта показывается как есть', s.active === 'Нет', s);
		await b.go('http://127.0.0.1:1/');
		s = await b.st();
		t.check('недоступный сайт — страница ошибки', /Ошибка|Error/.test(s.active), s);
		t.check('адрес остаётся в строке после ошибки загрузки', (await b.st()).addr.includes('127.0.0.1:1'), await b.st());
		const errT = (await b.targets()).find((x) => x.type === 'page' && x.url.startsWith('data:text/html'));
		const errC = errT && (await require('../lib/browser').connect(errT));
		const errMaze = errC ? await errC.ev(`!!document.querySelector('canvas, .mz-canvas')`) : false;
		if (errC) errC.close();
		t.check('на странице ошибки есть лабиринт', errMaze === true, errMaze);

		// Новая вкладка: блоки включаются и выключаются настройками
		await b.fe(`w.problet.setSettings({ ntTitle: false, ntSearch: false })`).catch(() => {});
		await b.go('problet://settings/', 600);
		await b.fe(`w.problet.setSettings({ ntTitle: false, ntSearch: false })`);
		await b.go('problet://newtab/', 800);
		const nt = await b.fe(`({ title: !d.getElementById('title').offsetHeight, form: !d.getElementById('search-form').offsetHeight })`);
		t.check('новая вкладка без названия и без поля поиска', nt.title && nt.form, nt);
		await b.go('problet://settings/', 600);
		await b.fe(`w.problet.setSettings({ ntTitle: true, ntSearch: true })`);
		await b.go('problet://newtab/', 800);
		const nt2 = await b.fe(`({ title: !!d.getElementById('title').offsetHeight, form: !!d.getElementById('search-form').offsetHeight })`);
		t.check('и снова показывает их по включению', nt2.title && nt2.form, nt2);
		t.check('во внутренних страницах нет ошибок в консоли', b.errors.length === 0, b.errors.slice(0, 5));
	},
};
