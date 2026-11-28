// Аддоны: горячие клавиши, пункты меню и боковая панель из addon.json, смена настроек с вопросом и показом изменений,
// сетевые правила (блокировка, перенаправление, заголовки), окно разработчика, проверка addon.json
const fs = require('fs');
const path = require('path');
module.exports = {
	title: 'Аддоны: горячие клавиши, меню, боковая панель, настройки, сетевые правила, DevTools',
	gui: true,
	async run(t) {
		const base = t.server.base;
		const profile = path.join(t.dir, 'profile');
		const put = (id, files) => {
			const d = path.join(profile, 'addons', id);
			fs.mkdirSync(d, { recursive: true });
			for (const [n, c] of Object.entries(files)) fs.writeFileSync(path.join(d, n), typeof c === 'string' ? c : JSON.stringify(c));
		};
		put('dev-test', {
			'addon.json': {
				id: 'dev-test', name: 'Проверка', version: '1.0.0', permissions: ['storage', 'tabs', 'settings', 'requests'],
				background: 'bg.js',
				hotkeys: [{ id: 'k', key: 'Ctrl+Alt+K', title: 'Проверка клавиши' }],
				menus: [{ id: 'm', title: 'Пункт проверки', contexts: ['page', 'link', 'bookmark', 'tab'] }],
				sidebar: { page: 'side.html', title: 'Панель' },
			},
			'bg.js': "problet.on('hotkey', (d) => problet.storage.set('last', 'hotkey:' + d.id));",
			'side.html': '<!doctype html><meta charset="utf-8"><title>side</title><body id="s">панель аддона</body>',
		});
		put('bad-menu', { 'addon.json': { id: 'bad-menu', name: 'Плохое меню', background: 'bg.js', menus: [{ id: 'x', title: '', contexts: ['page'] }] }, 'bg.js': '' });
		put('bad-key', { 'addon.json': { id: 'bad-key', name: 'Плохая клавиша', background: 'bg.js', hotkeys: [{ id: 'x', key: 'Ctrl+Alt+ ?' }] }, 'bg.js': '' });
		put('no-bg', { 'addon.json': { id: 'no-bg', name: 'Без фона', hotkeys: [{ id: 'x', key: 'Ctrl+Alt+J' }], options: 'o.html' }, 'o.html': '<!doctype html>' });

		const b = await t.browser({ keep: true, env: { ...t.env, PROBLET_TEST_ADDON_ANSWER: 'once' } });
		await b.go('problet://settings/', 1200);
		const list = await b.fe('w.problet.extList()');
		const by = (id) => list.find((x) => x.id === '@' + id) || {};
		t.check('аддон с клавишей, меню и панелью загружается', by('dev-test').name === 'Проверка' && !by('dev-test').error && by('dev-test').sidebar === true && by('dev-test').hotkeys[0].key === 'Ctrl+Alt+K', by('dev-test'));
		t.check('пункт меню без названия отвергается', /title и contexts/.test(by('bad-menu').error || ''), by('bad-menu').error);
		t.check('неверная горячая клавиша отвергается', /горячая клавиша/.test(by('bad-key').error || ''), by('bad-key').error);
		t.check('горячие клавиши без фона отвергаются', /нужен background/.test(by('no-bg').error || ''), by('no-bg').error);

		const bg = await b.page((u) => u.includes('problet-addon://dev-test/_background.html'));
		const ev = (code) => bg.ev(code);

		// Горячая клавиша
		await b.activate();
		b.x('key', '--clearmodifiers', 'ctrl+alt+k');
		await t.sleep(900);
		t.check('горячая клавиша аддона доходит до его фона', (await ev(`problet.storage.get('last')`)) === 'hotkey:k');

		// Настройки: с разрешением меняются, лишнего нет
		const before = await ev(`problet.settings.get('showTabIcons')`);
		const keys = await ev(`problet.settings.set({ showTabIcons: ${!before.showTabIcons} })`);
		const after = await ev(`problet.settings.get('showTabIcons')`);
		t.check('аддон меняет настройку браузера', keys[0] === 'showTabIcons' && after.showTabIcons === !before.showTabIcons, { before, after });
		const bad = await ev(`problet.settings.set({ нетТакой: 1 }).then(() => 'принято', (e) => e.message)`);
		t.check('неизвестная настройка отвергается', /Нет таких настроек/.test(bad), bad);
		const huge = await ev(`problet.settings.set({}).then(() => 'принято', (e) => e.message)`);
		t.check('пустая замена отвергается', /от 1 до 30/.test(huge), huge);

		// Боковая панель
		const opened = await ev(`problet.sidebar.toggle()`);
		await t.sleep(900);
		const sideTargets = (await b.targets()).filter((x) => x.url.includes('problet-addon://dev-test/side.html'));
		t.check('боковая панель аддона открывается', opened === true && sideTargets.length === 1, { opened, n: sideTargets.length });
		await ev(`problet.sidebar.toggle()`);
		await t.sleep(600);
		t.check('и закрывается', (await b.targets()).filter((x) => x.url.includes('side.html')).length === 0);

		// Сетевые правила
		await ev(`problet.requests.setRules([{ action: 'block', urls: ['*://127.0.0.1/blocked*'] }, { action: 'redirect', urls: ['*://127.0.0.1/old*'], redirectUrl: ${JSON.stringify(base + '/a')} }, { action: 'headers', urls: ['*://127.0.0.1/hdr*'], requestHeaders: { 'X-Addon': 'yes' } }])`);
		const hits0 = t.server.hits.length;
		await b.newTab(base + '/blocked');
		await t.sleep(700);
		t.check('правило block отменяет запрос', !t.server.hits.slice(hits0).some((h) => h.startsWith('/blocked')), t.server.hits.slice(hits0));
		await b.newTab(base + '/old');
		await t.sleep(900);
		t.check('правило redirect уводит на другой адрес', t.server.hits.slice(hits0).some((h) => h === '/a') && !t.server.hits.slice(hits0).some((h) => h.startsWith('/old')), t.server.hits.slice(hits0));
		await b.newTab(base + '/hdr');
		await t.sleep(700);
		const seen = t.server.heads && t.server.heads.filter((h) => h.url === '/hdr' && h.headers['x-addon'] === 'yes');
		t.check('правило headers добавляет заголовок', Array.isArray(seen) && seen.length >= 1, t.server.heads && t.server.heads.slice(-2));
		await ev(`problet.requests.setRules([])`);
		const bad2 = await ev(`problet.requests.setRules([{ action: 'взорвать', urls: ['*://*/*'] }]).then(() => 'принято', (e) => e.message)`);
		t.check('неверное правило отвергается', /action/.test(bad2), bad2);

		// Окно разработчика
		await b.go('problet://settings/', 1000);
		await b.fe(`w.problet.addonDevtools('@dev-test')`);
		await t.sleep(1200);
		const dev = (await b.targets()).some((x) => x.url.startsWith('devtools://'));
		t.check('окно разработчика для фона аддона открывается', dev);
		t.check('в консоли нет ошибок', b.errors.length === 0, b.errors.slice(0, 5));
	},
};
