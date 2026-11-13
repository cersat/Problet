const $ = (id) => document.getElementById(id);
let st = { exists: false, unlocked: false, pending: [], min: 8 };
let items = [];

function say(text, bad) {
	$('status').textContent = text || '';
	$('status').className = bad ? 'status bad' : 'status';
}

function errText(e) {
	return String((e && e.message) || e).replace(/^Error invoking remote method '[^']*': (Error: )?/, '');
}

async function run(fn) {
	try {
		await fn();
	} catch (e) {
		say(errText(e), true);
	}
}

function el(tag, cls, text) {
	const e = document.createElement(tag);
	if (cls) e.className = cls;
	if (text !== undefined) e.textContent = text;
	return e;
}

function btn(text, onClick, cls) {
	const b = el('button', cls, text);
	b.type = 'button';
	b.addEventListener('click', () => run(onClick));
	return b;
}

function hostOf(origin) {
	try {
		return new URL(origin).host;
	} catch (e) {
		return origin;
	}
}

async function refresh() {
	st = await api.pwStatus();
	const gate = !st.unlocked;
	$('gate').classList.toggle('hidden', !gate);
	$('vault').classList.toggle('hidden', gate);
	$('lock').classList.toggle('hidden', gate);
	$('change-open').classList.toggle('hidden', gate);
	if (gate) {
		$('change').classList.add('hidden');
		$('gate-title').textContent = st.exists ? 'Хранилище закрыто' : 'Создай мастер-пароль';
		$('gate-hint').textContent = st.exists
			? 'Введи мастер-пароль, чтобы увидеть и подставлять пароли'
			: 'Он шифрует все пароли и нигде не хранится. Забудешь его, и пароли восстановить будет нельзя. Не короче ' + st.min + ' символов';
		$('master2').classList.toggle('hidden', st.exists);
		$('gate-go').textContent = st.exists ? 'Открыть' : 'Создать хранилище';
		$('master').value = '';
		$('master2').value = '';
		return;
	}
	items = await api.pwList();
	renderPending();
	renderList();
}

function renderPending() {
	const box = $('pending');
	box.textContent = '';
	$('pending-box').classList.toggle('hidden', !st.pending.length);
	for (const p of st.pending) {
		const row = el('div', 'item');
		const info = el('div', 'info');
		info.append(el('b', '', hostOf(p.origin)), el('span', '', (p.update ? 'новый пароль для ' : '') + (p.username || 'без логина')));
		row.append(info, btn(p.update ? 'Обновить' : 'Сохранить', async () => {
			await api.pwPendingSave(p.tabId);
			say('Сохранено');
			await refresh();
		}, 'primary'), btn('Не сохранять', async () => {
			await api.pwPendingDrop(p.tabId);
			await refresh();
		}));
		box.append(row);
	}
}

function renderList() {
	const words = $('search').value.toLowerCase().split(/\s+/).filter(Boolean);
	const shown = items.filter((i) => words.every((w) => (i.origin + ' ' + i.username).toLowerCase().includes(w)));
	const box = $('list');
	box.textContent = '';
	if (!shown.length) {
		box.append(el('p', 'empty', items.length ? 'Ничего не найдено' : 'Паролей пока нет. Они появятся, когда ты войдёшь на сайте и нажмёшь на значок ключа в адресной строке'));
		return;
	}
	for (const i of shown) box.append(itemRow(i));
}

function itemRow(i) {
	const row = el('div', 'item');
	const info = el('div', 'info');
	info.append(el('b', '', hostOf(i.origin)), el('span', '', i.username || 'без логина'));
	const pass = el('code', 'pass', '••••••••');
	let shown = false;
	const actions = el('div', 'actions');
	const show = btn('Показать', async () => {
		if (shown) {
			pass.textContent = '••••••••';
			show.textContent = 'Показать';
		} else {
			pass.textContent = await api.pwReveal(i.id);
			show.textContent = 'Скрыть';
		}
		shown = !shown;
	});
	actions.append(show,
		btn('Копировать', async () => {
			await navigator.clipboard.writeText(await api.pwReveal(i.id));
			say('Пароль для ' + hostOf(i.origin) + ' скопирован');
		}),
		btn('Изменить', async () => edit(row, i)),
		btn('Удалить', async () => {
			if (!confirm(probletTr('Удалить пароль для ' + hostOf(i.origin) + '?'))) return;
			await api.pwRemove(i.id);
			await refresh();
		}, 'danger'));
	row.append(info, pass, actions);
	return row;
}

async function edit(row, i) {
	const pass = await api.pwReveal(i.id);
	row.textContent = '';
	row.classList.add('editing');
	const user = el('input');
	user.type = 'text';
	user.value = i.username;
	user.placeholder = 'Логин';
	const pw = el('input');
	pw.type = 'text';
	pw.value = pass;
	pw.placeholder = 'Пароль';
	row.append(el('div', 'info', hostOf(i.origin)), user, pw, btn('Сохранить', async () => {
		await api.pwUpdate(i.id, { username: user.value, password: pw.value });
		say('Сохранено');
		await refresh();
	}, 'primary'), btn('Отмена', refresh));
}

$('gate').addEventListener('submit', (e) => {
	e.preventDefault();
	run(async () => {
		if (st.exists) {
			await api.pwUnlock($('master').value);
		} else {
			if ($('master').value !== $('master2').value) throw new Error('Пароли не совпадают');
			await api.pwCreate($('master').value);
		}
		say('');
		await refresh();
	});
});

$('lock').addEventListener('click', () => run(async () => {
	await api.pwLock();
	say('Хранилище закрыто');
	await refresh();
}));

$('change-open').addEventListener('click', () => $('change').classList.toggle('hidden'));
$('change-cancel').addEventListener('click', () => $('change').classList.add('hidden'));
$('change').addEventListener('submit', (e) => {
	e.preventDefault();
	run(async () => {
		await api.pwChangeMaster($('old-master').value, $('new-master').value);
		$('old-master').value = '';
		$('new-master').value = '';
		$('change').classList.add('hidden');
		say('Мастер-пароль изменён');
	});
});

$('add').addEventListener('submit', (e) => {
	e.preventDefault();
	run(async () => {
		await api.pwAdd({ origin: $('add-site').value.trim(), username: $('add-user').value, password: $('add-pass').value });
		$('add-site').value = '';
		$('add-user').value = '';
		$('add-pass').value = '';
		say('Добавлено');
		await refresh();
	});
});

$('search').addEventListener('input', renderList);

// Хранилище могло запереться само по таймеру: перепроверяем, когда вкладку снова открывают
window.addEventListener('focus', () => run(refresh));
run(refresh);
