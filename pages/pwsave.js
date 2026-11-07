const $ = (id) => document.getElementById(id);
let offer = null;

api.pwOfferCurrent().then((o) => {
	if (!o) return api.panelClose();
	offer = o;
	$('title').textContent = o.update ? 'Обновить пароль?' : 'Сохранить пароль?';
	$('site').textContent = new URL(o.origin).hostname;
	$('user').textContent = o.username || 'без логина';
	$('save').textContent = o.update ? 'Обновить' : 'Сохранить';
	if (!o.unlocked) $('note').textContent = 'Хранилище закрыто: откроется менеджер паролей, там нужно ввести мастер-пароль';
}).catch(() => api.panelClose());

$('save').addEventListener('click', async () => {
	try {
		await api.pwPendingSave(offer.tabId);
	} catch (e) {
		await api.openInNewTab('passwords'); // хранилище закрыто: предложение остаётся ждать в менеджере паролей
	}
	api.panelClose();
});
$('later').addEventListener('click', () => api.panelClose()); // предложение остаётся: ключ в адресной строке
