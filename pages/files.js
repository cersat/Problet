const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
let dir = params.get('p') || '';
let data = null;
const sort = { key: 'name', desc: false };

const TYPES = {
	img: 'png jpg jpeg gif webp bmp ico svg avif heic',
	code: 'js ts json html htm css xml py c cpp h java rs go sh md yml yaml toml ini',
	doc: 'pdf doc docx odt txt rtf xls xlsx csv ppt pptx',
	arc: 'zip rar 7z tar gz xz bz2 iso deb rpm AppImage exe msi dmg',
};
function kind(e) {
	if (e.dir) return 'dir';
	const ext = e.name.includes('.') ? e.name.split('.').pop() : '';
	for (const [k, list] of Object.entries(TYPES)) if (list.split(' ').some((x) => x.toLowerCase() === ext.toLowerCase())) return k;
	return '';
}
// Значки: контур файла с загнутым углом и рисунком по типу; у неизвестных типов на нём расширение
const FILE = '<path class="body" d="M6.5 2.5h7.2l4.8 4.8V19a2 2 0 01-2 2h-10a2 2 0 01-2-2V4.5a2 2 0 012-2z"/><path class="fold" d="M13.7 2.5v3.8a1 1 0 001 1h3.8"/>';
const GLYPHS = {
	dir: '<path class="back" d="M3 6.5a2 2 0 012-2h4.2l2 2.2H19a2 2 0 012 2V9H3z"/><path class="body" d="M3 9.5a2 2 0 012-2h14a2 2 0 012 2V18a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>',
	img: FILE + '<circle class="mark" cx="10" cy="11.2" r="1.3"/><path class="line" d="M6.8 18l3.5-3.6 2.4 2.4 1.6-1.6 2.4 2.8"/>',
	code: FILE + '<path class="line" d="M10.2 11.4l-2.4 2.6 2.4 2.6M13.8 11.4l2.4 2.6-2.4 2.6"/>',
	doc: FILE + '<path class="line" d="M8.2 11.5h7.6M8.2 14.2h7.6M8.2 16.9h4.6"/>',
	arc: FILE + '<path class="line" d="M12 7.5v1.6M12 10.4v1.6M12 13.3v1.6"/><rect class="mark" x="10.6" y="16" width="2.8" height="2.6" rx="0.8"/>',
	'': FILE,
};
function iconHtml(e) {
	return '<svg viewBox="0 0 24 24" aria-hidden="true">' + GLYPHS[kind(e)] + '</svg>';
}
function iconExt(e) {
	return kind(e) || e.dir || !e.name.includes('.') ? '' : e.name.split('.').pop().slice(0, 4).toUpperCase();
}
function fmtSize(n) {
	if (n < 1024) return n + ' Б';
	const u = ['КБ', 'МБ', 'ГБ', 'ТБ'];
	let i = -1;
	do {
		n /= 1024;
		i++;
	} while (n >= 1024 && i < u.length - 1);
	return n.toFixed(n < 10 ? 1 : 0) + ' ' + u[i];
}
const fmtDate = (t) => new Date(t).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
const go = (p) => { location.href = 'problet://files/?p=' + encodeURIComponent(p); };

function crumbs() {
	const nav = $('crumbs');
	nav.textContent = '';
	const sep = data.path.includes('\\') ? '\\' : '/';
	const parts = data.path.split(sep).filter(Boolean);
	const items = [];
	if (sep === '/') {
		items.push(['/', '/']);
		let p = '';
		for (const part of parts) {
			p += '/' + part;
			items.push([part, p]);
		}
	} else {
		let p = '';
		for (const part of parts) {
			p += (p ? sep : '') + part;
			items.push([part, p.length === 2 ? p + sep : p]);
		}
	}
	items.forEach(([label, p], i) => {
		if (i && sep === '/' && i > 1) nav.append(Object.assign(document.createElement('span'), { className: 'sep', textContent: '›' }));
		else if (i && sep !== '/') nav.append(Object.assign(document.createElement('span'), { className: 'sep', textContent: '›' }));
		const a = document.createElement('a');
		a.textContent = label;
		a.addEventListener('click', () => go(p));
		nav.append(a);
	});
	nav.scrollLeft = nav.scrollWidth;
}

function render() {
	const q = $('filter').value.trim().toLowerCase();
	const showHidden = $('hidden').checked;
	let list = data.entries.filter((e) => (showHidden || !e.hidden) && (!q || e.name.toLowerCase().includes(q)));
	const dirFirst = (a, b) => (a.dir === b.dir ? 0 : a.dir ? -1 : 1);
	list.sort((a, b) => {
		const d = dirFirst(a, b);
		if (d) return d;
		const r = sort.key === 'name' ? a.name.localeCompare(b.name, 'ru', { numeric: true, sensitivity: 'base' }) : a[sort.key] - b[sort.key];
		return sort.desc ? -r : r;
	});
	const box = $('list');
	box.textContent = '';
	if (!list.length) box.append(Object.assign(document.createElement('div'), { className: 'empty', textContent: data.error || (q ? 'Ничего не найдено' : 'Папка пуста') }));
	for (const e of list) {
		const row = document.createElement('a');
		row.className = 'row';
		row.setAttribute('role', 'listitem');
		row.href = e.dir ? 'problet://files/?p=' + encodeURIComponent(e.path) : e.url;
		if (!e.dir) {
			row.addEventListener('click', (ev) => {
				ev.preventDefault();
				api.filesOpen(e.path);
			});
		}
		const name = document.createElement('div');
		name.className = 'name';
		const ico = document.createElement('div');
		ico.className = 'ico ' + kind(e);
		ico.innerHTML = iconHtml(e);
		const ext = iconExt(e);
		if (ext) ico.append(Object.assign(document.createElement('span'), { className: 'ext', textContent: ext }));
		const label = document.createElement('span');
		label.textContent = e.name;
		name.append(ico, label);
		if (!e.dir && /\.(svg|png)$/i.test(e.name)) {
			const ed = document.createElement('button');
			ed.className = 'edit';
			ed.textContent = 'Редактировать';
			ed.addEventListener('click', (ev) => {
				ev.preventDefault();
				ev.stopPropagation();
				location.href = 'problet://svgedit/?p=' + encodeURIComponent(e.path);
			});
			name.append(ed);
		}
		const size = Object.assign(document.createElement('div'), { className: 'size', textContent: e.dir ? '' : fmtSize(e.size) });
		const date = Object.assign(document.createElement('div'), { className: 'date', textContent: fmtDate(e.mtime) });
		row.append(name, size, date);
		box.append(row);
	}
	const folders = list.filter((e) => e.dir).length;
	$('info').textContent = 'Папок: ' + folders + ', файлов: ' + (list.length - folders) + (data.truncated ? ' (показаны первые 5000)' : '');
	for (const b of document.querySelectorAll('.cols.head button')) {
		b.classList.toggle('active', b.dataset.sort === sort.key);
		b.classList.toggle('desc', b.dataset.sort === sort.key && sort.desc);
	}
}

async function load() {
	try {
		data = await api.filesList(dir);
	} catch (e) {
		$('list').textContent = '';
		$('list').append(Object.assign(document.createElement('div'), { className: 'empty', textContent: 'Не удалось открыть папку' }));
		return;
	}
	document.title = data.path.split(/[\\/]/).filter(Boolean).pop() || data.path;
	$('up').disabled = !data.parent;
	crumbs();
	render();
}

$('up').addEventListener('click', () => data && data.parent && go(data.parent));
$('home').addEventListener('click', () => data && go(data.home));
$('filter').addEventListener('input', () => data && render());
$('hidden').addEventListener('change', () => data && render());
for (const b of document.querySelectorAll('.cols.head button')) {
	b.addEventListener('click', () => {
		sort.desc = sort.key === b.dataset.sort ? !sort.desc : false;
		sort.key = b.dataset.sort;
		if (data) render();
	});
}
document.addEventListener('keydown', (e) => {
	if (e.key === 'Backspace' && document.activeElement !== $('filter') && data && data.parent) go(data.parent);
});
load();
