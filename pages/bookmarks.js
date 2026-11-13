const $ = (id) => document.getElementById(id);

let state = { bookmarks: [], folders: [] };
let current = 'all'; // 'all', 'none' (без папки) или id папки
let query = '';
let sort = 'new';
let editingId = null;
let renamingFolderId = null;
let folderColor = '';
let toastTimer = null;

function el(tag, className, text) {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text !== undefined) node.textContent = text;
	return node;
}

function errText(e) {
	return String((e && e.message) || e).replace(/^Error invoking remote method '[^']*': (Error: )?/, '');
}

function folderName(id) {
	const f = state.folders.find((x) => x.id === id);
	return f ? f.name : '';
}

function normalizeUrl(text) {
	const t = text.trim();
	if (!t) return '';
	if (/^localhost(:\d+)?([/?#]|$)/i.test(t)) return 'http://' + t;
	return /^[a-z][a-z0-9+.-]*:/i.test(t) ? t : 'https://' + t;
}

// ---------- Уведомление с кнопкой «Отменить» ----------

function hideToast() {
	clearTimeout(toastTimer);
	$('toast').classList.add('hidden');
}

function showToast(text, undo) {
	clearTimeout(toastTimer);
	$('toast-text').textContent = text;
	$('toast-undo').classList.toggle('hidden', !undo);
	$('toast-undo').onclick = async () => {
		hideToast();
		if (!undo) return;
		try {
			await undo();
		} catch (e) {
			showToast(errText(e));
		}
	};
	$('toast').classList.remove('hidden');
	toastTimer = setTimeout(hideToast, 6000);
}

// Выполняет действие и показывает новое состояние закладок
async function act(fn) {
	try {
		state = await fn();
		render();
	} catch (e) {
		showToast(errText(e));
	}
}

// ---------- Отрисовка ----------

function visibleBookmarks() {
	let list = state.bookmarks;
	if (current === 'none') list = list.filter((b) => !b.folder);
	else if (current !== 'all') list = list.filter((b) => b.folder === current);
	const q = query.trim().toLowerCase();
	if (q) list = list.filter((b) => b.title.toLowerCase().includes(q) || b.url.toLowerCase().includes(q));
	list = list.slice();
	if (sort === 'title') list.sort((a, b) => a.title.localeCompare(b.title, 'ru'));
	else if (sort === 'old') list.sort((a, b) => a.added - b.added);
	else list.sort((a, b) => b.added - a.added);
	return list;
}

function navItem(id, label, count, folder) {
	const item = el('div', 'nav-item' + (current === id ? ' active' : ''));
	if (folder) {
		const dot = el('span', 'nav-dot');
		if (folder.color) dot.style.background = folder.color;
		item.append(dot);
	}
	item.append(el('span', 'nav-label', label), el('span', 'nav-count', String(count)));
	item.addEventListener('click', () => {
		current = id;
		render();
	});

	// Закладку можно перетащить на папку или на «Без папки»
	if (id !== 'all') {
		item.addEventListener('dragover', (e) => {
			e.preventDefault();
			item.classList.add('drop');
		});
		item.addEventListener('dragleave', () => item.classList.remove('drop'));
		item.addEventListener('drop', (e) => {
			e.preventDefault();
			item.classList.remove('drop');
			const bookmarkId = e.dataTransfer.getData('text/plain');
			if (bookmarkId) act(() => api.updateBookmark(bookmarkId, { folder: id === 'none' ? null : id }));
		});
	}

	if (folder) {
		const rename = el('button', 'mini', '✎');
		rename.title = 'Переименовать';
		rename.addEventListener('click', (e) => {
			e.stopPropagation();
			openFolderDialog(folder);
		});
		const remove = el('button', 'mini', '✕');
		remove.title = 'Удалить папку';
		remove.addEventListener('click', (e) => {
			e.stopPropagation();
			removeFolder(folder);
		});
		item.append(rename, remove);
	}
	return item;
}

function renderNav() {
	const nav = $('nav');
	nav.textContent = '';
	nav.append(navItem('all', 'Все закладки', state.bookmarks.length));
	nav.append(navItem('none', 'Без папки', state.bookmarks.filter((b) => !b.folder).length));
	if (state.folders.length) nav.append(el('div', 'nav-sep', 'Папки'));
	for (const f of state.folders) {
		nav.append(navItem(f.id, f.name, state.bookmarks.filter((b) => b.folder === f.id).length, f));
	}
}

function favicon(b) {
	const letter = () => el('div', 'fav letter', (b.title.trim()[0] || '?').toUpperCase());
	const src = b.customIcon || b.icon;
	if (!src) return letter();
	const img = el('img', 'fav');
	img.src = src;
	img.alt = '';
	img.addEventListener('error', () => img.replaceWith(letter()));
	return img;
}

let bmNew = false; // открывать закладки в новой вкладке
const refreshBmNew = () => api.getSettings().then((r) => { bmNew = !!r.settings.bmNewTab; }).catch(() => {});
refreshBmNew();
window.addEventListener('focus', refreshBmNew);

function renderRow(b) {
	const row = el('div', 'item');
	row.draggable = true;
	row.addEventListener('dragstart', (e) => {
		e.dataTransfer.setData('text/plain', b.id);
		e.dataTransfer.effectAllowed = 'move';
	});

	const link = el('a', 'info');
	link.href = b.url;
	link.draggable = false; // тащим всю строку, а не ссылку
	link.addEventListener('click', () => { link.target = bmNew ? '_blank' : ''; });
	link.append(el('span', 'title', b.title), el('span', 'url', b.url));
	row.append(favicon(b), link);

	if (b.folder && current === 'all') row.append(el('span', 'chip', folderName(b.folder)));

	const edit = el('button', 'icon-btn', '✎');
	edit.title = 'Изменить';
	edit.addEventListener('click', () => openEdit(b));
	const remove = el('button', 'icon-btn', '✕');
	remove.title = 'Удалить';
	remove.addEventListener('click', () => removeBookmark(b));
	row.append(edit, remove);
	return row;
}

function renderList() {
	const list = $('list');
	list.textContent = '';
	const items = visibleBookmarks();
	if (!items.length) {
		const empty = el('div', 'empty');
		if (state.bookmarks.length) {
			empty.append(el('div', '', 'Ничего не найдено'));
		} else {
			empty.append(el('div', '', 'Закладок пока нет'), el('div', '', 'Нажми ☆ в адресной строке (Ctrl+D) или кнопку «Добавить»'));
		}
		list.append(empty);
		return;
	}
	for (const b of items) list.append(renderRow(b));
}

function render() {
	if (current !== 'all' && current !== 'none' && !state.folders.some((f) => f.id === current)) current = 'all';
	renderNav();
	renderList();
}

// ---------- Действия ----------

async function removeBookmark(b) {
	try {
		state = await api.removeBookmark(b.id);
		render();
		showToast('Закладка удалена', async () => {
			state = await api.restoreBookmark(b);
			render();
		});
	} catch (e) {
		showToast(errText(e));
	}
}

async function removeFolder(f) {
	if (!confirm(probletTr('Удалить папку «' + f.name + '»? Закладки из неё останутся в разделе «Без папки».'))) return;
	await act(() => api.removeFolder(f.id));
}

// ---------- Окно закладки ----------

function fillFolderSelect(selected) {
	const select = $('f-folder');
	select.textContent = '';
	const none = el('option', '', 'Без папки');
	none.value = '';
	select.append(none);
	for (const f of state.folders) {
		const option = el('option', '', f.name);
		option.value = f.id;
		select.append(option);
	}
	select.value = selected || '';
}

function openEdit(b) {
	editingId = b ? b.id : null;
	$('edit-title').textContent = b ? 'Изменить закладку' : 'Новая закладка';
	$('f-title').value = b ? b.title : '';
	$('f-url').value = b ? b.url : '';
	fillFolderSelect(b ? b.folder : current !== 'all' && current !== 'none' ? current : null);
	$('edit-error').textContent = '';
	$('edit-dialog').showModal();
	(b ? $('f-title') : $('f-url')).focus();
}

$('edit-form').addEventListener('submit', async (e) => {
	e.preventDefault();
	const payload = { title: $('f-title').value, url: normalizeUrl($('f-url').value), folder: $('f-folder').value || null };
	try {
		state = editingId ? await api.updateBookmark(editingId, payload) : await api.addBookmark(payload);
		$('edit-dialog').close();
		render();
	} catch (err) {
		$('edit-error').textContent = errText(err);
	}
});
$('edit-cancel').addEventListener('click', () => $('edit-dialog').close());

// ---------- Окно папки ----------

function openFolderDialog(folder) {
	renamingFolderId = folder ? folder.id : null;
	$('folder-title').textContent = folder ? 'Переименовать папку' : 'Новая папка';
	$('folder-name').value = folder ? folder.name : '';
	folderColor = folder ? folder.color || '' : '';
	renderFolderColors();
	$('folder-error').textContent = '';
	$('folder-dialog').showModal();
	$('folder-name').focus();
	$('folder-name').select();
}

function renderFolderColors() {
	const box = $('folder-colors');
	box.textContent = '';
	for (const c of [{ hex: '', name: 'Без цвета' }, ...state.colors]) {
		const s = el('button', 'sw' + (c.hex ? '' : ' none') + (folderColor === c.hex ? ' on' : ''));
		s.type = 'button';
		s.title = c.name;
		if (c.hex) s.style.background = c.hex;
		s.addEventListener('click', () => {
			folderColor = c.hex;
			renderFolderColors();
		});
		box.append(s);
	}
}

$('folder-form').addEventListener('submit', async (e) => {
	e.preventDefault();
	const name = $('folder-name').value;
	try {
		state = renamingFolderId ? await api.renameFolder(renamingFolderId, name) : await api.addFolder(name);
		const saved = renamingFolderId ? state.folders.find((f) => f.id === renamingFolderId) : state.folders.find((f) => f.name.toLowerCase() === name.trim().toLowerCase());
		if (saved && (saved.color || '') !== folderColor) state = await api.setFolderColor(saved.id, folderColor);
		$('folder-dialog').close();
		render();
	} catch (err) {
		$('folder-error').textContent = errText(err);
	}
});
$('folder-cancel').addEventListener('click', () => $('folder-dialog').close());

// ---------- Верхняя панель ----------

$('new-folder').addEventListener('click', () => openFolderDialog(null));
$('add').addEventListener('click', () => openEdit(null));
$('search').addEventListener('input', (e) => {
	query = e.target.value;
	renderList();
});
$('sort').addEventListener('change', (e) => {
	sort = e.target.value;
	renderList();
});

// problet://bookmarks/?edit=<id> — сразу открыть окно изменения закладки (так открывает пункт меню панели закладок)
act(() => api.bookmarks()).then(() => {
	const params = new URLSearchParams(location.search);
	const id = params.get('edit');
	const target = id && state && state.bookmarks.find((x) => x.id === id);
	if (target) openEdit(target);
	const folder = params.get('folder');
	if (folder && state && state.folders.some((f) => f.id === folder)) {
		current = folder;
		render();
	}
});

// Закладки могли измениться в другой вкладке: перечитываем, если человек сейчас не вводит что-то в окне
api.onChange((kinds) => {
	if (!kinds.includes('bookmarks') && !kinds.includes('all')) return;
	const el = document.activeElement;
	if (el && el.tagName === 'INPUT' && el.id !== 'search') return;
	act(() => api.bookmarks());
});
