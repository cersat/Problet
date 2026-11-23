// Раскладка окна: вкладки в ряду / слева / справа, панель закладок вкл/выкл, выравнивание кнопок на растянутой панели
// вкладок, переставленные кнопки появляются на нужной панели; страница занимает место под панелями
module.exports = {
	title: 'Раскладка: положение вкладок, панель закладок, выравнивание, кнопки по панелям',
	gui: true,
	async run(t) {
		const b = await t.browser();
		await b.go('problet://settings/', 1200);
		const set = async (patch) => {
			await b.fe(`w.problet.setSettings(${JSON.stringify(patch)})`);
			await t.sleep(600);
			return b.tb.ev(`({ ...document.body.dataset, bmbarVisible: !!document.getElementById('bmbar').offsetHeight })`);
		};
		let ds = await set({ tabsPos: 'left' });
		t.check('вкладки слева', ds.tabs === 'left', ds);
		ds = await set({ tabsPos: 'right' });
		t.check('вкладки справа', ds.tabs === 'right', ds);
		ds = await set({ tabsPos: 'row' });
		t.check('вкладки в ряду панелей', ds.tabs === 'top' || ds.tabs === 'bottom', ds);
		ds = await set({ bookmarksBar: false });
		t.check('панель закладок выключается', ds.bm === 'off' && !ds.bmbarVisible, ds);
		ds = await set({ bookmarksBar: true });
		t.check('панель закладок включается', ds.bm !== 'off' && ds.bmbarVisible, ds);
		for (const a of ['center', 'top', 'bottom']) {
			ds = await set({ tabsAlign: a });
			t.check('выравнивание кнопок на панели вкладок: ' + a, ds.tabsAlign === a, ds);
		}
		// Кнопка «История» переезжает на панель закладок
		const layout = (await b.fe(`w.problet.getSettings()`)).settings.btnLayout;
		const L = JSON.parse(JSON.stringify(layout));
		const id = [...L.toolbar].find((x) => x === 'history') || L.toolbar.find((x) => !/^(back|forward|reload|address|x:)/.test(x));
		for (const k of Object.keys(L)) L[k] = L[k].filter((x) => x !== id);
		L.bmbar.unshift(id);
		await set({ btnLayout: L });
		const where = await t.waitFor(() => b.tb.ev(`(() => { const el = document.getElementById('${id}'); return el && el.closest('#bmbar') ? 'bmbar' : ''; })()`), 5000) || await b.tb.ev(`(() => { const el = document.getElementById('${id}'); return el ? el.parentElement.id : 'нет'; })()`);
		t.check('кнопка «' + id + '» переехала на панель закладок', where === 'bmbar', { id, where });
		await set({ btnLayout: layout });
		// Страница не залезает под панели
		await b.go(t.server.base + '/a', 1200);
		const pg = await b.page((u) => u === t.server.base + '/a');
		const vh = await pg.ev('innerHeight');
		const top = await b.tb.ev(`Math.round(document.getElementById('bmbar').getBoundingClientRect().bottom)`);
		t.check('страница не прячется под панелями', vh > 300 && vh + top <= 1000, { vh, top });
		t.check('без ошибок в консоли', b.errors.length === 0, b.errors.slice(0, 5));
	},
};
