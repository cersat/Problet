const $ = (id) => document.getElementById(id);
let saved = '';

api.getSettings().then((r) => {
	saved = r.settings.customBlock || '';
	$('list').value = saved;
}).catch((e) => { $('note').textContent = String(e.message || e); });

async function save() {
	try {
		const r = await api.setSettings({ customBlock: $('list').value });
		saved = r.customBlock;
		const n = saved.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#')).length;
		$('note').textContent = 'Сохранено, строк в списке: ' + n;
	} catch (e) {
		$('note').textContent = String(e.message || e);
	}
}

$('save').addEventListener('click', save);
$('list').addEventListener('keydown', (e) => {
	if ((e.ctrlKey || e.metaKey) && e.key === 's') {
		e.preventDefault();
		save();
	}
});
