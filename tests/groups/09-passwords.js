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

		// Шаблоны делятся на юзернеймы и адреса почты: в поле почты — адреса, в поле логина — юзернеймы
		await b.go('problet://passwords/', 800);
		await b.fe(`w.problet.pwLock()`);
		await b.go(base + '/signup3', 1500);
		pg = await b.page((u) => u === base + '/signup3');
		await click(pg, '#un');
		p = await panel('pwfill');
		t.check('/signup3: в поле юзернейма окно есть', !!p);
		if (p) {
			if (await p.ev(`!document.getElementById('lock').hidden`)) {
				await p.ev(`document.getElementById('master').value = 'master12345'; document.getElementById('lock').requestSubmit()`);
				await t.sleep(1000);
			}
			const names = await p.ev(`[...document.querySelectorAll('#items button')].map(b => b.textContent)`).catch(() => []);
			t.check('в поле юзернейма только юзернеймы', names.includes('кот-шаблон') && !names.some((x) => x.includes('@')), names);
			await p.ev(`document.querySelector('.cancel').click()`).catch(() => {});
			await t.sleep(500);
		}
		await click(pg, '#em');
		p = await panel('pwfill');
		if (p) {
			const mails = await p.ev(`[...document.querySelectorAll('#items button')].map(b => b.textContent)`).catch(() => []);
			t.check('в поле почты только адреса', mails.includes('tmpl@example.com') && !mails.includes('кот-шаблон'), mails);
			await p.ev(`document.querySelector('.cancel').click()`).catch(() => {});
			await t.sleep(500);
		}
		t.check('/signup3: окно в поле почты есть', !!p);

		// Придуманный пароль: предлагается на поле нового пароля, подставляется в оба поля, потом предлагается сохранить
		await click(pg, '#pw');
		p = await panel('pwfill');
		t.check('на поле нового пароля предлагается придумать пароль', !!p && (await p.ev(`document.getElementById('title').textContent`)) === 'Придумать пароль?');
		if (p) {
			const first = await p.ev(`document.querySelector('#items button.primary').textContent`);
			t.check('пароль на 20 знаков из букв и цифр', /^[A-Za-z0-9]{20}$/.test(first) && /[a-z]/.test(first) && /[A-Z]/.test(first) && /[0-9]/.test(first), first);
			await p.ev(`document.querySelector('#items button:not(.primary)').click()`);
			await t.sleep(500);
			const second = await p.ev(`document.querySelector('#items button.primary').textContent`);
			t.check('«Другой пароль» даёт новый', second !== first && /^[A-Za-z0-9]{20}$/.test(second), [first, second]);
			await p.ev(`document.querySelector('#items button.primary').click()`);
			await t.sleep(800);
			const vals = await pg.ev(`[document.getElementById('pw').value, document.getElementById('pw2').value]`);
			t.check('пароль подставлен в оба поля', vals[0] === second && vals[1] === second, vals);
			await pg.ev(`document.getElementById('un').value = 'новый-юзер'; document.getElementById('f').requestSubmit()`);
			await t.sleep(2000);
			t.check('придуманный пароль после отправки предлагается сохранить', !!(await panel('pwsave')));
		}

		const old = await panel('pwsave');
		if (old) { await old.ev(`document.getElementById('later').click()`).catch(() => {}); await t.sleep(800); }

		// Сайт без <form>: Enter в поле пароля или кнопка — это отправка, предлагаем сохранить
		await b.go(base + '/loose', 1500);
		pg = await b.page((u) => u === base + '/loose');
		await pg.ev(`document.getElementById('l').value = 'лоуз'; document.getElementById('pw').value = 'лоуз-пароль'`);
		await click(pg, '#go');
		p = await panel('pwsave');
		t.check('без <form> нажатие кнопки тоже предлагает сохранить пароль', !!p);
		if (p) {
			const who = await p.ev(`document.body.textContent`);
			t.check('в предложении логин со страницы', who.includes('лоуз'), who);
		}
	},
};
