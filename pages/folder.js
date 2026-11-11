const $ = (id) => document.getElementById(id);
const id = new URLSearchParams(location.search).get('id') || '';
let state = null;

function paint() {
	const folder = state.folders.find((f) => f.id === id);
	if (!folder) return;
	$('name').textContent = folder.name;
	$('dot').style.background = folder.color || '';
	const items = state.bookmarks.filter((b) => b.folder === id);
	$('all').disabled = !items.length;
	const list = $('list');
	list.textContent = '';
	if (!items.length) list.append(Object.assign(document.createElement('div'), { className: 'empty', textContent: 'Папка пуста' }));
	for (const b of items) {
		const row = document.createElement('button');
		row.className = 'item';
		row.title = b.title + '\n' + b.url;
		const src = b.customIcon || b.icon;
		const letter = () => Object.assign(document.createElement('span'), { className: 'fav letter', textContent: (b.title.trim()[0] || '•').toUpperCase() });
		let fav;
		if (src) {
			fav = Object.assign(document.createElement('img'), { className: 'fav', src, alt: '' });
			fav.addEventListener('error', () => fav.replaceWith(letter()));
		} else fav = letter();
		let host = '';
		try { host = new URL(b.url).host; } catch (e) { /* не адрес с хостом */ }
		row.append(fav, Object.assign(document.createElement('span'), { className: 'title', textContent: b.title }), Object.assign(document.createElement('span'), { className: 'host', textContent: host }));
		row.addEventListener('click', () => api.folderOpen(b.url, false));
		row.addEventListener('auxclick', (e) => {
			if (e.button === 1) api.folderOpen(b.url, true);
		});
		list.append(row);
	}
	const colors = $('colors');
	colors.textContent = '';
	const swatch = (hex, name) => {
		const s = document.createElement('button');
		s.className = 'sw' + (hex ? '' : ' none') + ((folder.color || '') === hex ? ' on' : '');
		s.title = name;
		if (hex) s.style.background = hex;
		s.addEventListener('click', async () => {
			state = await api.setFolderColor(id, hex);
			paint();
		});
		colors.append(s);
	};
	swatch('', 'Без цвета');
	for (const c of state.colors) swatch(c.hex, c.name);
}

$('all').addEventListener('click', () => api.folderOpenAll(id));
$('del').addEventListener('click', () => api.folderDelete(id));
document.addEventListener('keydown', (e) => {
	if (e.key === 'Escape') window.blur();
});
api.bookmarks().then((s) => {
	state = s;
	paint();
});
