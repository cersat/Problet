const $ = (id) => document.getElementById(id);
window.problet.get().then((e) => {
	$('title').textContent = e.title;
	$('text').textContent = e.text;
});
$('copy').addEventListener('click', async () => {
	await window.problet.copy();
	$('copy').textContent = 'Скопировано';
	setTimeout(() => { $('copy').textContent = 'Скопировать'; }, 1500);
});
$('close').addEventListener('click', () => window.problet.close());
document.addEventListener('keydown', (e) => {
	if (e.key === 'Escape') window.problet.close();
});
