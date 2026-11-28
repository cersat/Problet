// API расширений Chrome, которых нет в Electron: правила declarativeNetRequest (разбор urlFilter, приоритеты, переадресация, заголовки),
// шаблоны адресов contextMenus, а в живом браузере — cookies, блокировка и переадресация запросов, переходы webNavigation
const fs = require('fs');
const path = require('path');
const stub = require('../lib/stub');

module.exports = {
	title: 'API расширений: правила сетевых запросов, меню, cookies, переходы страниц',
	gui: true,
	async run(t) {
		// ---------- Без окна: правила ----------
		stub.install(path.join(t.dir, 'stub'));
		const api = stub.fresh('extapi.js');
		const sent = [];
		const relay = { isDestroyed: () => false, webContents: { send: (c, e) => sent.push(e) } };
		const ses = { cookies: { on() {} }, extensions: { getExtension: () => ({ path: t.dir, manifest: { permissions: ['declarativeNetRequest', 'cookies', 'notifications', 'webNavigation'] } }) } };
		fs.mkdirSync(path.join(t.dir, 'dnr'), { recursive: true });
		api.start({ session: () => ses, relays: () => new Map([['ext1', relay]]), dataDir: () => path.join(t.dir, 'dnr'), tabById: () => null });
		const rule = (id, condition, action, priority) => ({ id, priority, condition, action });
		const req = (url, extra) => ({ url, resourceType: 'script', method: 'GET', referrer: 'https://site.example/', ...extra });
		await api.handle({ op: 'dnr-update', kind: 'dynamic', options: { addRules: [
			rule(1, { urlFilter: '||ads.example^' }, { type: 'block' }),
			rule(2, { urlFilter: '||ads.example^path/ok' }, { type: 'allow' }, 5),
			rule(3, { urlFilter: '/old/*.js', resourceTypes: ['script'] }, { type: 'redirect', redirect: { url: 'https://cdn.example/new.js' } }),
			rule(4, { regexFilter: '^https://r\\.example/(\\d+)$' }, { type: 'redirect', redirect: { regexSubstitution: 'https://r2.example/\\1' } }),
			rule(5, { urlFilter: 'http://up.example', resourceTypes: ['script'] }, { type: 'upgradeScheme' }),
			rule(6, { urlFilter: '||third.example^', domainType: 'thirdParty' }, { type: 'block' }),
			rule(7, { urlFilter: '||hdr.example^', resourceTypes: ['script'] }, { type: 'modifyHeaders', requestHeaders: [{ header: 'X-Test', operation: 'set', value: '1' }, { header: 'Cookie', operation: 'remove' }] }),
			rule(8, { urlFilter: '||img.example^' }, { type: 'block' }),
		] } }, 'ext1');
		t.check('правило блокировки по || и ^', JSON.stringify(api.beforeRequest(req('https://sub.ads.example/x.js'))) === '{"cancel":true}');
		t.check('чужой домен с похожим именем не блокируется', api.beforeRequest(req('https://notads.example/x.js')) === null);
		t.check('allow с большим приоритетом перебивает block', api.beforeRequest(req('https://ads.example/path/ok')) === null);
		t.check('переадресация по urlFilter со звёздочкой', (api.beforeRequest(req('https://a.example/old/lib.min.js')) || {}).redirectURL === 'https://cdn.example/new.js');
		t.check('regexSubstitution подставляет группы', (api.beforeRequest(req('https://r.example/42')) || {}).redirectURL === 'https://r2.example/42');
		t.check('upgradeScheme меняет http на https', (api.beforeRequest(req('http://up.example/')) || {}).redirectURL === 'https://up.example/');
		t.check('thirdParty: сторонний запрос блокируется', !!api.beforeRequest(req('https://third.example/x.js', { referrer: 'https://site.example/' })));
		t.check('thirdParty: свой запрос не блокируется', api.beforeRequest(req('https://third.example/x.js', { referrer: 'https://third.example/' })) === null);
		t.check('без resourceTypes правило не касается главной страницы', api.beforeRequest(req('https://img.example/', { resourceType: 'mainFrame' })) === null);
		t.check('но касается картинок', !!api.beforeRequest(req('https://img.example/a.png', { resourceType: 'image' })));
		const h = { Cookie: 'a=1', Accept: '*/*' };
		api.requestHeaders(req('https://hdr.example/x.js'), h);
		t.check('modifyHeaders: set и remove заголовков запроса', h['X-Test'] === '1' && !('Cookie' in h) && h.Accept === '*/*', h);
		await api.handle({ op: 'dnr-update', kind: 'dynamic', options: { addRules: [rule(9, { urlFilter: '||resp.example^', resourceTypes: ['script'] }, { type: 'modifyHeaders', responseHeaders: [{ header: 'X-Frame-Options', operation: 'remove' }, { header: 'X-Added', operation: 'set', value: 'да' }] })] } }, 'ext1');
		const rh = { 'X-Frame-Options': ['DENY'], 'Content-Type': ['text/html'] };
		const changed = api.responseHeaders(req('https://resp.example/x.js'), rh);
		t.check('modifyHeaders: заголовки ответа удаляются и ставятся', changed === true && !('X-Frame-Options' in rh) && rh['X-Added'][0] === 'да' && rh['Content-Type'][0] === 'text/html', rh);
		t.check('чужому адресу заголовки ответа не меняются', api.responseHeaders(req('https://other.example/x.js'), { A: ['1'] }) === false);
		t.check('чужие адреса chrome-extension:// и problet:// правила не трогают', api.beforeRequest(req('problet://settings/')) === null);
		let dup = '';
		try {
			await api.handle({ op: 'dnr-update', kind: 'dynamic', options: { addRules: [rule(1, { urlFilter: 'x' }, { type: 'block' })] } }, 'ext1');
		} catch (e) {
			dup = e.message;
		}
		t.check('повторный id правила отклоняется', /unique/.test(dup), dup);
		await api.handle({ op: 'dnr-update', kind: 'dynamic', options: { removeRuleIds: [1] } }, 'ext1');
		t.check('удалённое правило перестаёт действовать', api.beforeRequest(req('https://sub.ads.example/x.js')) === null);
		const saved = JSON.parse(fs.readFileSync(path.join(t.dir, 'dnr', 'ext-dnr.json'), 'utf8'));
		t.check('динамические правила записаны на диск', saved.ext1 && saved.ext1.dynamic.length === 8, saved);
		await api.handle({ op: 'dnr-update', kind: 'session', options: { addRules: [rule(100, { urlFilter: '||ses.example^' }, { type: 'block' })] } }, 'ext1');
		t.check('правила сеанса действуют', !!api.beforeRequest(req('https://ses.example/x.js')));
		const sess = await api.handle({ op: 'dnr-get', kind: 'session' }, 'ext1');
		t.check('getSessionRules возвращает правила', sess.length === 1 && sess[0].id === 100, sess);
		const cm = api.patternRe('https://*.example.com/*');
		t.check('шаблон адреса с поддоменом', cm.test('https://a.example.com/x') && cm.test('https://example.com/x') && !cm.test('https://example.org/x'));
		t.check('<all_urls> понимает http и https', api.patternRe('<all_urls>').test('http://a/') && !api.patternRe('<all_urls>').test('problet://a/'));
		// Меню: пункты по контекстам, %s, подменю и нажатие
		await api.handle({ op: 'menus-sync', items: [
			{ id: 'p', title: 'На странице', contexts: ['page'] },
			{ id: 's', title: 'Найти «%s»', contexts: ['selection'] },
			{ id: 'l', title: 'Ссылка', contexts: ['link'], targetUrlPatterns: ['https://*.example.com/*'] },
			{ id: 'g', title: 'Группа', contexts: ['page'] },
			{ id: 'g1', parentId: 'g', title: 'Внутри', contexts: ['page'] },
			{ id: 'c', title: 'Флажок', type: 'checkbox', checked: false, contexts: ['page'] },
		] }, 'ext1');
		const clicks = [];
		const lab = (rows) => rows.map((r) => r.label);
		const pageMenu = api.menuItems({ id: 1 }, { pageURL: 'https://site.example/' }, (...a) => clicks.push(a));
		const flat = pageMenu.length === 1 && pageMenu[0].submenu ? pageMenu[0].submenu : pageMenu;
		t.check('меню страницы: пункты контекста page и подменю', lab(flat).includes('На странице') && lab(flat).includes('Группа') && !lab(flat).includes('Ссылка') && flat.find((r) => r.label === 'Группа').submenu[0].label === 'Внутри', lab(flat));
		const selMenu = api.menuItems({ id: 1 }, { pageURL: 'https://site.example/', selectionText: 'кот' }, () => {});
		const selFlat = selMenu.length === 1 && selMenu[0].submenu ? selMenu[0].submenu : selMenu;
		t.check('меню выделения: %s заменяется текстом, пункты страницы пропадают', lab(selFlat).includes('Найти «кот»') && !lab(selFlat).includes('На странице'), lab(selFlat));
		const linkOk = api.menuItems({ id: 1 }, { pageURL: 'https://site.example/', linkURL: 'https://a.example.com/x' }, () => {});
		const linkBad = api.menuItems({ id: 1 }, { pageURL: 'https://site.example/', linkURL: 'https://other.org/x' }, () => {});
		t.check('targetUrlPatterns: пункт ссылки только для подходящих адресов', JSON.stringify(linkOk).includes('Ссылка') && !JSON.stringify(linkBad).includes('Ссылка'));
		flat.find((r) => r.label === 'На странице').click();
		t.check('нажатие пункта доходит до обработчика с id расширения', clicks.length === 1 && clicks[0][0] === 'ext1' && clicks[0][1].id === 'p', clicks.map((c) => [c[0], c[1].id]));
		sent.length = 0;
		api.menuClicked('ext1', { id: 'c', type: 'checkbox', checked: false }, { pageURL: 'https://site.example/' }, { id: 1 });
		const ev = sent.find((e) => e.name === 'contextMenus.onClicked');
		t.check('onClicked: у флажка wasChecked и checked', ev && ev.args[0].wasChecked === false && ev.args[0].checked === true, ev);

		t.check('сочетание из манифеста приводится к виду браузера', api.normalizeShortcut('Alt+Shift+Comma') === 'Alt+Shift+,' && api.normalizeShortcut('Command+Shift+Y') === 'Ctrl+Shift+Y' && api.normalizeShortcut('Ctrl+Alt+PageUp') === 'Ctrl+Alt+PageUp' && api.normalizeShortcut('Y') === '' && api.normalizeShortcut('Ctrl+Hello') === '', [api.normalizeShortcut('Alt+Shift+Comma'), api.normalizeShortcut('Command+Shift+Y')]);
		const cmdSes = { cookies: { on() {} }, extensions: { getExtension: () => ({ path: t.dir, manifest: { permissions: [], commands: { run: { suggested_key: { default: 'Ctrl+Shift+Y', mac: 'Command+Shift+Y' }, description: 'Запуск' }, nokey: { description: 'Без клавиши' }, _execute_action: { suggested_key: { default: 'Ctrl+Shift+U' } } } } }) } };
		api.start({ session: () => cmdSes, relays: () => new Map([['ext1', relay]]), dataDir: () => path.join(t.dir, 'dnr'), tabById: () => null });
		const cmds = await api.handle({ op: 'commands-getAll' }, 'ext1');
		t.check('commands.getAll отдаёт команды из манифеста', cmds.length === 3 && cmds.find((c) => c.name === 'run').shortcut === 'Ctrl+Shift+Y' && cmds.find((c) => c.name === 'nokey').shortcut === '', cmds);
		sent.length = 0;
		t.check('сочетание команды перехватывается', api.hotkey('Ctrl+Shift+Y', { id: 7 }) === true);
		const cev = sent.find((e) => e.name === 'commands.onCommand');
		t.check('расширению уходит onCommand с именем команды и вкладкой', cev && cev.args[0] === 'run' && cev.args[1].id === 7, cev);
		t.check('чужое сочетание и _execute_* не перехватываются', api.hotkey('Ctrl+Shift+Q') === false && api.hotkey('Ctrl+Shift+U') === false);
		let noPerm = '';
		const noses = { cookies: { on() {} }, extensions: { getExtension: () => ({ path: t.dir, manifest: { permissions: [] } }) } };
		api.start({ session: () => noses, relays: () => new Map([['ext1', relay]]), dataDir: () => path.join(t.dir, 'dnr'), tabById: () => null });
		try {
			await api.handle({ op: 'cookies-getAll', details: {} }, 'ext1');
		} catch (e) {
			noPerm = e.message;
		}
		t.check('без разрешения cookies запрос отклоняется', /permission 'cookies'/.test(noPerm), noPerm);

		// ---------- В живом браузере ----------
		const base = t.server.base;
		const prof = path.join(t.dir, 'profile');
		const ext = path.join(prof, 'extensions', 'apitest');
		fs.mkdirSync(ext, { recursive: true });
		fs.writeFileSync(path.join(ext, 'manifest.json'), JSON.stringify({
			manifest_version: 3, name: 'API-тест', version: '1.0',
			permissions: ['cookies', 'declarativeNetRequest', 'webNavigation', 'contextMenus', 'notifications'], host_permissions: ['<all_urls>'],
			background: { service_worker: 'sw.js' },
		}));
		fs.writeFileSync(path.join(ext, 'sw.js'), '// фон не нужен: проверки идут со страницы расширения');
		fs.writeFileSync(path.join(ext, 'page.html'), '<!doctype html><meta charset="utf-8"><title>api</title><script src="page.js"></script>');
		fs.writeFileSync(path.join(ext, 'page.js'), `
window.seen = { cookie: [], nav: [], clicked: [] };
chrome.cookies.onChanged.addListener((i) => window.seen.cookie.push(i.cookie.name + ':' + i.removed));
chrome.webNavigation.onCompleted.addListener((d) => window.seen.nav.push(d.url));
window.run = async (base) => {
	const out = {};
	await chrome.cookies.set({ url: base + '/', name: 'apitest', value: 'v1' });
	out.get = (await chrome.cookies.get({ url: base + '/', name: 'apitest' }) || {}).value;
	out.all = (await chrome.cookies.getAll({ url: base + '/' })).map((c) => c.name);
	await chrome.cookies.remove({ url: base + '/', name: 'apitest' });
	out.gone = await chrome.cookies.get({ url: base + '/', name: 'apitest' });
	await chrome.declarativeNetRequest.updateDynamicRules({ addRules: [
		{ id: 1, priority: 1, action: { type: 'block' }, condition: { urlFilter: '||127.0.0.1^*/blocked-by-ext', resourceTypes: ['xmlhttprequest'] } },
		{ id: 2, priority: 1, action: { type: 'redirect', redirect: { url: base + '/ok.js' } }, condition: { urlFilter: '/redirect-me', resourceTypes: ['xmlhttprequest'] } },
	] });
	out.rules = (await chrome.declarativeNetRequest.getDynamicRules()).map((r) => r.id);
	chrome.contextMenus.create({ id: 'm1', title: 'Пункт', contexts: ['page'] });
	out.notif = await chrome.notifications.create({ type: 'basic', title: 'T', message: 'M', iconUrl: 'data:image/png;base64,iVBORw0KGgo=' });
	return out;
};
`);
		fs.writeFileSync(path.join(prof, 'extensions.json'), JSON.stringify([ext]));
		const b = await t.browser({ keep: true });
		await t.sleep(3000);
		const list = await (async () => { await b.go('problet://settings/', 1200); return b.fe(`w.problet.extList()`); })();
		const me = list.find((x) => x.name === 'API-тест');
		t.check('тестовое расширение загружено', !!me && !!me.id && !me.error, list);
		if (!me || !me.id) return;
		const pageUrl = 'chrome-extension://' + me.id + '/page.html';
		await b.go(pageUrl, 2000);
		const pg = await b.page((u) => u === pageUrl);
		t.check('страница расширения открылась', !!pg);
		if (!pg) return;
		const r = await pg.ev(`window.run(${JSON.stringify(base)})`).catch((e) => ({ error: e.message }));
		t.check('cookies: set, get, getAll, remove работают', r && r.get === 'v1' && r.all.includes('apitest') && r.gone === null, r);
		t.check('declarativeNetRequest: правила сохранились', r && JSON.stringify(r.rules) === '[1,2]', r);
		t.check('notifications.create возвращает номер', r && typeof r.notif === 'string' && r.notif.length > 0, r);
		await t.sleep(500);
		const seen = await pg.ev(`window.seen.cookie`);
		t.check('cookies.onChanged сообщил о записи и удалении', seen.includes('apitest:false') && seen.includes('apitest:true'), seen);

		await b.newTab(base + '/a', 1800);
		const site = await b.page((u) => u === base + '/a');
		const blocked = await site.ev(`fetch('/blocked-by-ext').then(() => 'loaded', () => 'blocked')`);
		t.check('запрос по правилу block отменяется', blocked === 'blocked', blocked);
		const redirected = await site.ev(`fetch('/redirect-me').then((r) => r.url, () => 'error')`);
		t.check('запрос по правилу redirect уходит на другой адрес', /\/ok\.js$/.test(redirected), redirected);
		const plain = await site.ev(`fetch('/b').then((r) => r.status, () => 'error')`);
		t.check('остальные запросы идут как обычно', plain === 200, plain);

		if (pg) {
			const nav = await pg.ev(`window.seen.nav`).catch(() => []);
			t.check('webNavigation.onCompleted сообщил о переходе на страницу', nav.includes(base + '/a'), nav);
		}
		t.check('без ошибок в консоли', b.errors.length === 0, b.errors.slice(0, 5));
	},
};
