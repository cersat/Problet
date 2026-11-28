// Страница первого запуска: problet://welcome/ — язык и несколько главных настроек
const $ = (id) => document.getElementById(id);
const FIELDS = ['language', 'darkTheme', 'tabsPos', 'bookmarksBar', 'engine'];

async function save(patch) {
	try {
		await problet.setSettings(patch);
	} catch (e) { /* не записалось: страница настроек покажет то, что есть */ }
}

(async () => {
	const r = await problet.getSettings();
	for (const e of r.engines) {
		const o = document.createElement('option');
		o.value = e.id;
		o.textContent = e.name;
		$('engine').append(o);
	}
	for (const key of FIELDS) {
		const el = $(key);
		const v = r.settings[key];
		if (el.type === 'checkbox') el.checked = !!v;
		else el.value = String(v);
		el.addEventListener('change', () => save({ [key]: el.type === 'checkbox' ? el.checked : el.value }));
	}
})();

$('done').addEventListener('click', () => problet.welcomeDone());
