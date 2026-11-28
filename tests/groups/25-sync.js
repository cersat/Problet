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
			// Раздел идёт сразу после «Главной», поля входа не вылезают за него
			const lay = await a.fe(`(() => { const cats = [...d.querySelectorAll('#cats button')].map((x) => x.textContent); const i = cats.indexOf('Синхронизация'); d.querySelectorAll('#cats button')[i].click(); const sec = d.getElementById('sync-out').closest('section').getBoundingClientRect(); const bad = [...d.querySelectorAll('#sync-out input, #sync-out button')].filter((e) => { const r = e.getBoundingClientRect(); return r.right > sec.right + 0.5 || r.left < sec.left - 0.5; }).map((e) => e.id); const tops = ['sync-nick', 'sync-pass', 'sync-pass2'].map((id) => Math.round(d.getElementById(id).getBoundingClientRect().top)); if (new Set(tops).size === 3) bad.length += 0; else bad.push('поля в одной строке'); return { cats: cats.slice(0, 3), bad }; })()`);
			t.check('«Синхронизация» второй раздел, сразу после «Главной»', lay.cats[0] === 'Главная' && lay.cats[1] === 'Синхронизация', lay.cats);
			t.check('поля и кнопки входа не вылезают за раздел', lay.bad.length === 0, lay.bad);

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

			// Пространства: названия переносятся, вкладки нет
			await ap(`setSettings({ syncSpaces: true, spacesMerged: true })`); // в объединённом режиме добавление пространства не уводит со страницы
			await bp(`setSettings({ syncSpaces: true, spacesMerged: true })`);
			const sid = await ap(`spacesAdd('Работа')`);
			await ap(`syncNow()`);
			await bp(`syncNow()`);
			let bs = await bp(`spaces()`);
			t.check('пространство пришло на второе устройство', bs.spaces.some((x) => x.id === sid && x.name === 'Работа'), bs.spaces);
			t.check('вкладки пространств между устройствами не ходят', bs.spaces.find((x) => x.id === sid).count === 0, bs.spaces);
			await ap(`spacesRename(${JSON.stringify(sid)}, 'Учёба')`);
			await ap(`syncNow()`);
			await bp(`syncNow()`);
			bs = await bp(`spaces()`);
			t.check('переименование пространства дошло', bs.spaces.some((x) => x.id === sid && x.name === 'Учёба'), bs.spaces);
			await ap(`spacesRemove(${JSON.stringify(sid)})`);
			await ap(`syncNow()`);
			await bp(`syncNow()`);
			bs = await bp(`spaces()`);
			t.check('удаление пространства дошло', !bs.spaces.some((x) => x.id === sid), bs.spaces);
			const spRaw = srv.stored('Anna_1', 'spaces');
			t.check('на сервере пространства лежат зашифрованными', spRaw && !/Учёба|Работа/.test(spRaw.data), spRaw);

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
