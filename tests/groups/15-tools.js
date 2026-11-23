// Инструменты: горячие клавиши (новая/закрыть/вернуть вкладку, поиск на странице, масштаб), пространства,
// скачивания (в выбранную папку, список загрузок), сохранение вкладок для чтения без сети
const fs = require('fs');
const path = require('path');
const { connect } = require('../lib/browser');

module.exports = {
	title: 'Инструменты: горячие клавиши, поиск на странице, масштаб, пространства, скачивания, офлайн',
	gui: true,
	async run(t) {
		const base = t.server.base;
		const dl = path.join(t.dir, 'загрузки');
		fs.mkdirSync(dl, { recursive: true });
		const b = await t.browser({ settings: { askDownload: false, downloadDir: dl } });
		const key = async (combo, ms = 700) => {
			await b.activate();
			b.x('key', '--clearmodifiers', combo);
			await t.sleep(ms);
		};
		const tabs = async () => (await b.st()).tabs;

		// Горячие клавиши вкладок
		await b.go(base + '/find', 1500);
		await key('ctrl+t');
		t.check('Ctrl+T — новая вкладка', (await tabs()).length === 2, await tabs());
		await key('ctrl+w');
		t.check('Ctrl+W — закрыть вкладку', (await tabs()).length === 1, await tabs());
		await key('ctrl+t');
		await key('ctrl+w');
		await b.go(base + '/a', 1200);
		await key('ctrl+t');
		await b.go(base + '/b', 1200);
		await key('ctrl+w');
		await key('ctrl+shift+t', 1500);
		t.check('Ctrl+Shift+T — вернуть закрытую вкладку', (await tabs()).includes('B'), await tabs());

		// Поиск на странице
		await b.go(base + '/find', 1500);
		await key('ctrl+f', 1000);
		const ft = (await b.targets()).find((x) => /find\.html|problet:\/\/find/.test(x.url));
		t.check('Ctrl+F открывает поиск на странице', !!ft, (await b.targets()).map((x) => x.url));
		if (ft) {
			const f = await connect(ft);
			await f.ev(`(() => { const q = document.getElementById('q'); q.value = 'кот'; q.dispatchEvent(new Event('input', { bubbles: true })); })()`);
			await t.sleep(1000);
			const count = await f.ev(`document.getElementById('count').textContent`);
			t.check('поиск находит все совпадения', /3/.test(count), count);
			f.close();
			await key('Escape');
		}

		// Масштаб
		const pg = await b.page((u) => u === base + '/find');
		const z0 = await pg.ev('window.devicePixelRatio');
		await key('ctrl+equal');
		await key('ctrl+equal');
		const z1 = await pg.ev('window.devicePixelRatio');
		await key('ctrl+0');
		const z2 = await pg.ev('window.devicePixelRatio');
		t.check('Ctrl+= увеличивает, Ctrl+0 возвращает масштаб', z1 > z0 && Math.abs(z2 - z0) < 0.01, [z0, z1, z2]);

		// Пространства: новое сразу становится текущим, со своей вкладкой
		await b.go('problet://spaces/', 1200);
		const mainTabs = await tabs();
		await b.fe(`w.problet.spacesAdd('Работа')`).catch(() => null);
		await t.sleep(1500);
		t.check('новое пространство открывается со своими вкладками', (await tabs()).length === 1, await tabs());
		await b.go('problet://spaces/', 1200);
		let sp = await b.fe(`w.problet.spaces()`);
		const work = sp.spaces.find((x) => x.name === 'Работа');
		t.check('пространство добавлено и стало текущим', !!work && sp.current === work.id, sp);
		await b.fe(`w.problet.spacesSwitch('main')`).catch(() => null);
		await t.sleep(1500);
		t.check('возврат в основное пространство — вкладки на месте', JSON.stringify(await tabs()) === JSON.stringify(mainTabs), [await tabs(), mainTabs]);
		await b.go('problet://spaces/', 1200);
		await b.fe(`w.problet.spacesRemove(${JSON.stringify(work && work.id)})`);
		sp = await b.fe(`w.problet.spaces()`);
		t.check('пространство удаляется', !sp.spaces.some((x) => x.name === 'Работа'), sp.spaces);

		// Скачивание
		await b.go(base + '/file.bin', 3000);
		const got = fs.readdirSync(dl);
		t.check('файл скачан в выбранную папку под своим именем', got.includes('загрузка.bin') && fs.statSync(path.join(dl, 'загрузка.bin')).size === 4096, got);
		await b.go('problet://downloads/', 1200);
		const dls = await b.fe(`w.problet.downloads()`);
		t.check('загрузка в списке', JSON.stringify(dls).includes('загрузка.bin'), dls);
		t.check('страница загрузок её показывает', (await b.fe(`d.body.innerText`)).includes('загрузка.bin'));

		// Офлайн
		await b.go(base + '/a', 1500);
		await b.go('problet://offline/', 1000);
		await b.fe(`w.problet.offlineSaveAll()`).catch(() => null);
		await t.sleep(3000);
		const off = await b.fe(`w.problet.offlineList()`);
		t.check('вкладки сохраняются для чтения без сети', JSON.stringify(off).includes(base), off);
		t.check('без ошибок в консоли', b.errors.length === 0, b.errors.slice(0, 5));
	},
};
