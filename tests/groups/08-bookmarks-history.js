// Закладки и история: звёздочка в адресной строке, панель закладок, папки, менеджер закладок, история посещений,
// удаление и очистка истории, «Не сохранять историю»
module.exports = {
	title: 'Закладки и история: звёздочка, панель, папки, менеджер, история и её очистка',
	gui: true,
	async run(t) {
		const base = t.server.base;
		const b = await t.browser({ settings: { bmStar: 'toggle', bookmarksBar: true } });
		const bar = () => b.tb.ev(`document.getElementById('bmlist').innerText`);

		await b.go(base + '/a');
		await b.tb.ev('problet.toggleBookmark()');
		await t.sleep(700);
		const pageApi = async () => {
			await b.go('problet://bookmarks/', 1200);
			return (u) => b.fe(u);
		};
		let api = await pageApi();
		let st = await api(`w.problet.bookmarks()`);
		t.check('звёздочка добавила закладку на текущую страницу', st.bookmarks.some((x) => x.url === base + '/a' && x.title === 'A'), st.bookmarks);
		t.check('закладка появилась на панели закладок', /\bA\b/.test(await bar()), await bar());

		await api(`w.problet.addFolder('Папка теста')`);
		st = await api(`w.problet.bookmarks()`);
		const folder = st.folders.find((f) => f.name === 'Папка теста');
		t.check('папка создаётся', !!folder, st.folders);
		await api(`w.problet.addBookmark({ url: ${JSON.stringify(base + '/b')}, title: 'Б в папке', folder: ${JSON.stringify(folder && folder.id)} })`);
		st = await api(`w.problet.bookmarks()`);
		t.check('закладка в папке', st.bookmarks.some((x) => x.title === 'Б в папке' && x.folder === (folder && folder.id)));
		const bad = await api(`w.problet.addBookmark({ url: 'javascript:alert(1)', title: 'x' }).then(() => 'принято', () => 'отказ')`);
		t.check('закладка с javascript: отклоняется', bad === 'отказ');
		await b.go('problet://bookmarks/', 1200);
		const shown = await b.fe(`d.body.innerText`);
		t.check('менеджер закладок показывает закладки и папку', shown.includes('Папка теста') && shown.includes('A'), shown.slice(0, 300));

		await b.go(base + '/a');
		await b.tb.ev('problet.toggleBookmark()');
		await t.sleep(700);
		api = await pageApi();
		st = await api(`w.problet.bookmarks()`);
		t.check('повторная звёздочка убирает закладку', !st.bookmarks.some((x) => x.url === base + '/a'), st.bookmarks.map((x) => x.url));

		// История
		await b.go(base + '/b');
		await b.go(base + '/find');
		await b.go('problet://history/', 1500);
		let visits = await b.fe(`w.problet.visits()`);
		const urls = (visits.items || visits).map((v) => v.url);
		t.check('посещения попали в историю', urls.includes(base + '/b') && urls.includes(base + '/find'), urls.slice(0, 6));
		const text = await b.fe(`d.body.innerText`);
		t.check('страница истории их показывает', text.includes('Поиск') && text.includes('B'), text.slice(0, 300));
		t.check('внутренние страницы в историю не попадают', !urls.some((u) => u.startsWith('problet:')), urls.filter((u) => u.startsWith('problet:')));
		const one = (visits.items || visits).find((v) => v.url === base + '/b');
		await b.fe(`w.problet.removeVisit(${JSON.stringify(one && one.id)})`);
		visits = await b.fe(`w.problet.visits()`);
		t.check('одно посещение удаляется', !(visits.items || visits).some((v) => v.url === base + '/b'));
		await b.fe(`w.problet.clearVisits()`);
		visits = await b.fe(`w.problet.visits()`);
		t.check('история очищается целиком', (visits.items || visits).length === 0, (visits.items || visits).length);

		await b.go('problet://settings/', 1200);
		await b.fe(`w.problet.setSettings({ saveHistory: false })`);
		await b.go(base + '/a');
		await b.go('problet://history/', 1200);
		visits = await b.fe(`w.problet.visits()`);
		t.check('«не сохранять историю» — посещения не пишутся', (visits.items || visits).length === 0, (visits.items || visits).map((v) => v.url));
		t.check('без ошибок в консоли', b.errors.length === 0, b.errors.slice(0, 5));
	},
};
