const $ = (id) => document.getElementById(id);
for (const b of document.querySelectorAll('.cancel')) b.addEventListener('click', () => problet.panelClose());

async function show() {
	const o = await problet.pwFillOptions();
	if (!o) return problet.panelClose();
	$('lock').hidden = o.unlocked;
	$('pick').hidden = !o.unlocked;
	if (!o.unlocked) {
		$('master').focus();
		return;
	}
	if (!o.items.length) return problet.panelClose();
	$('title').textContent = o.templates ? 'Подставить логин?' : 'Подставить пароль?';
	$('site').textContent = (o.templates ? 'Создание аккаунта на ' : 'Сайт: ') + o.host;
	$('items').textContent = '';
	for (const it of o.items) {
		const b = document.createElement('button');
		b.className = 'primary';
		b.textContent = it.username || "без логина";
		b.addEventListener('click', async () => {
			try {
				await problet.pwFillPick(it.i);
			} catch (e) { /* страница уже другая */ }
			problet.panelClose();
		});
		$('items').append(b);
	}
}

$('lock').addEventListener('submit', async (e) => {
	e.preventDefault();
	try {
		await problet.pwUnlock($('master').value);
	} catch (err) {
		$('err').textContent = 'Неверный мастер-пароль';
		$('master').select();
		return;
	}
	show();
});

show().catch(() => problet.panelClose());
