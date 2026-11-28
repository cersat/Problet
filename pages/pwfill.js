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
	if (o.gen) return showGenerated(o);
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

// Форма создания аккаунта, поле пароля: предлагаем придуманный пароль
function showGenerated(o) {
	$('title').textContent = 'Придумать пароль?';
	$('site').textContent = 'Создание аккаунта на ' + o.host + '. Пароль подставится во все поля пароля, а сохранить его предложим после отправки формы';
	$('items').textContent = '';
	const use = document.createElement('button');
	use.className = 'primary';
	use.style.fontFamily = 'monospace';
	use.textContent = o.password;
	use.addEventListener('click', async () => {
		try {
			await problet.pwFillGenerated();
		} catch (e) { /* страница уже другая */ }
		problet.panelClose();
	});
	const again = document.createElement('button');
	again.textContent = 'Другой пароль';
	again.addEventListener('click', async () => {
		use.textContent = await problet.pwFillRegen();
	});
	$('items').append(use, again);
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
