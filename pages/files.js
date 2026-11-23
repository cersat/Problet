// Проводник Problet: problet://files/?p=<папка>
const $ = (id) => document.getElementById(id);
const I = PROBLET_ICONS;
I.fill();
const params = new URLSearchParams(location.search);
const dir = params.get('p') || '';
const wantSelect = params.get('sel') || ''; // выделить файл после перехода (например, после «Папка выше»)
let data = null;
let shown = []; // записи в том порядке, в каком они на экране
const sel = new Set(); // выделенные пути
let anchor = -1; // от какой строки тянется выделение с Shift
let cursor = -1; // строка с фокусом клавиатуры
let renaming = '';

const pref = (k, def) => {
	try {
		const v = localStorage.getItem('files-' + k);
		return v === null ? def : JSON.parse(v);
	} catch (e) {
		return def;
	}
};
const setPref = (k, v) => {
	try {
		localStorage.setItem('files-' + k, JSON.stringify(v));
	} catch (e) { /* не запомнится */ }
};
let view = pref('view', 'list');
let showHidden = pref('hidden', false);
const sort = pref('sort', { key: 'name', desc: false });

// ---------- Значки по типу файла ----------
const TYPES = {
	img: 'png jpg jpeg gif webp bmp ico svg avif heic',
	code: 'js mjs ts json html htm css xml py c cpp h hpp java rs go sh md yml yaml toml ini conf',
	doc: 'pdf doc docx odt txt rtf xls xlsx ods csv ppt pptx odp',
	arc: 'zip rar 7z tar gz xz bz2 zst iso deb rpm appimage exe msi dmg',
	media: 'mp3 wav flac ogg opus m4a aac mp4 mkv webm avi mov',
};
const extOf = (name) => (name.includes('.') ? name.split('.').pop().toLowerCase() : '');
function kind(e) {
	if (e.dir) return 'dir';
	const ext = extOf(e.name);
	for (const [k, list] of Object.entries(TYPES)) if (list.split(' ').includes(ext)) return k;
	return '';
}
const FILE = '<path class="body" d="M6.5 2.5h7.2l4.8 4.8V19a2 2 0 01-2 2h-10a2 2 0 01-2-2V4.5a2 2 0 012-2z"/><path class="fold" d="M13.7 2.5v3.8a1 1 0 001 1h3.8"/>';
const GLYPHS = {
	dir: '<path class="back" d="M3 6.5a2 2 0 012-2h4.2l2 2.2H19a2 2 0 012 2V9H3z"/><path class="body" d="M3 9.5a2 2 0 012-2h14a2 2 0 012 2V18a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>',
	img: FILE + '<circle class="mark" cx="10" cy="11.2" r="1.3"/><path class="line" d="M6.8 18l3.5-3.6 2.4 2.4 1.6-1.6 2.4 2.8"/>',
	code: FILE + '<path class="line" d="M10.2 11.4l-2.4 2.6 2.4 2.6M13.8 11.4l2.4 2.6-2.4 2.6"/>',
	doc: FILE + '<path class="line" d="M8.2 11.5h7.6M8.2 14.2h7.6M8.2 16.9h4.6"/>',
	arc: FILE + '<path class="line" d="M12 7.5v1.6M12 10.4v1.6M12 13.3v1.6"/><rect class="mark" x="10.6" y="16" width="2.8" height="2.6" rx="0.8"/>',
	media: FILE + '<path class="mark" d="M10 11v6.5l5.2-3.25z"/>',
	'': FILE,
};
function iconEl(e, big) {
	const ico = document.createElement('div');
	ico.className = 'ico ' + kind(e) + (big ? ' big' : '');
	const k = kind(e);
	if (big && k === 'img' && e.size < 60 * 1024 * 1024) {
		// Превью отдаёт браузер (странице problet:// нельзя грузить file:// напрямую); пока грузится — обычный значок
		ico.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + GLYPHS.img + '</svg>';
		thumbFor(e.path).then((src) => {
			if (!src) return;
			const img = document.createElement('img');
			img.alt = '';
			img.src = src;
			img.addEventListener('load', () => {
				ico.textContent = '';
				ico.append(img);
				ico.classList.add('thumb');
			});
		});
		return ico;
	}
	ico.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + GLYPHS[k] + '</svg>';
	const ext = !k && !e.dir ? extOf(e.name).slice(0, 4).toUpperCase() : '';
	if (ext) ico.append(Object.assign(document.createElement('span'), { className: 'ext', textContent: ext }));
	return ico;
}

// Превью по очереди (не больше 4 одновременно), с запоминанием на время страницы
const thumbs = new Map();
let thumbBusy = 0;
const thumbQueue = [];
function thumbFor(p) {
	if (thumbs.has(p)) return thumbs.get(p);
	const job = new Promise((resolve) => thumbQueue.push({ p, resolve }));
	thumbs.set(p, job);
	pumpThumbs();
	return job;
}
function pumpThumbs() {
	while (thumbBusy < 4 && thumbQueue.length) {
		const { p, resolve } = thumbQueue.shift();
		thumbBusy++;
		problet.filesThumb(p).catch(() => '').then((src) => {
			thumbBusy--;
			resolve(src);
			pumpThumbs();
		});
	}
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
const fmtDate = (t) => new Date(t).toLocaleString(probletLocale(), { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
const go = (p, select) => {
	location.href = 'problet://files/?p=' + encodeURIComponent(p) + (select ? '&sel=' + encodeURIComponent(select) : '');
};
let msgTimer = 0;
function say(text, bad) {
	const m = $('msg');
	m.textContent = text;
	m.classList.toggle('bad', !!bad);
	clearTimeout(msgTimer);
	msgTimer = setTimeout(() => { m.textContent = ''; }, 5000);
}
const EN = document.documentElement.dataset.lang === 'en';
const tr = (t) => (window.probletTr ? window.probletTr(t) : t); // строки внутри translate="no", которые всё же надо перевести
const errText = (e) => String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

// ---------- Путь: «хлебные крошки» и ввод пути ----------
function crumbs() {
	const nav = $('crumbs');
	nav.textContent = '';
	if (data.virtual) {
		nav.append(Object.assign(document.createElement('a'), { textContent: tr(data.path), translate: false }));
		return;
	}
	const sep = data.path.includes('\\') ? '\\' : '/';
	const parts = data.path.split(sep).filter(Boolean);
	const items = [];
	if (data.root) items.push([tr('Этот компьютер'), data.root]);
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
		if (i && !(sep === '/' && i === 1)) nav.insertAdjacentHTML('beforeend', '<span class="sep">' + I.icon('chevronRight', { size: 14 }) + '</span>');
		const a = document.createElement('a');
		a.textContent = label;
		a.title = p;
		a.translate = false; // имена папок — данные, их не переводим
		a.addEventListener('click', (ev) => {
			ev.stopPropagation();
			go(p);
		});
		a.addEventListener('dragover', (ev) => dragOver(ev, p));
		a.addEventListener('drop', (ev) => dropOn(ev, p));
		nav.append(a);
	});
	nav.scrollLeft = nav.scrollWidth;
}
function editPath() {
	if (!data) return;
	const inp = $('path');
	$('crumbs').classList.add('hidden');
	inp.classList.remove('hidden');
	inp.value = data.virtual ? '' : data.path;
	inp.focus();
	inp.select();
}
function stopEditPath() {
	$('path').classList.add('hidden');
	$('crumbs').classList.remove('hidden');
}
$('where').addEventListener('click', (e) => {
	if (e.target === $('where') || e.target === $('crumbs')) editPath();
});
$('path').addEventListener('keydown', (e) => {
	if (e.key === 'Enter' && $('path').value.trim()) go($('path').value.trim());
	else if (e.key === 'Escape') {
		stopEditPath();
		$('list').focus();
	}
});
$('path').addEventListener('blur', stopEditPath);

// ---------- Боковая панель ----------
async function side() {
	let s;
	try {
		s = await problet.filesPlaces();
	} catch (e) {
		return;
	}
	const box = $('side');
	box.textContent = '';
	const group = (title, items, removable) => {
		if (!items.length) return;
		box.append(Object.assign(document.createElement('h3'), { textContent: title }));
		for (const it of items) {
			const a = document.createElement('a');
			a.className = 'place' + (data && !data.virtual && data.path === it.path ? ' on' : '');
			a.title = it.path;
			a.innerHTML = I.icon(it.icon || 'folder', { size: 17 });
			const label = Object.assign(document.createElement('span'), { textContent: it.name });
			if (it.own) label.setAttribute('translate', 'no'); // имена дисков и закреплённых папок — как есть
			a.append(label);
			a.addEventListener('click', () => go(it.path));
			a.addEventListener('dragover', (ev) => dragOver(ev, it.path));
			a.addEventListener('drop', (ev) => dropOn(ev, it.path));
			if (removable) {
				const x = document.createElement('button');
				x.className = 'unpin';
				x.title = 'Открепить';
				x.innerHTML = I.icon('close', { size: 13, width: 2 });
				x.addEventListener('click', (ev) => {
					ev.stopPropagation();
					pin(it.path, false);
				});
				a.append(x);
			}
			box.append(a);
		}
	};
	group('Места', s.places);
	group('Закреплённые', s.pins.map((p) => ({ ...p, icon: 'pin', own: true })), true);
	group('Диски', s.drives.map((d) => ({ ...d, own: !/^Корень|^Macintosh/.test(d.name) })));
	const pinned = data && s.pins.some((p) => p.path === data.path);
	$('t-pin').classList.toggle('on', !!pinned);
	$('t-pin').title = pinned ? 'Открепить папку' : 'Закрепить папку в боковой панели';
	$('t-pin').disabled = !data || !!data.virtual;
}
async function pin(p, on) {
	try {
		await problet.filesPin(p, on);
		say(on ? 'Папка закреплена' : 'Папка откреплена');
	} catch (e) {
		say(errText(e), true);
	}
	side();
}

// ---------- Список ----------
function render() {
	const q = $('filter').value.trim().toLowerCase();
	const list = data.entries.filter((e) => (showHidden || !e.hidden) && (!q || e.name.toLowerCase().includes(q)));
	const dirFirst = (a, b) => (a.dir === b.dir ? 0 : a.dir ? -1 : 1);
	list.sort((a, b) => {
		const d = dirFirst(a, b);
		if (d) return d;
		const r = sort.key === 'name' ? a.name.localeCompare(b.name, probletLocale(), { numeric: true, sensitivity: 'base' }) : a[sort.key] - b[sort.key] || a.name.localeCompare(b.name);
		return sort.desc ? -r : r;
	});
	shown = list;
	for (const p of [...sel]) if (!shown.some((e) => e.path === p)) sel.delete(p);
	const box = $('list');
	box.className = view === 'grid' ? 'grid' : 'rows';
	$('head').classList.toggle('hidden', view === 'grid');
	box.textContent = '';
	if (!list.length) box.append(Object.assign(document.createElement('div'), { className: 'empty', textContent: tr(data.error || (q ? 'Ничего не найдено' : 'Папка пуста')) }));
	list.forEach((e, i) => {
		const row = document.createElement('div');
		row.className = 'row' + (sel.has(e.path) ? ' sel' : '') + (i === cursor ? ' cur' : '') + (e.hidden ? ' hid' : '') + (cutSet.has(e.path) ? ' cut' : '');
		row.setAttribute('role', 'option');
		row.setAttribute('aria-selected', String(sel.has(e.path)));
		row.dataset.i = i;
		row.draggable = true;
		const name = document.createElement('div');
		name.className = 'name';
		const label = document.createElement('span');
		label.className = 'label';
		label.textContent = e.name;
		label.title = e.name;
		name.append(iconEl(e, view === 'grid'), label);
		row.append(name);
		if (view !== 'grid') {
			row.append(Object.assign(document.createElement('div'), { className: 'size', textContent: e.dir ? '' : tr(fmtSize(e.size)) }));
			row.append(Object.assign(document.createElement('div'), { className: 'date', textContent: e.mtime ? fmtDate(e.mtime) : '' }));
		} else {
			row.title = e.name + (e.dir ? '' : '\n' + tr(fmtSize(e.size))) + (e.mtime ? '\n' + fmtDate(e.mtime) : '');
		}
		if (e.dir) {
			row.addEventListener('dragover', (ev) => dragOver(ev, e.path));
			row.addEventListener('drop', (ev) => dropOn(ev, e.path));
		}
		box.append(row);
	});
	const folders = list.filter((e) => e.dir).length;
	$('count').textContent = 'Папок: ' + folders + ', файлов: ' + (list.length - folders) + (data.truncated ? ' (показаны первые 5000)' : '');
	for (const b of document.querySelectorAll('.cols.head button')) {
		b.classList.toggle('active', b.dataset.sort === sort.key);
		b.classList.toggle('desc', b.dataset.sort === sort.key && sort.desc);
	}
	$('t-hidden').classList.toggle('on', showHidden);
	$('t-view').dataset.icon = view === 'grid' ? 'list' : 'grid';
	I.fill($('t-view').parentNode);
	status();
}

function status() {
	const items = selected();
	const files = items.filter((e) => !e.dir);
	const total = files.reduce((n, e) => n + e.size, 0);
	$('sel').textContent = items.length ? 'Выбрано: ' + items.length + (files.length ? ' (' + fmtSize(total) + ')' : '') : '';
	const ro = !data || data.virtual || data.writable === false;
	$('t-newfolder').disabled = ro;
	$('t-newfile').disabled = ro;
	$('t-cut').disabled = !items.length || ro;
	$('t-copy').disabled = !items.length;
	$('t-rename').disabled = items.length !== 1 || ro;
	$('t-trash').disabled = !items.length || ro;
	$('t-paste').disabled = !clip.count || ro;
	$('t-terminal').disabled = !data || !!data.virtual;
	$('clipinfo').textContent = clip.count ? (clip.mode === 'cut' ? 'Вырезано: ' : 'Скопировано: ') + clip.count : '';
}
const selected = () => shown.filter((e) => sel.has(e.path));

function paintSel() {
	for (const row of $('list').querySelectorAll('.row')) {
		const i = Number(row.dataset.i);
		const on = sel.has(shown[i].path);
		row.classList.toggle('sel', on);
		row.classList.toggle('cur', i === cursor);
		row.setAttribute('aria-selected', String(on));
	}
	status();
}
function setCursor(i, extend, toggle) {
	if (!shown.length) return;
	i = Math.max(0, Math.min(shown.length - 1, i));
	if (extend && anchor >= 0) {
		sel.clear();
		const [a, b] = anchor < i ? [anchor, i] : [i, anchor];
		for (let k = a; k <= b; k++) sel.add(shown[k].path);
	} else if (toggle) {
		const p = shown[i].path;
		if (sel.has(p)) sel.delete(p);
		else sel.add(p);
		anchor = i;
	} else {
		sel.clear();
		sel.add(shown[i].path);
		anchor = i;
	}
	cursor = i;
	paintSel();
	const row = $('list').querySelector('.row[data-i="' + i + '"]');
	if (row) row.scrollIntoView({ block: 'nearest' });
}

async function load(selectPaths) {
	try {
		data = await problet.filesList(dir);
	} catch (e) {
		$('list').textContent = '';
		$('list').append(Object.assign(document.createElement('div'), { className: 'empty', textContent: 'Не удалось открыть папку' }));
		return;
	}
	document.title = data.path.split(/[\\/]/).filter(Boolean).pop() || data.path;
	$('up').disabled = !data.parent;
	if (selectPaths) {
		sel.clear();
		for (const p of selectPaths) sel.add(p);
	}
	await refreshClip();
	crumbs();
	render();
	if (selectPaths && selectPaths.length) {
		const i = shown.findIndex((e) => e.path === selectPaths[0]);
		if (i >= 0) {
			cursor = i;
			anchor = i;
			paintSel();
			const row = $('list').querySelector('.row[data-i="' + i + '"]');
			if (row) row.scrollIntoView({ block: 'nearest' });
		}
	}
	side();
}

// ---------- Открытие ----------
async function open(e, how) {
	if (e.dir) return go(e.path);
	try {
		const r = await problet.filesLaunch(e.path, how);
		if (r === 'system') say('Открыто программой системы: ' + e.name);
	} catch (err) {
		say(errText(err), true);
	}
}

// ---------- Операции ----------
let clip = { mode: '', count: 0, paths: [] };
let cutSet = new Set();
async function refreshClip() {
	try {
		clip = await problet.filesClip();
	} catch (e) {
		clip = { mode: '', count: 0, paths: [] };
	}
	cutSet = new Set(clip.mode === 'cut' ? clip.paths : []);
}
async function setClip(mode) {
	const items = selected();
	if (!items.length) return;
	clip = await problet.filesClip(mode, items.map((e) => e.path));
	cutSet = new Set(mode === 'cut' ? clip.paths : []);
	render();
	say((mode === 'cut' ? 'Вырезано: ' : 'Скопировано: ') + items.length);
}
async function act(kind, args, okText) {
	try {
		const r = await problet.filesOp(kind, { dir: data && !data.virtual ? data.path : '', ...args });
		if (r && r.errors && r.errors.length) say(r.errors.slice(0, 2).join('; ') + (r.errors.length > 2 ? '…' : ''), true);
		else if (okText) say(okText);
		await load(r && r.select && r.select.length ? r.select : undefined);
		return r;
	} catch (e) {
		say(errText(e), true);
		return null;
	}
}
async function create(isDir) {
	const r = await act(isDir ? 'mkdir' : 'newfile', { name: EN ? (isDir ? 'New folder' : 'New file.txt') : (isDir ? 'Новая папка' : 'Новый файл.txt') });
	if (r && r.select && r.select[0]) startRename(r.select[0]);
}
function startRename(p) {
	const i = shown.findIndex((e) => e.path === p);
	if (i < 0) return;
	const e = shown[i];
	const row = $('list').querySelector('.row[data-i="' + i + '"]');
	const label = row && row.querySelector('.label');
	if (!label) return;
	renaming = p;
	const inp = document.createElement('input');
	inp.className = 'rename';
	inp.value = e.name;
	inp.spellcheck = false;
	label.replaceWith(inp);
	inp.focus();
	const dot = e.dir ? -1 : e.name.lastIndexOf('.');
	inp.setSelectionRange(0, dot > 0 ? dot : e.name.length);
	let done = false;
	const finish = async (save) => {
		if (done) return;
		done = true;
		renaming = '';
		const name = inp.value.trim();
		if (save && name && name !== e.name) await act('rename', { paths: [p], name });
		else render();
		$('list').focus();
	};
	inp.addEventListener('keydown', (ev) => {
		ev.stopPropagation();
		if (ev.key === 'Enter') finish(true);
		else if (ev.key === 'Escape') finish(false);
	});
	inp.addEventListener('blur', () => finish(true));
	inp.addEventListener('click', (ev) => ev.stopPropagation());
	inp.addEventListener('dblclick', (ev) => ev.stopPropagation());
}
function ask(text, yes) {
	return new Promise((resolve) => {
		$('modal-text').textContent = text;
		$('modal-yes').textContent = yes;
		$('modal').classList.remove('hidden');
		$('modal-no').focus();
		const close = (v) => {
			$('modal').classList.add('hidden');
			$('modal-yes').onclick = null;
			$('modal-no').onclick = null;
			$('list').focus();
			resolve(v);
		};
		$('modal-yes').onclick = () => close(true);
		$('modal-no').onclick = () => close(false);
		$('modal').onkeydown = (ev) => {
			if (ev.key === 'Escape') close(false);
		};
	});
}
async function remove(forever) {
	const items = selected();
	if (!items.length) return;
	const what = items.length === 1 ? '«' + items[0].name + '»' : 'выбранное (' + items.length + ')';
	if (forever && !(await ask('Удалить ' + what + ' насовсем? Вернуть из корзины будет нельзя.', 'Удалить'))) return;
	await act(forever ? 'delete' : 'trash', { paths: items.map((e) => e.path) }, forever ? 'Удалено' : 'Перемещено в корзину');
}

// ---------- Перетаскивание: на папку — переместить (с Ctrl — скопировать) ----------
let dragPaths = [];
function dragOver(ev, target) {
	if (!dragPaths.length || dragPaths.includes(target)) return;
	ev.preventDefault();
	ev.dataTransfer.dropEffect = ev.ctrlKey || ev.altKey ? 'copy' : 'move';
	ev.currentTarget.classList.add('drop');
}
async function dropOn(ev, target) {
	ev.preventDefault();
	ev.currentTarget.classList.remove('drop');
	const paths = dragPaths.filter((p) => p !== target);
	dragPaths = [];
	if (!paths.length) return;
	const copy = ev.ctrlKey || ev.altKey;
	await act(copy ? 'copy' : 'move', { paths, dir: target }, (copy ? 'Скопировано: ' : 'Перемещено: ') + paths.length);
}
document.addEventListener('dragleave', (ev) => {
	if (ev.target.classList && ev.target.classList.contains('drop')) ev.target.classList.remove('drop');
});
$('list').addEventListener('dragstart', (ev) => {
	const row = ev.target.closest && ev.target.closest('.row');
	if (!row) return;
	const e = shown[Number(row.dataset.i)];
	if (!sel.has(e.path)) setCursor(Number(row.dataset.i));
	dragPaths = selected().map((x) => x.path);
	ev.dataTransfer.effectAllowed = 'copyMove';
	ev.dataTransfer.setData('text/plain', dragPaths.join('\n'));
});
$('list').addEventListener('dragend', () => {
	dragPaths = [];
	for (const el of document.querySelectorAll('.drop')) el.classList.remove('drop');
});

// ---------- Мышь ----------
$('list').addEventListener('mousedown', (ev) => {
	if (ev.button !== 0 || renaming) return;
	const row = ev.target.closest('.row');
	if (!row) {
		if (!ev.ctrlKey && !ev.shiftKey) {
			sel.clear();
			cursor = -1;
			paintSel();
		}
		return;
	}
	const i = Number(row.dataset.i);
	if (!ev.ctrlKey && !ev.shiftKey && !ev.metaKey && sel.has(shown[i].path) && sel.size > 1) return; // тянут несколько выделенных
	setCursor(i, ev.shiftKey, ev.ctrlKey || ev.metaKey);
});
$('list').addEventListener('click', (ev) => {
	const row = ev.target.closest('.row');
	if (!row || ev.ctrlKey || ev.shiftKey || ev.metaKey || renaming) return;
	const i = Number(row.dataset.i);
	if (sel.size > 1 && sel.has(shown[i].path)) setCursor(i);
});
$('list').addEventListener('dblclick', (ev) => {
	const row = ev.target.closest('.row');
	if (row && !renaming) open(shown[Number(row.dataset.i)]);
});
$('list').addEventListener('auxclick', (ev) => {
	const row = ev.target.closest('.row');
	if (row && ev.button === 1) {
		const e = shown[Number(row.dataset.i)];
		if (e.dir) problet.filesTab(e.path);
		else open(e, 'newtab');
	}
});

// ---------- Контекстное меню ----------
function menu(x, y, items) {
	const m = $('menu');
	m.textContent = '';
	for (const it of items) {
		if (it === '-') {
			m.append(Object.assign(document.createElement('hr')));
			continue;
		}
		const b = document.createElement('button');
		b.setAttribute('role', 'menuitem');
		b.disabled = !!it.disabled;
		b.innerHTML = I.icon(it.icon || 'more', { size: 16 });
		b.append(Object.assign(document.createElement('span'), { textContent: it.label }));
		if (it.key) b.append(Object.assign(document.createElement('kbd'), { textContent: it.key }));
		if (it.danger) b.classList.add('danger');
		b.addEventListener('click', () => {
			hideMenu();
			it.run();
		});
		m.append(b);
	}
	m.classList.remove('hidden');
	const r = m.getBoundingClientRect();
	m.style.left = Math.min(x, innerWidth - r.width - 6) + 'px';
	m.style.top = Math.min(y, innerHeight - r.height - 6) + 'px';
	const first = m.querySelector('button:not(:disabled)');
	if (first) first.focus();
}
const hideMenu = () => $('menu').classList.add('hidden');
document.addEventListener('mousedown', (ev) => {
	if (!ev.target.closest('#menu')) hideMenu();
});
window.addEventListener('blur', hideMenu);
$('list').addEventListener('contextmenu', (ev) => {
	ev.preventDefault();
	if (renaming || !data) return;
	const row = ev.target.closest('.row');
	if (row) {
		const i = Number(row.dataset.i);
		if (!sel.has(shown[i].path)) setCursor(i);
	} else {
		sel.clear();
		paintSel();
	}
	const items = selected();
	const ro = data.virtual || data.writable === false;
	const one = items.length === 1 ? items[0] : null;
	const list = [];
	if (one) {
		list.push({ label: one.dir ? 'Открыть' : 'Открыть', icon: one.dir ? 'folder' : 'external', key: 'Enter', run: () => open(one) });
		if (one.dir) list.push({ label: 'Открыть в новой вкладке', icon: 'plus', run: () => problet.filesTab(one.path) });
		else {
			list.push({ label: 'Открыть во вкладке браузера', icon: 'globe', run: () => open(one, 'tab') });
			list.push({ label: 'Открыть программой системы', icon: 'external', run: () => open(one, 'system') });
			if (/\.(svg|png)$/i.test(one.name)) list.push({ label: 'Открыть в графическом редакторе', icon: 'svgedit', run: () => { location.href = 'problet://svgedit/?p=' + encodeURIComponent(one.path); } });
		}
		list.push('-');
	}
	if (items.length) {
		list.push({ label: 'Вырезать', icon: 'cut', key: 'Ctrl+X', disabled: ro, run: () => setClip('cut') });
		list.push({ label: 'Копировать', icon: 'copy', key: 'Ctrl+C', run: () => setClip('copy') });
	}
	list.push({ label: 'Вставить', icon: 'paste', key: 'Ctrl+V', disabled: ro || !clip.count, run: () => act('paste', {}, 'Вставлено') });
	if (items.length) {
		list.push('-');
		if (one) list.push({ label: 'Переименовать', icon: 'rename', key: 'F2', disabled: ro, run: () => startRename(one.path) });
		list.push({ label: 'Копировать путь', icon: 'link', run: () => act('copy-path', { paths: items.map((e) => e.path) }, 'Путь скопирован') });
		if (one && one.dir) list.push({ label: 'Закрепить в боковой панели', icon: 'pin', run: () => pin(one.path, true) });
		list.push('-');
		list.push({ label: 'В корзину', icon: 'trash', key: 'Delete', disabled: ro, run: () => remove(false) });
		list.push({ label: 'Удалить насовсем', icon: 'trash', key: 'Shift+Del', danger: true, disabled: ro, run: () => remove(true) });
	} else {
		list.push('-');
		list.push({ label: 'Новая папка', icon: 'newFolder', key: 'Ctrl+Shift+N', disabled: ro, run: () => create(true) });
		list.push({ label: 'Новый файл', icon: 'newFile', disabled: ro, run: () => create(false) });
		list.push('-');
		list.push({ label: 'Терминал здесь', icon: 'terminal', disabled: data.virtual, run: () => act('terminal', {}) });
		list.push({ label: 'Копировать путь папки', icon: 'link', disabled: data.virtual, run: () => act('copy-path', { paths: [data.path] }, 'Путь скопирован') });
		list.push({ label: 'Обновить', icon: 'reload', key: 'F5', run: () => load([...sel]) });
	}
	menu(ev.clientX, ev.clientY, list);
});

// ---------- Клавиатура ----------
let typed = '';
let typedAt = 0;
document.addEventListener('keydown', (ev) => {
	if (!$('modal').classList.contains('hidden')) return;
	const inField = ev.target.tagName === 'INPUT';
	const ctrl = ev.ctrlKey || ev.metaKey;
	if (!$('menu').classList.contains('hidden')) {
		if (ev.key === 'Escape') hideMenu();
		else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
			ev.preventDefault();
			const btns = [...$('menu').querySelectorAll('button:not(:disabled)')];
			const k = btns.indexOf(document.activeElement);
			const n = btns[(k + (ev.key === 'ArrowDown' ? 1 : btns.length - 1)) % btns.length];
			if (n) n.focus();
		}
		return;
	}
	if (ctrl && ev.key.toLowerCase() === 'l') {
		ev.preventDefault();
		return editPath();
	}
	if (ctrl && ev.key.toLowerCase() === 'f') {
		ev.preventDefault();
		return $('filter').focus();
	}
	if (ev.key === 'F5') {
		ev.preventDefault();
		return load([...sel]);
	}
	if (ev.altKey && ev.key === 'ArrowLeft') return history.back();
	if (ev.altKey && ev.key === 'ArrowRight') return history.forward();
	if (inField) {
		if (ev.target === $('filter') && (ev.key === 'ArrowDown' || ev.key === 'Enter')) {
			ev.preventDefault();
			$('list').focus();
			setCursor(0);
		} else if (ev.target === $('filter') && ev.key === 'Escape') {
			$('filter').value = '';
			render();
			$('list').focus();
		}
		return;
	}
	if (!data) return;
	const perRow = view === 'grid' ? Math.max(1, Math.floor($('list').clientWidth / 112)) : 1;
	const k = ev.key;
	if ((ev.altKey && k === 'ArrowUp') || k === 'Backspace') {
		ev.preventDefault();
		if (data.parent) go(data.parent, data.virtual ? '' : data.path);
	} else if (k === 'ArrowDown' || k === 'ArrowUp' || (view === 'grid' && (k === 'ArrowLeft' || k === 'ArrowRight'))) {
		ev.preventDefault();
		const step = k === 'ArrowDown' ? perRow : k === 'ArrowUp' ? -perRow : k === 'ArrowRight' ? 1 : -1;
		setCursor(cursor < 0 ? 0 : cursor + step, ev.shiftKey, false);
	} else if (k === 'Home' || k === 'End') {
		ev.preventDefault();
		setCursor(k === 'Home' ? 0 : shown.length - 1, ev.shiftKey, false);
	} else if (k === 'PageDown' || k === 'PageUp') {
		ev.preventDefault();
		const page = Math.max(1, Math.floor($('list').clientHeight / 36)) * perRow;
		setCursor((cursor < 0 ? 0 : cursor) + (k === 'PageDown' ? page : -page), ev.shiftKey, false);
	} else if (k === 'Enter') {
		ev.preventDefault();
		const items = selected();
		if (items.length === 1) open(items[0]);
		else for (const e of items.filter((x) => !x.dir)) open(e, 'newtab');
	} else if (k === ' ' && cursor >= 0) {
		ev.preventDefault();
		setCursor(cursor, false, true);
	} else if (ctrl && k.toLowerCase() === 'a') {
		ev.preventDefault();
		for (const e of shown) sel.add(e.path);
		paintSel();
	} else if (ctrl && k.toLowerCase() === 'c') {
		ev.preventDefault();
		setClip('copy');
	} else if (ctrl && k.toLowerCase() === 'x') {
		ev.preventDefault();
		if (!data.virtual && data.writable !== false) setClip('cut');
	} else if (ctrl && k.toLowerCase() === 'v') {
		ev.preventDefault();
		if (clip.count && !data.virtual) act('paste', {}, 'Вставлено');
	} else if (ctrl && ev.shiftKey && k.toLowerCase() === 'n') {
		ev.preventDefault();
		if (!data.virtual) create(true);
	} else if (ctrl && k.toLowerCase() === 'h') {
		ev.preventDefault();
		toggleHidden();
	} else if (k === 'F2') {
		ev.preventDefault();
		const items = selected();
		if (items.length === 1) startRename(items[0].path);
	} else if (k === 'Delete') {
		ev.preventDefault();
		remove(ev.shiftKey);
	} else if (k === 'Escape') {
		sel.clear();
		paintSel();
	} else if (k.length === 1 && !ctrl && !ev.altKey) {
		// Набор букв — переход к файлу, чьё имя так начинается
		const now = Date.now();
		typed = now - typedAt > 900 ? k.toLowerCase() : typed + k.toLowerCase();
		typedAt = now;
		const i = shown.findIndex((e) => e.name.toLowerCase().startsWith(typed));
		if (i >= 0) setCursor(i);
	}
});

// ---------- Кнопки ----------
const toggleHidden = () => {
	showHidden = !showHidden;
	setPref('hidden', showHidden);
	render();
};
$('back').addEventListener('click', () => history.back());
$('forward').addEventListener('click', () => history.forward());
$('up').addEventListener('click', () => data && data.parent && go(data.parent, data.virtual ? '' : data.path));
$('refresh').addEventListener('click', () => load([...sel]));
$('filter').addEventListener('input', () => data && render());
$('t-newfolder').addEventListener('click', () => create(true));
$('t-newfile').addEventListener('click', () => create(false));
$('t-cut').addEventListener('click', () => setClip('cut'));
$('t-copy').addEventListener('click', () => setClip('copy'));
$('t-paste').addEventListener('click', () => act('paste', {}, 'Вставлено'));
$('t-rename').addEventListener('click', () => {
	const items = selected();
	if (items.length === 1) startRename(items[0].path);
});
$('t-trash').addEventListener('click', (ev) => remove(ev.shiftKey));
$('t-terminal').addEventListener('click', () => act('terminal', {}));
$('t-pin').addEventListener('click', () => data && !data.virtual && pin(data.path, !$('t-pin').classList.contains('on')));
$('t-hidden').addEventListener('click', toggleHidden);
$('t-view').addEventListener('click', () => {
	view = view === 'grid' ? 'list' : 'grid';
	setPref('view', view);
	render();
});
for (const b of document.querySelectorAll('.cols.head button')) {
	b.addEventListener('click', () => {
		sort.desc = sort.key === b.dataset.sort ? !sort.desc : false;
		sort.key = b.dataset.sort;
		setPref('sort', sort);
		if (data) render();
	});
}
// Вернулись на вкладку — содержимое папки могло измениться
window.addEventListener('focus', () => {
	if (data && !renaming) load([...sel]);
});
load(wantSelect ? [wantSelect] : undefined).then(() => $('list').focus());
