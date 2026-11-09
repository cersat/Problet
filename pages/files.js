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
function iconText(e) {
	if (e.dir) return '';
	const ext = e.name.includes('.') ? e.name.split('.').pop().slice(0, 3).toUpperCase() : '';
	return ext;
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
	if (!list.length) box.append(Object.assign(document.createElement('div'), { className: 'empty', textContent: q ? 'Ничего не найдено' : 'Папка пуста' }));
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
		ico.textContent = iconText(e);
		const label = document.createElement('span');
		label.textContent = e.name;
		name.append(ico, label);
		if (!e.dir && /\.svg$/i.test(e.name)) {
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
		$('list').append(Object.assign(document.createElement('div'), { className: 'empty', textContent: 'Не удалось открыть папку: ' + String((e && e.message) || e).replace(/^Error invoking remote method '[^']*': (Error: )?/, '') }));
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
