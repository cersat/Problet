const $ = (id) => document.getElementById(id);
window.problet.get().then((e) => {
	$('title').textContent = e.title;
	$('text').textContent = e.text;
	if (e.fatal) {
		$('hint').classList.add('hidden');
		$('hint-fatal').classList.remove('hidden');
	}
});
$('copy').addEventListener('click', async () => {
	await window.problet.copy();
	$('copy').textContent = 'Скопировано';
	setTimeout(() => { $('copy').textContent = 'Скопировать'; }, 1500);
});
const safeOn = () => {
	$('safe').textContent = 'Безопасный режим включён';
	$('safe').disabled = true;
};
window.problet.safeState().then((on) => { if (on) safeOn(); });
$('safe').addEventListener('click', async () => {
	if (await window.problet.safeMode()) safeOn();
});
$('close').addEventListener('click', () => window.problet.close());
document.addEventListener('keydown', (e) => {
	if (e.key === 'Escape') window.problet.close();
});
