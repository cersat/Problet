// Аккаунт Problet и синхронизация: регистрация и вход, закладки и настройки между двумя устройствами (с удалением),
// пароли сливаются и ходят по сети только зашифрованными. Сервер — тестовый, в памяти (tests/lib/syncserver.js)
const sync = require('../lib/syncserver');

module.exports = {
	title: 'Аккаунт и синхронизация: вход, закладки, настройки, зашифрованные пароли',
	gui: true,
	async run(t) {
		const srv = await sync.start();
		const env = { ...t.env, PROBLET_SYNC_URL: srv.url };
		const a = await t.browser({ profile: 'a', env });
		const b = await t.browser({ profile: 'b', env });
		const ap = (code) => a.fe(`w.problet.${code}`);
		const bp = (code) => b.fe(`w.problet.${code}`);
		const err = (code, who) => who.fe(`w.problet.${code}.then(() => 'принято', (e) => String(e.message || e))`);
		await a.go('problet://settings/', 1000);
		await b.go('problet://settings/', 1000);
		try {
			// Аккаунт
			t.check('короткий пароль не принимается', /не короче 8/.test(await err(`syncRegister('anna', 'short', 'short')`, a)));
			t.check('разные пароли не принимаются', /не совпадают/.test(await err(`syncRegister('anna', 'password-1', 'password-2')`, a)));
			t.check('плохой никнейм не принимается', /Никнейм/.test(await err(`syncRegister('a b', 'password-1', 'password-1')`, a)));
			const reg = await ap(`syncRegister('Anna_1', 'password-1', 'password-1')`);
			t.check('аккаунт создан, устройство вошло', reg.logged && reg.nick === 'Anna_1', reg);
			t.check('занятый никнейм не принимается', /занят/.test(await err(`syncRegister('anna_1', 'password-1', 'password-1')`, b)));
			t.check('неверный пароль не пускает', /Неверный/.test(await err(`syncLogin('Anna_1', 'password-X')`, b)));
			const shown = await a.fe(`(() => ({ out: d.getElementById('sync-out').classList.contains('hidden'), name: d.getElementById('sync-name').textContent }))()`);
			// страница обновляется по таймеру и при возврате фокуса, поэтому даём ей время
			await t.sleep(5500);
			const shown2 = await a.fe(`(() => ({ out: d.getElementById('sync-out').classList.contains('hidden'), name: d.getElementById('sync-name').textContent }))()`);
			t.check('страница показывает аккаунт вместо формы входа', shown2.out && shown2.name === 'Anna_1', [shown, shown2]);

			// Закладки и настройки: с первого устройства на второе
			await ap(`addBookmark({ url: 'https://example.com/a', title: 'Закладка с первого' })`);
			await ap(`setSettings({ syncBookmarks: true, syncSettings: true, bmOnlyIcons: true })`);
			const sa = await ap(`syncNow()`);
			t.check('синхронизация прошла без ошибки', !sa.error && sa.last > 0, sa);
			const raw = srv.stored('Anna_1', 'bookmarks');
			t.check('на сервере закладки лежат зашифрованными', raw && !/Закладка|example\.com/.test(raw.data) && /"tag"/.test(raw.data), raw);

			const lb = await bp(`syncLogin('anna_1', 'password-1')`);
			t.check('второе устройство вошло (никнейм без учёта регистра)', lb.logged, lb);
			await bp(`setSettings({ syncBookmarks: true, syncSettings: true })`);
			const sb = await bp(`syncNow()`);
			const bm = await bp(`bookmarks()`);
			const set = await bp(`getSettings().then((r) => r.settings)`);
			t.check('закладка пришла на второе устройство', !sb.error && bm.bookmarks.some((x) => x.title === 'Закладка с первого'), [sb, bm.bookmarks.length]);
			t.check('настройка пришла на второе устройство', set.bmOnlyIcons === true, set.bmOnlyIcons);

			// Удаление закладки переносится
			const id = bm.bookmarks.find((x) => x.title === 'Закладка с первого').id;
			await bp(`removeBookmark(${JSON.stringify(id)})`);
			await bp(`syncNow()`);
			await ap(`syncNow()`);
			const am = await ap(`bookmarks()`);
			t.check('удаление закладки дошло до первого устройства', !am.bookmarks.some((x) => x.title === 'Закладка с первого'), am.bookmarks);

			// Пароли: сливаются, по сети только зашифрованными
			await ap(`pwCreate('мастер-пароль-а')`);
			await ap(`pwAdd({ origin: 'https://site-a.example', username: 'ann', password: 'секрет-а-123' })`);
			await bp(`pwCreate('мастер-пароль-б')`);
			await bp(`pwAdd({ origin: 'https://site-b.example', username: 'bob', password: 'секрет-б-456' })`);
			await ap(`setSettings({ syncPasswords: true })`);
			await bp(`setSettings({ syncPasswords: true })`);
			await ap(`syncNow()`);
			await bp(`syncNow()`);
			await ap(`syncNow()`);
			const la = await ap(`pwList()`);
			const lbp = await bp(`pwList()`);
			t.check('пароли слились на обоих устройствах', la.length === 2 && lbp.length === 2, [la.length, lbp.length]);
			const pw = srv.stored('Anna_1', 'passwords');
			t.check('на сервере пароли лежат зашифрованными', pw && !/секрет|site-a|ann/.test(pw.data), pw);
			const rev = await bp(`pwReveal(${JSON.stringify(lbp.find((x) => x.username === 'ann').id)})`);
			t.check('пароль с первого устройства расшифровался на втором', rev === 'секрет-а-123', rev);

			// Закрытое хранилище не синхронизируется и не мешает остальному
			await ap(`pwLock()`);
			const locked = await ap(`syncNow()`);
			t.check('при закрытом хранилище пароли ждут, ошибки нет', locked.passwords === 'locked' && !locked.error, locked);

			// Выход
			const out = await ap(`syncLogout()`);
			t.check('выход очищает аккаунт на устройстве', !out.logged && !out.nick, out);
			t.check('сервер получил выход', srv.calls.includes('POST /api/account/logout'), srv.calls.slice(-5));
		} finally {
			srv.close();
		}
	},
};
