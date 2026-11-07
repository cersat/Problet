const $ = (id) => document.getElementById(id);
for (const b of document.querySelectorAll('.cancel')) b.addEventListener('click', () => api.panelClose());

async function show() {
	const o = await api.pwFillOptions();
	if (!o) return api.panelClose();
	$('lock').hidden = o.unlocked;
	$('pick').hidden = !o.unlocked;
	if (!o.unlocked) {
		$('master').focus();
		return;
	}
	if (!o.items.length) return api.panelClose();
	$('site').textContent = 'Сайт: ' + o.host;
	$('items').textContent = '';
	for (const it of o.items) {
		const b = document.createElement('button');
		b.className = 'primary';
		b.textContent = it.username || 'без логина';
		b.addEventListener('click', async () => {
			try {
				await api.pwFillPick(it.i);
			} catch (e) { /* страница уже другая */ }
			api.panelClose();
		});
		$('items').append(b);
	}
}

$('lock').addEventListener('submit', async (e) => {
	e.preventDefault();
	try {
		await api.pwUnlock($('master').value);
	} catch (err) {
		$('err').textContent = 'Неверный мастер-пароль';
		$('master').select();
		return;
	}
	show();
});

show().catch(() => api.panelClose());
