let layoutState = {};
let barData = { folders: [], bookmarks: [] };
const back = document.getElementById('back');
const forward = document.getElementById('forward');
const reload = document.getElementById('reload');
const box = document.getElementById('address-box');
const address = document.getElementById('address');
const star = document.getElementById('star');
const tabsEl = document.getElementById('tabs');

let currentUrl = '';

// Кириллица и прочие не-ASCII символы показываем читаемо, пока поле не в фокусе. Служебные %20, %2F и т.п. остаются как есть
function pretty(url) {
	return url.replace(/(?:%[89a-f][0-9a-f])+/gi, (m) => {
		try {
			return decodeURIComponent(m);
		} catch (e) {
			return m;
		}
	});
}

// Поле «в фокусе», только пока окно тулбара действительно владеет фокусом (activeElement остаётся и после перехода фокуса на страницу)
const editing = () => document.hasFocus() && document.activeElement === address;

function showAddress(url) {
	address.value = editing() ? url : pretty(url);
}

window.addEventListener('blur', () => {
	if (!dirty) showAddress(currentUrl);
});
window.addEventListener('focus', () => {
	if (!dirty) showAddress(currentUrl);
});
let suggestOpen = false;
let blurTimer = null;
let dirty = false; // true, пока в поле текст, который ввёл сам пользователь

back.addEventListener('click', () => api.back());
forward.addEventListener('click', () => api.forward());
reload.addEventListener('click', () => api.reload());
star.addEventListener('click', () => api.toggleBookmark());
document.getElementById('bookmarks').addEventListener('click', () => api.openInternal('bookmarks'));
document.getElementById('passwords').addEventListener('click', () => api.openInternal('passwords'));
document.getElementById('history').addEventListener('click', () => api.openInternal('history'));
document.getElementById('pwoffer').addEventListener('click', () => api.pwOfferAccept());
document.getElementById('zoom').addEventListener('click', () => api.zoomReset());
document.getElementById('downloads').addEventListener('click', () => api.openInternal('downloads'));
document.getElementById('settings').addEventListener('click', () => api.openInternal('settings'));
document.getElementById('newtab').addEventListener('click', () => api.newTab());
const appletRect = (el) => {
	const r = el.getBoundingClientRect();
	return { x: r.left, y: r.top, width: r.width, height: r.height };
};
for (const kind of ['chars', 'spaces']) {
	const btn = document.getElementById(kind);
	btn.addEventListener('click', () => api.openApplet(kind, appletRect(btn)));
}
document.getElementById('newtab').addEventListener('contextmenu', (e) => {
	e.preventDefault();
	api.newTabMenu();
});
document.getElementById('win-min').addEventListener('click', () => api.winMinimize());
document.getElementById('win-max').addEventListener('click', () => api.winMaximize());
document.getElementById('win-close').addEventListener('click', () => api.winClose());

// ---------- Вкладки ----------

function tabLabel(t, showUrl) {
	const isNew = t.url.startsWith('problet://newtab');
	if (isNew) return 'Новая вкладка';
	if (showUrl) return t.url || t.title || 'Новая вкладка';
	return t.title || t.url || 'Загрузка…';
}

function makeTab(t, state) {
	const el = document.createElement('div');
	el.className = 'tab' + (t.id === state.activeId ? ' active' : '') + (t.pinned ? ' pinned' : '') + (t.incognito ? ' incognito' : '') + (t.frozen ? ' frozen' : '');
	el.draggable = true;
	el.dataset.id = t.id;
	const label = tabLabel(t, state.showUrl);
	el.title = label;

	// Пока вкладка грузится, крутится её иконка; если иконки выключены — индикатор
	const spinning = t.loading ? ' spinning' : '';
	if (state.showIcons) {
		const letter = () => {
			const f = document.createElement('span');
			f.className = 'fav letter' + spinning;
			f.textContent = (label.replace(/^\W+/, '')[0] || '•').toUpperCase();
			return f;
		};
		if (t.icon) {
			const img = document.createElement('img');
			img.className = 'fav' + spinning;
			img.src = t.icon;
			img.addEventListener('error', () => img.replaceWith(letter()));
			el.append(img);
		} else {
			el.append(letter());
		}
	} else if (t.loading) {
		const spin = document.createElement('span');
		spin.className = 'spin';
		el.append(spin);
	}

	if (t.incognito) {
		const mark = document.createElement('span');
		mark.className = 'incog';
		mark.title = 'Режим инкогнито';
		mark.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"><path d="M3 11h18M6 11l1.5-6h9L18 11"/><circle cx="8" cy="16" r="2.5"/><circle cx="16" cy="16" r="2.5"/><path d="M10.5 16h3"/></svg>';
		el.append(mark);
	}
	const text = document.createElement('span');
	text.className = 'label';
	if (t.space && !t.pinned) {
		text.classList.add('two');
		const name = document.createElement('span');
		name.className = 't';
		name.textContent = label;
		const sp = document.createElement('small');
		sp.className = 'sp';
		sp.textContent = t.space;
		text.append(name, sp);
		el.title = label + ' — ' + t.space;
	} else {
		text.textContent = label;
	}
	const close = document.createElement('button');
	close.className = 'close';
	close.dataset.close = t.id;
	close.title = 'Закрыть вкладку (Ctrl+W)';
	close.textContent = '×';
	el.append(text, close);
	return el;
}

let sideTabs = false;

api.onTabs((state) => {
	sideTabs = !!state.side;
	tabsEl.classList.toggle('side', sideTabs);
	tabsEl.classList.toggle('scroll', state.overflow === 'scroll' && !sideTabs);
	tabsEl.style.setProperty('--n', state.tabs.length);
	if (state.space) {
		document.getElementById('space-name').textContent = state.space.name;
		document.getElementById('spaces').title = 'Пространство: ' + state.space.name;
	}
	tabsEl.textContent = '';
	for (const t of state.tabs) tabsEl.append(makeTab(t, state));
	const active = tabsEl.querySelector('.tab.active');
	if (active && (state.overflow === 'scroll' || sideTabs)) active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
});

tabsEl.addEventListener('contextmenu', (e) => {
	const tab = e.target.closest('.tab');
	if (!tab) return;
	e.preventDefault();
	api.tabMenu(Number(tab.dataset.id));
});

// Перетаскивание вкладок. Позиция считается среди остальных вкладок (без перетаскиваемой)
let dragId = null;

function dropTarget(x, y) {
	const others = [...tabsEl.querySelectorAll('.tab')].filter((el) => Number(el.dataset.id) !== dragId);
	let index = others.findIndex((el) => {
		const r = el.getBoundingClientRect();
		return sideTabs ? y < r.top + r.height / 2 : x < r.left + r.width / 2;
	});
	if (index < 0) index = others.length;
	return { index, before: others[index] || null, last: others[others.length - 1] || null };
}

function clearDrop() {
	for (const el of tabsEl.querySelectorAll('.drop-before, .drop-after, .dragging')) el.classList.remove('drop-before', 'drop-after', 'dragging');
}

tabsEl.addEventListener('dragstart', (e) => {
	const tab = e.target.closest && e.target.closest('.tab');
	if (!tab) return;
	dragId = Number(tab.dataset.id);
	e.dataTransfer.setData('text/plain', String(dragId));
	e.dataTransfer.effectAllowed = 'move';
	tab.classList.add('dragging');
});

tabsEl.addEventListener('dragover', (e) => {
	if (dragId === null) return;
	e.preventDefault();
	const t = dropTarget(e.clientX, e.clientY);
	for (const el of tabsEl.querySelectorAll('.drop-before, .drop-after')) el.classList.remove('drop-before', 'drop-after');
	if (t.before) t.before.classList.add('drop-before');
	else if (t.last) t.last.classList.add('drop-after');
});

tabsEl.addEventListener('drop', (e) => {
	if (dragId === null) return;
	e.preventDefault();
	const t = dropTarget(e.clientX, e.clientY);
	api.moveTab(dragId, t.index);
	dragId = null;
	clearDrop();
});

tabsEl.addEventListener('dragend', () => {
	dragId = null;
	clearDrop();
});

// Кнопка обновления видна, только когда есть что ставить
let lastUpdate = null;
const updateBtn = document.getElementById('update');
updateBtn.addEventListener('click', () => {
	api.updateTip(null);
	api.updateApply();
});
updateBtn.addEventListener('mouseenter', () => {
	const b = updateBtn.getBoundingClientRect();
	api.updateTip({ x: b.left, y: b.top, width: b.width, height: b.height });
});
updateBtn.addEventListener('mouseleave', () => api.updateTip(null));
function showUpdate(st) {
	lastUpdate = st;
	const on = layoutState.appUpdate !== false && st && (st.status === 'ready' || st.status === 'downloading' || (st.status === 'available' && st.mode !== 'dev'));
	updateBtn.classList.toggle('hidden', !on);
	if (!on) return;
	const titles = {
		ready: st.mode === 'dmg' ? 'Версия ' + st.version + ' скачана: открыть установщик' : 'Обновить до ' + st.version + ' и перезапустить',
		downloading: 'Скачивается обновление ' + st.version + ': ' + st.progress + '%',
		available: 'Доступна версия ' + st.version + (st.mode === 'page' ? ': открыть страницу загрузки' : ': скачать и установить'),
	};
	updateBtn.removeAttribute('title'); // подсказку рисует главный процесс, она обновляется на лету
	updateBtn.setAttribute('aria-label', titles[st.status]);
	updateBtn.classList.toggle('busy', st.status === 'downloading');
}
api.onUpdate(showUpdate);
showUpdate(api.updateState());

api.onDownloadsBusy((n) => {
	document.getElementById('downloads').classList.toggle('busy', n > 0);
});

// Действия по mousedown, чтобы они срабатывали, даже если список перерисовался между нажатием и отпусканием
tabsEl.addEventListener('mousedown', (e) => {
	const tab = e.target.closest('.tab');
	if (!tab) return;
	const id = Number(tab.dataset.id);
	if (e.button === 1) {
		e.preventDefault();
		api.closeTab(id);
	} else if (e.button === 0) {
		if (e.target.closest('.close')) api.closeTab(id);
		else api.activateTab(id);
	}
});

tabsEl.addEventListener('wheel', (e) => {
	if (!tabsEl.classList.contains('scroll') || sideTabs) return;
	tabsEl.scrollLeft += e.deltaY || e.deltaX;
}, { passive: true });

// ---------- Адресная строка ----------

address.addEventListener('input', () => {
	dirty = true;
	const rect = box.getBoundingClientRect();
	api.suggestQuery({ text: address.value, x: rect.left, width: rect.width });
});

address.addEventListener('keydown', (e) => {
	if (e.key === 'Enter') {
		dirty = false;
		api.go(address.value);
		address.blur();
	} else if (e.key === 'Escape') {
		if (suggestOpen) {
			api.suggestHide();
		} else {
			dirty = false;
			showAddress(currentUrl);
			address.blur();
		}
	} else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && suggestOpen) {
		e.preventDefault();
		api.suggestMove(e.key === 'ArrowDown' ? 1 : -1);
	}
});

address.addEventListener('focus', () => {
	clearTimeout(blurTimer);
	if (!dirty) address.value = currentUrl; // при редактировании показываем настоящий адрес
	if (!suggestOpen) address.select();
});

// Небольшая задержка: клик по подсказке сначала снимает фокус с поля
address.addEventListener('blur', () => {
	if (!dirty) address.value = pretty(currentUrl);
	blurTimer = setTimeout(() => api.suggestHide(), 150);
});

api.onState((state) => {
	currentUrl = state.url;
	back.disabled = !state.canGoBack;
	forward.disabled = !state.canGoForward;
	reload.textContent = state.loading ? '✕' : '⟳';
	reload.title = state.loading ? 'Остановить' : 'Обновить (Ctrl+R)';
	const zoomBtn = document.getElementById('zoom');
	zoomBtn.classList.toggle('hidden', state.zoom === 100);
	zoomBtn.textContent = state.zoom + '%';
	const offerBtn = document.getElementById('pwoffer');
	offerBtn.classList.toggle('hidden', !state.pwOffer);
	if (state.pwOffer) {
		const who = (state.pwOffer.username || 'без логина') + ' на ' + new URL(state.pwOffer.origin).hostname;
		offerBtn.title = (state.pwOffer.update ? 'Обновить пароль: ' : 'Сохранить пароль: ') + who + (state.pwOffer.unlocked ? '' : ' (откроется менеджер паролей)');
	}
	star.disabled = !state.canBookmark;
	star.classList.toggle('on', state.bookmarked);
	star.title = state.bookmarked ? 'Убрать из закладок (Ctrl+D)' : 'Добавить в закладки (Ctrl+D)';
	// Адрес следует за страницей. Недопечатанный текст не трогаем, пока не откроется новая страница.
	// При переключении вкладки (reset) адрес заменяется всегда
	if (state.reset || !dirty || (state.navigated && !editing())) {
		showAddress(state.url);
		dirty = false;
	}
});

api.onFocusAddress(() => {
	address.focus();
	address.select();
});

api.onSetAddress(({ text, select }) => {
	address.value = text;
	if (select) address.select();
	else address.setSelectionRange(text.length, text.length);
});

api.onSuggestVisible((visible) => {
	suggestOpen = visible;
});

// ---------- Раскладка: положение панелей и их содержимое ----------

const bmbar = document.getElementById('bmbar');
const winctl = document.getElementById('winctl');

function applyLayout(l) {
	layoutState = l;
	document.body.dataset.tabs = l.tabsPos;
	document.body.dataset.bm = l.bookmarksBar ? l.bmPos : 'off';
	document.getElementById('newtab').classList.toggle('off', !l.tabsNewButton);
	document.getElementById('passwords').classList.toggle('off', !l.appPasswords);
	document.getElementById('bookmarks').classList.toggle('off', !l.appBookmarks);
	document.getElementById('chars').classList.toggle('off', !l.appChars);
	document.getElementById('spaces').classList.toggle('off', !l.appSpaces);
	document.getElementById('history').classList.toggle('off', !l.appHistory);
	document.getElementById('settings').classList.toggle('off', !l.appSettings);
	document.getElementById('downloads').classList.toggle('off', !l.appDownloads);
	// Кнопки окна живут в самой верхней полосе: во вкладках, а если вкладки не сверху, то в отдельной узкой полосе над панелью инструментов
	winctl.classList.toggle('hidden', !l.winButtons);
	document.body.dataset.title = l.winButtons && l.tabsPos !== 'top' ? 'on' : 'off';
	const slot = document.getElementById(l.tabsPos === 'top' ? 'slot-tab' : 'titlebar');
	if (winctl.parentElement !== slot) slot.append(winctl);
	document.getElementById('win-max').title = l.maximized ? 'Восстановить' : 'Развернуть';
	document.getElementById('win-max-icon').innerHTML = l.maximized
		? '<rect x="2.2" y="3.8" width="6" height="6"/><path d="M4 3.8V2.2h5.8v5.8H8.2"/>'
		: '<rect x="2.2" y="2.2" width="7.6" height="7.6"/>';
	bmbar.classList.toggle('icons', !!l.bmOnlyIcons);
	renderBar();
	if (lastUpdate) showUpdate(lastUpdate);
}

function renderBar() {
	bmbar.textContent = '';
	const only = !!layoutState.bmOnlyIcons;
	const folderIcon = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M3.5 6.5h6l2 2.5h9v9.5h-17z"/></svg>';
	for (const f of barData.folders) {
		const b = document.createElement('button');
		b.className = 'bm folder';
		b.title = f.name;
		b.innerHTML = folderIcon;
		if (!only) {
			const n = document.createElement('span');
			n.className = 'name';
			n.textContent = f.name;
			b.append(n);
		}
		b.addEventListener('click', () => api.barFolder(f.id));
		bmbar.append(b);
	}
	for (const m of barData.bookmarks.filter((x) => !x.folder)) {
		const b = document.createElement('button');
		b.className = 'bm';
		b.title = m.title + '\n' + m.url;
		let fav;
		const letter = () => {
			const l = document.createElement('span');
			l.className = 'fav letter';
			l.textContent = (m.title.trim()[0] || '•').toUpperCase();
			return l;
		};
		if (m.icon) {
			fav = document.createElement('img');
			fav.className = 'fav';
			fav.src = m.icon;
			fav.addEventListener('error', () => fav.replaceWith(letter()));
		} else {
			fav = letter();
		}
		b.append(fav);
		if (!only) {
			const n = document.createElement('span');
			n.className = 'name';
			n.textContent = m.title;
			b.append(n);
		}
		b.addEventListener('click', () => api.barOpen(m.id, false));
		b.addEventListener('mousedown', (e) => {
			if (e.button !== 1) return;
			e.preventDefault();
			api.barOpen(m.id, true);
		});
		bmbar.append(b);
	}
	if (!bmbar.children.length) {
		const hint = document.createElement('span');
		hint.className = 'empty';
		hint.textContent = 'Закладок пока нет: нажми ☆ в адресной строке';
		bmbar.append(hint);
	}
}

api.onBar((data) => {
	barData = data;
	renderBar();
});
api.onLayout(applyLayout);
barData = api.bar();
applyLayout(api.layout());
