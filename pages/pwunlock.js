const $ = (id) => document.getElementById(id);
$('master').focus();
$('cancel').addEventListener('click', () => api.panelClose());
$('f').addEventListener('submit', async (e) => {
	e.preventDefault();
	try {
		await api.pwUnlock($('master').value);
	} catch (err) {
		$('err').textContent = 'Неверный мастер-пароль';
		$('master').select();
		return;
	}
	await api.pwFillRetry();
	api.panelClose();
});
