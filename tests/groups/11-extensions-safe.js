// Расширения Chrome и безопасный режим: установка распакованного расширения, его кнопка на панели, скрипт на странице;
// безопасный режим без перезапуска выключает расширения, а после выхода кнопка возвращается на своё место
const fs = require('fs');
const path = require('path');

module.exports = {
	title: 'Расширения и безопасный режим: установка, кнопка, скрипт, место кнопки после безопасного режима',
	gui: true,
	async run(t) {
		const base = t.server.base;
		const ext = path.join(t.dir, 'ext');
		fs.mkdirSync(ext, { recursive: true });
		fs.writeFileSync(path.join(ext, 'manifest.json'), JSON.stringify({
			manifest_version: 3, name: 'Тестовое расширение', version: '1.0',
			action: { default_title: 'Тест' },
			content_scripts: [{ matches: ['http://127.0.0.1/*'], js: ['c.js'], run_at: 'document_end' }],
		}));
		fs.writeFileSync(path.join(ext, 'c.js'), 'document.documentElement.dataset.testext = "1";');
		const b = await t.browser({ env: { ...t.env, PROBLET_TEST_EXT_DIR: ext } });
		await b.go('problet://settings/', 1200);
		const add = await b.fe(`w.problet.extAdd()`).catch((e) => ({ error: e.message }));
		t.check('расширение ставится из папки', add && /добавлено/.test(add.message || ''), add);
		const list = await b.fe(`w.problet.extList()`);
		t.check('расширение в списке', JSON.stringify(list).includes('Тестовое расширение'), list);
		await t.sleep(1500);
		let layout = (await b.fe(`w.problet.getSettings()`)).settings.btnLayout;
		const id = [...layout.toolbar, ...layout.bmbar, ...layout.tabs, ...layout.extra].find((x) => /^x:/.test(x));
		t.check('кнопка расширения появилась на панели', !!id, layout);

		await b.go(base + '/a', 1500);
		let pg = await b.page((u) => u === base + '/a');
		t.check('скрипт расширения работает на странице', (await pg.ev(`document.documentElement.dataset.testext`)) === '1');

		// Ставим кнопку на панель закладок вторым элементом и проходим через безопасный режим
		await b.go('problet://settings/', 1000);
		const L = JSON.parse(JSON.stringify(layout));
		for (const k of Object.keys(L)) L[k] = L[k].filter((x) => x !== id);
		L.bmbar.splice(1, 0, id);
		await b.fe(`w.problet.setSettings({ btnLayout: ${JSON.stringify(L)} })`);
		const before = (await b.fe(`w.problet.getSettings()`)).settings.btnLayout.bmbar.join(',');
		await b.fe(`w.problet.setSafeMode(true)`);
		await t.sleep(1500);
		t.check('безопасный режим включился без перезапуска', await b.tb.ev(`!document.getElementById('safemode').classList.contains('hidden')`));
		await b.go(base + '/b', 1500);
		pg = await b.page((u) => u === base + '/b');
		t.check('в безопасном режиме расширение не работает', (await pg.ev(`document.documentElement.dataset.testext || ''`)) === '');
		await b.go('problet://settings/', 1000);
		await b.fe(`w.problet.setSafeMode(false)`);
		await t.sleep(4000);
		const after = (await b.fe(`w.problet.getSettings()`)).settings.btnLayout.bmbar.join(',');
		t.check('после безопасного режима кнопка на прежнем месте', before === after, { before, after });
		await b.go(base + '/a?2', 1500);
		pg = await b.page((u) => u === base + '/a?2');
		t.check('после безопасного режима расширение снова работает', (await pg.ev(`document.documentElement.dataset.testext`)) === '1');
		t.check('без ошибок в консоли', b.errors.length === 0, b.errors.slice(0, 5));
	},
};
