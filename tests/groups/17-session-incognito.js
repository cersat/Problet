// Сессия и инкогнито: вкладки прошлого запуска возвращаются, инкогнито-вкладка не пишет историю,
// не делит куки с обычными вкладками и не возвращается после перезапуска
module.exports = {
	title: 'Сессия и инкогнито: восстановление вкладок, инкогнито без истории и общих кук',
	gui: true,
	async run(t) {
		const base = t.server.base;
		let b = await t.browser({ settings: { startup: 'session', saveHistory: true } });
		await b.go(base + '/a', 1200);
		await b.newTab(base + '/b', 1200);
		await b.newTab(base + '/find', 1200);
		// Кука в обычной вкладке
		let pg = await b.page((u) => u === base + '/find');
		await pg.ev(`document.cookie = 'who=normal; path=/; max-age=3600'`);
		// Инкогнито
		await b.activate();
		b.x('key', '--clearmodifiers', 'ctrl+shift+n');
		await t.sleep(1200);
		let s = await b.st();
		const incog = await b.tb.ev(`!!document.querySelector('#tabs .tab.active.incognito')`);
		t.check('Ctrl+Shift+N открывает вкладку инкогнито', s.tabs.length === 4 && incog, s.tabs);
		await b.go(base + '/long?инкогнито', 1500);
		const ip = await b.page((u) => u === base + '/long?' + encodeURIComponent('инкогнито') || u.endsWith('?%D0%B8%D0%BD%D0%BA%D0%BE%D0%B3%D0%BD%D0%B8%D1%82%D0%BE'));
		t.check('инкогнито не видит куки обычных вкладок', (await ip.ev('document.cookie')) === '', await ip.ev('document.cookie'));
		await b.go('problet://history/', 1200).catch(() => {});
		await b.newTab('problet://history/', 1200);
		const visits = await b.fe(`w.problet.visits()`);
		const urls = (visits.items || visits).map((v) => v.url);
		t.check('обычные посещения в истории есть', urls.includes(base + '/a') && urls.includes(base + '/b'), urls);
		t.check('посещение из инкогнито в историю не попало', !urls.some((u) => u.includes('/long')), urls);

		await b.quit();
		b = await t.browser({ keep: true });
		await t.sleep(1500);
		s = await b.st();
		t.check('после перезапуска обычные вкладки вернулись', ['A', 'B', 'Поиск'].every((x) => s.tabs.includes(x)), s.tabs);
		t.check('вкладка инкогнито не вернулась', !(await b.tb.ev(`!!document.querySelector('#tabs .tab.incognito')`)), s.tabs);
		await b.newTab(base + '/find?2', 1500);
		pg = await b.page((u) => u === base + '/find?2');
		t.check('куки обычного профиля пережили перезапуск', (await pg.ev('document.cookie')).includes('who='), await pg.ev('document.cookie'));
	},
};
