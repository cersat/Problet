// Экспорт и импорт браузера целиком, вход в аккаунт и восстановление из файла на экране приветствия.
// Сервер аккаунтов тестовый (tests/lib/syncserver.js); окно выбора файла заменено переменной PROBLET_TEST_BACKUP_FILE
const fs = require('fs');
const path = require('path');
const backup = require('../../backup');
const sync = require('../lib/syncserver');

module.exports = {
	title: 'Экспорт браузера: один файл со всем, импорт из настроек и с экрана приветствия',
	gui: true,
	async run(t) {
		const file = path.join(t.dir, 'export.problet');
		const srv = await sync.start();
		const env = { ...t.env, PROBLET_SYNC_URL: srv.url, PROBLET_TEST_BACKUP_FILE: file };
		try {
			// Профиль-источник: настройки, закладка, пространство, пароль в хранилище, вход в аккаунт
			const a = await t.browser({ profile: 'src', env, settings: { welcomeDone: true } });
			const ap = (code) => a.fe(`w.problet.${code}`);
			await a.go('problet://settings/', 1000);
			await ap(`setSettings({ bmOnlyIcons: true, spacesMerged: true })`);
			await ap(`addBookmark({ url: 'https://example.com/saved', title: 'Из экспорта' })`);
			const sid = await ap(`spacesAdd('Перенесённое')`);
			await ap(`pwCreate('мастер-1')`);
			await ap(`pwAdd({ origin: 'https://site.example', username: 'ann', password: 'секрет-1' })`);
			await ap(`syncRegister('Vera_3', 'password-1', 'password-1')`);
			// Без пароля файла вход в аккаунт в файл не попадает
			const plain = await ap(`exportAll('')`);
			t.check('файл создан', fs.existsSync(file) && /Сохранено/.test(plain.message), plain);
			t.check('без пароля файла вход в аккаунт не добавлен', /не добавлен/.test(plain.message) && !backup.inspect(fs.readFileSync(file)).hasAccount, plain.message);
			const full = await ap(`exportAll('пароль-файла')`);
			const info = backup.inspect(fs.readFileSync(file));
			t.check('с паролем файла вход в аккаунт добавлен', info.hasAccount && /защищён/.test(full.message), full.message);
			t.check('в файле есть и хранилище паролей', info.files >= 1, info);
			t.check('токен и ключ в файле не лежат открытым текстом', !fs.readFileSync(file).toString('latin1').includes('Vera_3'));
			await a.quit();

			// Новый профиль, экран приветствия: восстанавливаем из файла
			const b = await t.browser({ profile: 'dst', env, settings: { welcomeDone: false } });
			await t.sleep(800);
			const where = await b.st();
			t.check('на новом профиле открыт экран приветствия', /welcome/.test(where.src || ''), where);
			const shown = await b.fe(`({ acc: !!d.getElementById('acc-login'), restore: !!d.getElementById('restore') })`);
			t.check('на приветствии есть вход в аккаунт и восстановление', shown.acc && shown.restore, shown);
			const bad = await b.fe(`(async () => { d.getElementById('file-pass').value = 'не тот'; d.getElementById('restore').click(); await new Promise((r) => setTimeout(r, 2500)); return d.getElementById('msg').textContent; })()`);
			t.check('с неверным паролем файла всё остальное восстановлено, вход нет', /Импортировано/.test(bad) && /не восстановлен/.test(bad), bad);
			await b.quit();

			// Второй заход: верный пароль, теперь вместе со входом
			const c = await t.browser({ profile: 'dst2', env, settings: { welcomeDone: false } });
			await t.sleep(800);
			const ok = await c.fe(`(async () => { d.getElementById('file-pass').value = 'пароль-файла'; d.getElementById('restore').click(); await new Promise((r) => setTimeout(r, 2500)); return d.getElementById('msg').textContent; })()`);
			t.check('с верным паролем восстановлен и вход в аккаунт', /Вход в аккаунт восстановлен/.test(ok), ok);
			await c.quit();
			const d2 = await t.browser({ profile: 'dst2', env, keep: true });
			await t.sleep(1500);
			await d2.go('problet://settings/', 1000);
			const dp = (code) => d2.fe(`w.problet.${code}`);
			const sets = (await dp(`getSettings()`)).settings;
			t.check('настройки из файла на месте', sets.bmOnlyIcons === true && sets.welcomeDone === true, { bmOnlyIcons: sets.bmOnlyIcons, welcomeDone: sets.welcomeDone });
			const bms = await dp(`bookmarks()`);
			t.check('закладка из файла на месте', bms.bookmarks.some((x) => x.title === 'Из экспорта'), bms.bookmarks.length);
			t.check('пространство из файла на месте', (await dp(`spaces()`)).spaces.some((x) => x.id === sid && x.name === 'Перенесённое'));
			await dp(`pwUnlock('мастер-1')`);
			t.check('пароли из хранилища на месте', (await dp(`pwList()`)).some((x) => x.username === 'ann'));
			await t.sleep(2500);
			const st = await dp(`syncStatus()`);
			t.check('вход в аккаунт работает на новом устройстве', st.logged && st.nick === 'Vera_3' && !st.error, st);
			const devs = await dp(`syncDevices()`);
			t.check('импортированное устройство в списке отдельно от исходного', devs.length >= 2 && devs.some((x) => x.current && /Linux|Windows|macOS/.test(x.name)), devs);
			const old = fs.existsSync(path.join(t.dir, 'dst2', 'data.json.before-import'));
			t.check('прежний файл данных сохранён рядом', old);

			// Вход в аккаунт с экрана приветствия
			const e = await t.browser({ profile: 'fresh', env, settings: { welcomeDone: false } });
			await e.fe(`(async () => { d.getElementById('acc-nick').value = 'Vera_3'; d.getElementById('acc-pass').value = 'password-1'; d.getElementById('acc-login').click(); await new Promise((r) => setTimeout(r, 2500)); })()`);
			const ep = (code) => e.fe(`w.problet.${code}`);
			const est = await ep(`syncStatus()`);
			t.check('на приветствии можно войти в аккаунт', est.logged && est.nick === 'Vera_3', est);
			const flags = (await ep(`getSettings()`)).settings;
			t.check('галочка «сразу включить синхронизацию» включила её', flags.syncBookmarks && flags.syncSpaces && flags.syncSettings && flags.syncTabs, flags);
			const reg = await e.fe(`(async () => { d.getElementById('acc-in').classList.contains('hidden'); return d.getElementById('acc-in').textContent; })()`);
			t.check('приветствие показывает, что вход выполнен', /Vera_3/.test(reg), reg);
		} finally {
			srv.close();
		}
	},
};
