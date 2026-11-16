const $ = (id) => document.getElementById(id);
let offer = null;

problet.pwOfferCurrent().then((o) => {
	if (!o) return problet.panelClose();
	offer = o;
	$('title').textContent = o.update ? 'Обновить пароль?' : 'Сохранить пароль?';
	$('site').textContent = new URL(o.origin).hostname;
	$('user').textContent = o.username || 'без логина';
	$('save').textContent = o.update ? 'Обновить' : 'Сохранить';
	if (!o.unlocked) {
		$('master-box').hidden = false;
		$('master2').hidden = o.exists;
		$('master').placeholder = o.exists ? 'Мастер-пароль' : 'Придумай мастер-пароль (от ' + o.min + ' символов)';
		$('master2').placeholder = 'Повтори мастер-пароль';
		$('note').textContent = o.exists ? 'Хранилище закрыто: введи мастер-пароль' : 'Хранилища ещё нет: мастер-пароль защитит сохранённые пароли, забыв его, их не восстановить';
	}
}).catch(() => problet.panelClose());

$('save').addEventListener('click', async () => {
	$('err').textContent = '';
	try {
		if (!offer.unlocked) {
			if (offer.exists) await problet.pwUnlock($('master').value);
			else {
				if ($('master').value !== $('master2').value) throw new Error('Пароли не совпадают');
				await problet.pwCreate($('master').value);
			}
		}
		await problet.pwPendingSave(offer.tabId);
		problet.panelClose();
	} catch (e) {
		$('err').textContent = offer.exists ? 'Неверный мастер-пароль' : String(e.message || e).replace(/^Error invoking remote method '[^']*': (Error: )?/, '');
	}
});
$('later').addEventListener('click', () => problet.panelClose()); // предложение остаётся: ключ в адресной строке
