// Родительский контроль в браузере: раздел настроек (пароль, зависимые строки), блокировка сайтов и страниц Problet,
// «Войти» по паролю, лимит времени заменяет все вкладки, выключение контроля возвращает их, запертый браузер после
// удаления файла, запрет параметров запуска
const fs = require('fs');
const path = require('path');
const net = require('net');
const browser = require('../lib/browser');
const env = require('../lib/env');
const stub = require('../lib/stub');

module.exports = {
	title: 'Родительский контроль в браузере: настройки, блокировки, лимит времени, запирание, параметры запуска',
	gui: true,
	async run(t) {
		const base = t.server.base;
		const b = await t.browser();
		const openSection = async () => {
			await b.go('problet://settings/', 1000);
			await b.fe(`([...d.getElementById('cats').children].find(c => /Родител/.test(c.textContent)).click(), 1)`);
			await t.sleep(400);
		};
		const blocked = (s) => /Заблокировано/.test(s.title || s.active || '');
		await openSection();
		t.check('раздел есть, зависимые настройки скрыты до включения', await b.fe(`d.getElementById('pc-on-only').hidden && !d.getElementById('pc-on').checked`));
		await b.fe(`(d.getElementById('pc-on').click(), 1)`);
		await t.sleep(300);
		t.check('первое включение просит придумать пароль (два поля)', await b.fe(`!d.getElementById('pc-ask').hidden && !d.getElementById('pc-ask-pass2').hidden`));
		await b.fe(`(d.getElementById('pc-ask-pass').value = 'abcd1234', d.getElementById('pc-ask-pass2').value = 'другой', d.getElementById('pc-ask').requestSubmit(), 1)`);
		await t.sleep(400);
		t.check('разные пароли не принимаются', await b.fe(`!d.getElementById('pc-on').checked`));
		await b.fe(`(d.getElementById('pc-ask-pass2').value = 'abcd1234', d.getElementById('pc-ask').requestSubmit(), 1)`);
		await t.sleep(800);
		t.check('включился, настройки раздела видны', await b.fe(`d.getElementById('pc-on').checked && !d.getElementById('pc-on-only').hidden`));
		t.check('строки времени и сайтов скрыты, пока их свитчи выключены', await b.fe(`d.getElementById('pc-time-row').hidden && d.getElementById('pc-sites-rows').hidden`));
		await b.fe(`(d.getElementById('pc-on').click(), 1)`);
		await t.sleep(300);
		t.check('выключение просит пароль (одно поле)', await b.fe(`!d.getElementById('pc-ask').hidden && d.getElementById('pc-ask-pass2').hidden`));
		await b.fe(`(d.getElementById('pc-ask-pass').value = 'неверный', d.getElementById('pc-ask').requestSubmit(), 1)`);
		await t.sleep(800);
		t.check('с неверным паролем не выключается', await b.fe(`d.getElementById('pc-on').checked`));
		await b.fe(`(d.getElementById('pc-ask-cancel').click(), 1)`);
		await t.sleep(1100);

		await b.fe(`(d.getElementById('pc-sites').click(), 1)`);
		await t.sleep(400);
		t.check('свитч сайтов показал свои строки', await b.fe(`!d.getElementById('pc-sites-rows').hidden`));
		await b.fe(`(d.getElementById('pc-list').value = '127.0.0.1\\nproblet://game', d.getElementById('pc-list').dispatchEvent(new w.Event('change')), 1)`);
		await t.sleep(600);
		await b.go(base + '/a', 2500);
		let s = await b.st();
		t.check('сайт из списка заменён на «Заблокировано»', blocked(s) && /problet:\/\/parental/.test(s.addr), s);
		await b.fe(`(d.getElementById('pass').value = 'nope', d.getElementById('enter').requestSubmit(), 1)`);
		await t.sleep(800);
		t.check('неверный пароль на странице блокировки', /Неверный/.test(await b.fe(`d.getElementById('err').textContent`)));
		await t.sleep(1100);
		await b.fe(`(d.getElementById('pass').value = 'abcd1234', d.getElementById('enter').requestSubmit(), 1)`);
		await t.sleep(2500);
		s = await b.st();
		t.check('«Войти» с паролем открывает сайт', s.active === 'A', s);
		await b.go('problet://game/', 1500);
		s = await b.st();
		t.check('страница Problet из списка заблокирована на своём адресе', blocked(s) && /problet:\/\/game/.test(s.addr), s);
		await openSection();
		await b.fe(`(d.getElementById('pc-white').click(), 1)`);
		await t.sleep(500);
		await b.go('https://example.com/', 2500);
		t.check('белый список закрывает всё, чего в нём нет', blocked(await b.st()));
		await b.go('problet://history/', 1200);
		t.check('белый список не трогает страницы Problet', !blocked(await b.st()));
		await openSection();
		t.check('попытки записаны в «Просмотр»', /example\.com/.test(await b.fe(`d.getElementById('pc-attempts').textContent`)));
		await b.fe(`(d.getElementById('pc-sites').click(), 1)`);
		await t.sleep(400);

		// Лимит времени 1 минута: все вкладки заменяются, выключение контроля возвращает их
		await b.fe(`(d.getElementById('pc-time').click(), 1)`);
		await t.sleep(400);
		await b.fe(`(d.getElementById('pc-limit-n').value = '1', d.getElementById('pc-limit-unit').value = 'min', d.getElementById('pc-limit-unit').dispatchEvent(new w.Event('change')), d.getElementById('pc-period-n').value = '1', d.getElementById('pc-period-unit').value = 'h', d.getElementById('pc-period-unit').dispatchEvent(new w.Event('change')), 1)`);
		await t.sleep(600);
		await b.newTab(base + '/a', 1500);
		await b.newTab('problet://game/', 1200);
		await b.activate();
		const done = await t.waitFor(async () => (await b.st()).tabs.every((x) => /Заблокировано/.test(x)), 100000, 2000);
		s = await b.st();
		t.check('время вышло — все вкладки, включая настройки и игру, заблокированы', !!done, s.tabs);
		const ids = await b.tb.ev(`[...document.querySelectorAll('#tabs .tab')].map(e => Number(e.dataset.id))`);
		await b.tb.ev(`problet.activateTab(${ids[0]})`);
		await t.sleep(800);
		await b.fe(`(d.getElementById('pass').value = 'abcd1234', d.getElementById('enter').requestSubmit(), 1)`);
		await t.sleep(1500);
		s = await b.st();
		t.check('настройки открыты паролем', /settings/.test(s.addr) && !blocked(s), s);
		await b.fe(`([...d.getElementById('cats').children].find(c => /Родител/.test(c.textContent)).click(), 1)`);
		await t.sleep(400);
		await b.fe(`(d.getElementById('pc-on').click(), 1)`);
		await t.sleep(300);
		await b.fe(`(d.getElementById('pc-ask-pass').value = 'abcd1234', d.getElementById('pc-ask').requestSubmit(), 1)`);
		await t.sleep(2500);
		s = await b.st();
		t.check('контроль выключили — вкладки вернулись сами', !s.tabs.some((x) => /Заблокировано/.test(x)) && s.tabs.includes('A'), s.tabs);
		t.check('настройки при этом не перезагрузились', await b.fe(`!d.getElementById('parental').classList.contains('hidden')`));
		t.check('без ошибок в консоли', b.errors.length === 0, b.errors.slice(0, 5));
		await b.close();

		// Запертый браузер: контроль включён, основной файл удалён, Problet запускается без отладочного порта
		stub.install(path.join(t.dir, 'stub'));
		Object.assign(process.env, { XDG_STATE_HOME: t.env.XDG_STATE_HOME, XDG_DATA_HOME: t.env.XDG_DATA_HOME });
		const p = stub.fresh('parental.js');
		p.init(t.env.XDG_CONFIG_HOME, 'Problet');
		await t.sleep(1100);
		await p.setOn(true, 'abcd1234');
		const MAIN = path.join(t.env.XDG_CONFIG_HOME, 'Problet', 'parental.json');
		fs.rmSync(MAIN);
		const display = await env.ensureDisplay();
		if (env.has('xdotool')) {
			const pe = { ...t.env, DISPLAY: display };
			const pr = browser.plain({ env: pe, dir: path.join(t.dir, 'locked') });
			await t.sleep(7000);
			const xo = (...a) => require('child_process').spawnSync('xdotool', a, { env: pe, encoding: 'utf8' }).stdout.trim();
			const id = xo('search', '--name', 'Problet').split('\n').filter(Boolean).pop();
			t.check('запертый браузер открылся страницей блокировки', /Заблокировано|Blocked/.test(xo('getwindowname', id)), xo('getwindowname', id));
			xo('windowactivate', '--sync', id);
			xo('type', '--delay', '40', 'abcd1234');
			xo('key', 'Return');
			await t.sleep(3000);
			t.check('пароль открыл браузер и восстановил файл', fs.existsSync(MAIN) && !/Заблокировано|Blocked/.test(xo('getwindowname', id)), xo('getwindowname', id));
			pr.kill('SIGKILL');
			await t.sleep(500);
		}

		// Параметры запуска при включённом контроле
		const port = 9800 + Math.floor(Math.random() * 150);
		const pr2 = browser.plain({ env: { ...t.env, DISPLAY: display }, dir: path.join(t.dir, 'args'), args: ['--remote-debugging-port=' + port] });
		let err = '';
		pr2.stderr.on('data', (d) => { err += d; });
		await t.sleep(5000);
		const open = await new Promise((r) => { const c = net.connect(port, '127.0.0.1', () => { c.end(); r(true); }); c.on('error', () => r(false)); });
		t.check('отладочный порт не открылся, сообщение о запрете', !open && /Родительский контроль запрещает/.test(err), err.slice(-300));
		pr2.kill('SIGKILL');
		const pr3 = browser.plain({ env: t.env, dir: path.join(t.dir, 'args2'), args: ['--headless', '--fetch=' + base + '/a'] });
		const code = await new Promise((r) => { pr3.on('exit', r); setTimeout(() => { pr3.kill('SIGKILL'); r('завис'); }, 20000); });
		t.check('режим без окна не запускается (код 1)', code === 1, code);
	},
};
