// Окошко закладки под ☆: название, папка (или новая папка), удалить
const $ = (id) => document.getElementById(id);
const id = new URLSearchParams(location.search).get('id') || '';
const NEW = '\u0000new';
const clean = (e) => String((e && e.message) || e).replace(/^Error invoking remote method '[^']*': (Error: )?/, '');

api.bmStarGet(id).then((st) => {
	$('head').textContent = st.created ? 'Закладка добавлена' : 'Изменить закладку';
	$('title').value = st.bookmark.title;
	const sel = $('folder');
	sel.append(new Option('Без папки', ''));
	for (const f of st.folders) sel.append(new Option(f.name, f.id));
	sel.append(new Option('Новая папка…', NEW));
	sel.value = st.bookmark.folder;
	$('title').focus();
	$('title').select();
}).catch(() => api.panelClose());

$('folder').addEventListener('change', () => {
	const add = $('folder').value === NEW;
	$('new-folder').hidden = !add;
	if (add) $('new-folder').focus();
});

async function done() {
	$('err').textContent = '';
	const isNew = $('folder').value === NEW;
	const name = $('new-folder').value.trim();
	if (isNew && !name) {
		$('err').textContent = 'Введи название новой папки';
		$('new-folder').focus();
		return;
	}
	try {
		await api.bmStarSave(id, { title: $('title').value, folder: isNew ? '' : $('folder').value, newFolder: isNew ? name : '' });
		api.panelClose();
	} catch (e) {
		$('err').textContent = clean(e);
	}
}
$('done').addEventListener('click', done);
$('remove').addEventListener('click', async () => {
	try {
		await api.bmStarRemove(id);
		api.panelClose();
	} catch (e) {
		$('err').textContent = clean(e);
	}
});
document.addEventListener('keydown', (e) => {
	if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') {
		e.preventDefault();
		done();
	} else if (e.key === 'Escape') api.panelClose();
});
