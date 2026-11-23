// Родительский контроль без окна: списки сайтов, лимит времени, подписанные копии и запирание при их порче,
// системная запись (под правами администратора), запрещённые параметры запуска
const fs = require('fs');
const path = require('path');
const stub = require('../lib/stub');

module.exports = {
	title: 'Родительский контроль: правила, время, копии, запирание, параметры запуска',
	async run(t) {
		stub.install(path.join(t.dir, 'stub'));
		Object.assign(process.env, { XDG_STATE_HOME: t.env.XDG_STATE_HOME, XDG_DATA_HOME: t.env.XDG_DATA_HOME });
		const APPDATA = t.env.XDG_CONFIG_HOME;
		const MAIN = path.join(APPDATA, 'Problet', 'parental.json');
		const C1 = path.join(t.env.XDG_STATE_HOME, 'problet', 'pc.dat');
		const C2 = path.join(t.env.XDG_DATA_HOME, 'problet', '.pc');
		const load = () => {
			const p = stub.fresh('parental.js');
			p.init(APPDATA, 'Problet');
			return p;
		};
		const wait = () => t.sleep(1100); // после неверного пароля — секунда паузы
		const refuse = async (fn) => {
			try {
				await fn();
				return false;
			} catch (e) {
				return true;
			}
		};

		let p = load();
		t.check('по умолчанию выключен и ничего не блокирует', !p.isOn() && p.check('https://youtube.com/') === null);
		t.check('короткий пароль не принимается', await refuse(() => p.setOn(true, '12')));
		await p.setOn(true, 'abcd1234');
		t.check('включается с паролем, файл и две копии на месте', p.isOn() && [MAIN, C1, C2].every((f) => fs.existsSync(f)));

		// ---------- Сайты ----------
		p.setConfig({ sites: { on: true, white: false, list: ['youtube.com', 'example.org/shorts', 'problet://game', 'file://'] } });
		t.check('чёрный список: домен и поддомены', p.check('https://youtube.com/') === 'site' && p.check('https://m.youtube.com/x') === 'site' && p.check('https://www.youtube.com/') === 'site');
		t.check('чёрный список: похожий домен не задевает', p.check('https://notyoutube.com/') === null);
		t.check('чёрный список: путь', p.check('https://example.org/shorts/1') === 'site' && p.check('https://example.org/video') === null);
		t.check('чёрный список: страница Problet и файлы', p.check('problet://game/') === 'site' && p.check('file:///home/x.html') === 'site' && p.check('problet://settings/') === null);
		t.check('страница блокировки и служебные страницы не блокируются', p.check('problet://parental/?u=x') === null && p.check('problet://ui/') === null);
		p.setConfig({ sites: { white: true, list: ['wikipedia.org'] } });
		t.check('белый список: открыт только список', p.check('https://ru.wikipedia.org/') === null && p.check('https://example.com/') === 'site');
		t.check('белый список не трогает страницы Problet', p.check('problet://settings/') === null && p.check('problet://game/') === null);
		await wait();
		p.enter('https://example.com/', 'abcd1234', 'site');
		t.check('«Войти» по паролю открывает сайт', p.check('https://example.com/page') === null);
		p.setConfig({ sites: { on: false } });

		// ---------- Время ----------
		p.setConfig({ time: { on: true, limit: { n: 1, unit: 'min' }, period: { n: 1, unit: 'd' } } });
		t.check('пока лимит не вышел, всё открыто', p.check('https://a.test/') === null);
		const crossed = p.tick(65000, 'a.test');
		t.check('лимит вышел — сообщает об этом один раз', crossed === true && p.tick(5000, 'a.test') === false);
		t.check('после лимита закрыто всё, включая страницы Problet', p.check('https://a.test/') === 'time' && p.check('problet://settings/') === 'time' && p.check('problet://nonexistent/') === 'time');
		t.check('открытый раньше паролем сайт не обходит лимит времени', p.check('https://example.com/') === 'time');
		await wait();
		p.enter('https://a.test/', 'abcd1234', 'time');
		t.check('«Войти» при вышедшем времени открывает сайт, лимит не сбрасывается', p.check('https://a.test/') === null && p.check('https://b.test/') === 'time' && p.info().used >= 60000);
		const st = (p.unlock('abcd1234'), p.stats());
		t.check('статистика: время на сайте', st.hosts.some((h) => h.key === 'a.test' && h.ms >= 70000), st.hosts);
		p.recordAttempt('https://b.test/', 'time');
		t.check('статистика: попытки', p.stats().attempts.some((a) => a.url === 'https://b.test/' && a.reason === 'time'));
		p.setConfig({ time: { on: false } });
		t.check('выключили лимит — снова открыто', p.check('https://b.test/') === null);
		p.flush();

		// ---------- Пароль ----------
		p = load();
		t.check('после перезапуска включён и настройки закрыты паролем', p.isOn() && !p.status().unlocked);
		t.check('без пароля настройки не меняются', await refuse(() => p.setConfig({ time: { on: true } })));
		t.check('выключение с неверным паролем не проходит', await refuse(() => p.setOn(false, 'неверный')) && p.isOn());

		// ---------- Копии и запирание ----------
		const snap = Object.fromEntries([MAIN, C1, C2].map((f) => [f, fs.readFileSync(f, 'utf8')]));
		const restore = () => {
			for (const [f, text] of Object.entries(snap)) {
				fs.mkdirSync(path.dirname(f), { recursive: true });
				fs.writeFileSync(f, text);
			}
		};
		const scenario = async (name, mutate) => {
			restore();
			mutate();
			p = load();
			t.check(name + ': браузер заперт', p.isLocked() && p.check('https://example.com/') === 'locked' && p.check('problet://settings/') === 'locked');
			await wait();
			t.check(name + ': чужой пароль не подходит', await refuse(() => p.unlock('wrong')) && p.isLocked());
			await wait();
			p.unlock('abcd1234');
			t.check(name + ': пароль открывает, файлы восстановлены', !p.isLocked() && [MAIN, C1, C2].every((f) => fs.existsSync(f)));
			p = load();
			t.check(name + ': после перезапуска всё сходится', !p.isLocked() && p.isOn());
		};
		await scenario('удалён основной файл', () => fs.rmSync(MAIN));
		await scenario('удалена копия', () => fs.rmSync(C2));
		await scenario('в файле руками выключили контроль', () => {
			const j = JSON.parse(fs.readFileSync(MAIN, 'utf8'));
			j.d.on = false;
			fs.writeFileSync(MAIN, JSON.stringify(j));
		});
		await scenario('файл испорчен', () => fs.writeFileSync(C1, 'мусор'));
		// подмена старой версией
		restore();
		p = load();
		p.unlock('abcd1234');
		p.setConfig({ sites: { on: true, list: ['vk.com'] } });
		for (const f of [MAIN, C1, C2]) snap[f] = fs.readFileSync(f, 'utf8');
		const older = snap[MAIN];
		p.setConfig({ sites: { list: ['vk.com', 'ok.ru'] } });
		for (const f of [MAIN, C1, C2]) snap[f] = fs.readFileSync(f, 'utf8');
		await scenario('основной файл подменён старой версией', () => fs.writeFileSync(MAIN, older));
		for (const f of [MAIN, C1, C2]) fs.rmSync(f, { force: true });
		p = load();
		t.check('всё удалено и защиты правами администратора нет — контроль выключен (ограничение без прав)', !p.isOn() && !p.isLocked());

		// ---------- Системная запись (только если можно писать в системную папку, то есть тесты идут от администратора) ----------
		const pstore = stub.fresh('parental-store.js');
		const admin = pstore.adminFile();
		let canAdmin = false;
		try {
			fs.mkdirSync(path.dirname(admin), { recursive: true });
			fs.writeFileSync(admin + '.probe', '');
			fs.rmSync(admin + '.probe');
			canAdmin = true;
		} catch (e) { /* не администратор */ }
		if (canAdmin) {
			p = load();
			await p.setOn(true, 'abcd1234');
			p.setConfig({ time: { on: true } });
			const rec = JSON.parse(fs.readFileSync(MAIN, 'utf8')).d;
			const sys = { ...rec, rev: rec.rev + 1, admin: true };
			fs.writeFileSync(admin, pstore.pack(sys));
			const mine = { ...JSON.parse(fs.readFileSync(MAIN, 'utf8')).d, admin: true, rev: sys.rev };
			fs.writeFileSync(MAIN, pstore.pack(mine));
			for (const f of [C1, C2]) fs.writeFileSync(f, pstore.pack(sys));
			p = load();
			t.check('системная запись: всё сходится', p.isOn() && !p.isLocked());
			for (const f of [MAIN, C1, C2]) fs.rmSync(f);
			p = load();
			t.check('системная запись: удалены все свои файлы — заперто', p.isLocked());
			p.unlock('abcd1234');
			t.check('системная запись: пароль открывает, лимит времени на месте', !p.isLocked() && p.publicConfig().time.on && p.publicConfig().admin);
			fs.rmSync(admin, { force: true });
		} else console.log('  (системная запись не проверялась: нужны права администратора)');
		t.check('проверка «учётка с правами администратора» отвечает', typeof pstore.isPrivileged() === 'boolean');

		// ---------- Параметры запуска ----------
		const bad = p.badArgs(['--remote-debugging-port=9222', '--inspect', '--headless', '--fetch=x', '--eval=1', '--remote-debugging-pipe', '--user-data-dir=/x', '--lang=ru', 'https://a.test']);
		t.check('запрещённые параметры найдены, обычные пропущены', bad.length === 6 && !bad.some((a) => /user-data-dir|lang|https/.test(a)), bad);
	},
};
