// Пароли: хранилище на странице паролей, подстановка на форме входа (с вводом мастер-пароля), предложение сохранить
// новый пароль после входа, шаблонные логины на формах регистрации (поле имени не считается логином)
module.exports = {
	title: 'Пароли: хранилище, подстановка, сохранение после входа, шаблоны логинов при регистрации',
	gui: true,
	async run(t) {
		const base = t.server.base;
		const b = await t.browser({ settings: { loginTemplates: ['кот-шаблон', 'tmpl@example.com'] } });
		await b.go('problet://passwords/', 1200);
		await b.fe(`w.problet.pwCreate('master12345')`);
		await b.fe(`w.problet.pwAdd({ origin: ${JSON.stringify(base)}, username: 'кот', password: 'секрет' })`);
		const list = await b.fe(`w.problet.pwList()`);
		t.check('страница паролей: хранилище создаётся, запись добавляется', Array.isArray(list) && list.length === 1 && list[0].username === 'кот', list);
		await b.fe(`w.problet.pwLock()`);
		const st = await b.fe(`w.problet.pwStatus()`);
		t.check('хранилище запирается', st && st.unlocked === false && st.exists === true, st);

		const click = async (pg, sel) => {
			const r = await pg.ev(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
			for (const type of ['mousePressed', 'mouseReleased']) await pg.send('Input.dispatchMouseEvent', { type, x: r[0], y: r[1], button: 'left', clickCount: 1 });
			await t.sleep(1200);
		};
		// Окно-панель (подстановка, сохранение): цель отладки живёт и после закрытия, поэтому смотрим, видно ли оно
		const panel = async (name) => {
			for (const tg of (await b.targets()).filter((x) => x.url.includes(name))) {
				const c = await require('../lib/browser').connect(tg);
				if ((await c.ev('document.visibilityState').catch(() => 'hidden')) === 'visible') return c;
				c.close();
			}
			return null;
		};

		// Подстановка: щёлкнули в поле логина → окно просит мастер-пароль → после него предлагает запись → подставляет
		await b.go(base + '/login', 1500);
		let pg = await b.page((u) => u === base + '/login');
		await click(pg, '#l');
		let p = await panel('pwfill');
		t.check('щелчок в поле логина открывает окно подстановки', !!p);
		if (p) {
			t.check('запертое хранилище просит мастер-пароль', await p.ev(`!document.getElementById('lock').hidden`));
			await p.ev(`document.getElementById('master').value = 'master12345'; document.getElementById('lock').requestSubmit()`);
			await t.sleep(1000);
			const items = await p.ev(`[...document.querySelectorAll('#items button')].map(b => b.textContent)`);
			t.check('после мастер-пароля предлагает запись сайта', items.some((x) => x.includes('кот')), items);
			await p.ev(`[...document.querySelectorAll('#items button')].find(b => b.textContent.includes('кот')).click()`);
			await t.sleep(800);
			const filled = await pg.ev(`[document.getElementById('l').value, document.getElementById('pw').value]`);
			t.check('логин и пароль подставлены', filled[0] === 'кот' && filled[1] === 'секрет', filled);
		}

		// Предложение сохранить: вошли с новым паролем
		await b.go(base + '/login', 1500);
		pg = await b.page((u) => u === base + '/login');
		await pg.ev(`document.getElementById('l').value = 'пёс'; document.getElementById('pw').value = 'новый-пароль'; document.getElementById('f').requestSubmit()`);
		await t.sleep(2000);
		const pending = await b.tb.ev(`problet.pwPendingSave ? problet.pwPendingSave() : null`).catch(() => null);
		p = await panel('pwsave');
		t.check('после входа с новым паролем предлагает сохранить', !!p || !!pending, pending);
		if (p) {
			await p.ev(`document.getElementById('save').click()`);
			await t.sleep(1000);
			await b.go('problet://passwords/', 1200);
			const after = await b.fe(`w.problet.pwList()`);
			t.check('новый пароль сохранён', after.some((x) => x.username === 'пёс'), after.map((x) => x.username));
		}

		// Шаблоны при регистрации: на имени окна нет, на почте после пароля предлагаются шаблоны
		for (const form of ['/signup', '/signup2']) {
			await b.go('problet://passwords/', 800);
			await b.fe(`w.problet.pwLock()`);
			await b.go(base + form, 1500);
			pg = await b.page((u) => u === base + form);
			await click(pg, '#fn');
			t.check(form + ': на поле имени окна подстановки нет', !(await panel('pwfill')));
			await click(pg, '#em');
			p = await panel('pwfill');
			t.check(form + ': на почте окно есть', !!p);
			if (!p) continue;
			if (await p.ev(`!document.getElementById('lock').hidden`)) {
				await p.ev(`document.getElementById('master').value = 'master12345'; document.getElementById('lock').requestSubmit()`);
				await t.sleep(1000);
			}
			const items = await p.ev(`[...document.querySelectorAll('#items button')].map(b => b.textContent)`).catch(() => []);
			t.check(form + ': предлагает шаблонные логины', items.some((x) => x.includes('tmpl@example.com')), items);
			await p.ev(`[...document.querySelectorAll('#items button')].find(b => b.textContent.includes('tmpl@example.com')).click()`).catch(() => {});
			await t.sleep(800);
			const v = await pg.ev(`[document.getElementById('em').value, document.getElementById('fn').value]`);
			t.check(form + ': шаблон подставлен в почту, имя не тронуто', v[0] === 'tmpl@example.com' && v[1] === '', v);
		}
	},
};
