const $ = (id) => document.getElementById(id);
window.errApi.get().then((e) => {
	$('title').textContent = e.title;
	$('text').textContent = e.text;
});
$('copy').addEventListener('click', async () => {
	await window.errApi.copy();
	$('copy').textContent = 'Скопировано';
	setTimeout(() => { $('copy').textContent = 'Скопировать'; }, 1500);
});
$('close').addEventListener('click', () => window.errApi.close());
document.addEventListener('keydown', (e) => {
	if (e.key === 'Escape') window.errApi.close();
});
