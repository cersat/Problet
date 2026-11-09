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

let tabCount = 0;
let renamingId = null; // пока вкладку переименовывают, список вкладок не перерисовывается
let pendingTabs = null;

function setTabsRows() {
	const two = !!(layoutState && layoutState.tabsTwoRows);
	tabsEl.classList.toggle('two', two);
	tabsEl.style.setProperty('--n', two ? Math.ceil(tabCount / 2) : tabCount);
	// сколько строк помещается в названии вкладки, когда двух слоёв нет
	const h = layoutState ? Math.round(layoutState.tabsBase.row * layoutState.tabsScale) - 4 : 32;
	tabsEl.style.setProperty('--lines', Math.max(1, Math.floor(h / 17)));
}

let lastTabsState = null;
function renderTabs(state) {
	lastTabsState = state;
	sideTabs = !!state.side;
	tabCount = state.tabs.length;
	tabsEl.classList.toggle('side', sideTabs);
	tabsEl.classList.toggle('scroll', state.overflow === 'scroll' && !sideTabs);
	setTabsRows();
	if (state.space) {
		document.getElementById('space-name').textContent = state.space.name;
		document.getElementById('spaces').title = 'Пространство: ' + state.space.name;
	}
	tabsEl.textContent = '';
	for (const t of state.tabs) tabsEl.append(makeTab(t, state));
	const active = tabsEl.querySelector('.tab.active');
	if (active && (state.overflow === 'scroll' || sideTabs)) active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

api.onTabs((state) => {
	if (renamingId !== null) pendingTabs = state;
	else renderTabs(state);
});

tabsEl.addEventListener('contextmenu', (e) => {
	const tab = e.target.closest('.tab');
	if (!tab) return;
	e.preventDefault();
	api.tabMenu(Number(tab.dataset.id));
});

// Переименование: поле ввода прямо на вкладке. Enter — применить, Esc — отмена, пустое имя возвращает название страницы
api.onTabRename((id) => {
	const tab = tabsEl.querySelector('.tab[data-id="' + id + '"]');
	if (!tab || renamingId !== null) return;
	const label = tab.querySelector('.label');
	const input = document.createElement('input');
	input.className = 'rename';
	input.value = (tab.querySelector('.label .t') || label).textContent;
	renamingId = id;
	let done = false;
	const finish = (apply) => {
		if (done) return;
		done = true;
		if (apply) api.tabRename(id, input.value);
		renamingId = null;
		input.remove();
		const s = pendingTabs || lastTabsState;
		pendingTabs = null;
		if (s) renderTabs(s);
	};
	input.addEventListener('keydown', (e) => {
		e.stopPropagation();
		if (e.key === 'Enter') finish(true);
		else if (e.key === 'Escape') finish(false);
	});
	input.addEventListener('blur', () => finish(true));
	for (const t of ['mousedown', 'click', 'dblclick', 'contextmenu']) input.addEventListener(t, (e) => e.stopPropagation());
	label.replaceWith(input);
	input.focus();
	input.select();
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
	const on = st && (st.status === 'ready' || st.status === 'downloading' || (st.status === 'available' && st.mode !== 'dev'));
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
const bmlist = document.getElementById('bmlist');
const winctl = document.getElementById('winctl');
const $id = (id) => document.getElementById(id);
const PANEL_EL = { tabs: $id('tabbar'), toolbar: $id('toolbar'), bmbar };
// Главный элемент каждой панели: вокруг него расставляются кнопки
// Ручка растягивания панели вкладок: до двойного размера (по высоте, а сбоку по ширине)
const grip = document.createElement('div');
grip.className = 'grip';
grip.title = 'Потяни, чтобы изменить размер панели вкладок';
grip.addEventListener('pointerdown', (e) => {
	if (e.button !== 0 || !layoutState) return;
	e.preventDefault();
	grip.setPointerCapture(e.pointerId);
	const side = !!layoutState.plan.side;
	const base = side ? layoutState.tabsBase.side : layoutState.tabsBase.row;
	const start = { pos: side ? e.clientX : e.clientY, size: base * layoutState.tabsScale };
	// куда растёт панель: вниз или вправо — когда ручка у нижнего/правого края панели, иначе в обратную сторону
	const dir = grip.dataset.edge === 'bottom' || grip.dataset.edge === 'right' ? 1 : -1;
	let frame = 0;
	const move = (ev) => {
		const size = start.size + dir * ((side ? ev.clientX : ev.clientY) - start.pos);
		const scale = Math.round(Math.min(2, Math.max(1, size / base)) * 100) / 100;
		cancelAnimationFrame(frame);
		frame = requestAnimationFrame(() => api.tabsScale(scale));
	};
	const up = () => {
		grip.removeEventListener('pointermove', move);
		grip.removeEventListener('pointerup', up);
		grip.removeEventListener('pointercancel', up);
	};
	grip.addEventListener('pointermove', move);
	grip.addEventListener('pointerup', up);
	grip.addEventListener('pointercancel', up);
});

const MAIN_EL = { 'm:tabs': 'tabs', 'm:address': 'address-box', 'm:bookmarks': 'bmlist' };

function applyLayout(l) {
	layoutState = l;
	const p = l.plan;
	// Строки сетки: полоса заголовка, панели над страницей, страница, панели под ней
	const rows = [];
	if (p.strip) rows.push('titlebar');
	rows.push(...p.before, 'page', ...p.after);
	const rowEl = { titlebar: $id('titlebar'), page: document.querySelector('.mid'), ...PANEL_EL };
	for (const el of Object.values(rowEl)) {
		el.style.gridRow = '';
		el.style.gridColumn = '';
	}
	rows.forEach((r, i) => { rowEl[r].style.gridRow = String(i + 1); });
	if (p.side) {
		PANEL_EL.tabs.style.gridRow = String(rows.indexOf('page') + 1);
		PANEL_EL.tabs.style.gridColumn = p.side === 'left' ? '1' : '3';
	}
	document.body.style.gridTemplateRows = rows.map((r) => (r === 'page' ? 'minmax(0, 1fr)' : 'auto')).join(' ');
	document.body.dataset.tabs = p.side || (p.before.includes('tabs') ? 'top' : 'bottom');
	document.body.dataset.bm = l.bookmarksBar ? (p.after.includes('bmbar') ? 'bottom' : 'top') : 'off';
	document.body.dataset.title = p.strip ? 'on' : 'off';
	PANEL_EL.toolbar.classList.toggle('edge-b', p.before.includes('toolbar'));
	PANEL_EL.toolbar.classList.toggle('edge-t', p.after.includes('toolbar'));
	bmbar.classList.toggle('edge-b', p.before.includes('bmbar'));
	bmbar.classList.toggle('edge-t', p.after.includes('bmbar'));
	// Кнопки: каждая в своей панели в заданном порядке; кнопки окна на панели вкладок могут уйти в полосу заголовка
	const L = l.btnLayout;
	for (const key of Object.keys(PANEL_EL)) {
		const host = PANEL_EL[key];
		const main = Object.keys(MAIN_EL).find((m) => L[key].includes(m));
		// есть переменный промежуток — главный элемент панели не растягивается, свободное место занимает промежуток
		host.classList.toggle('has-sp', L[key].some((id) => /^sp\d$/.test(id)));
		const want = [];
		for (const id of L[key]) {
			const el = $id(id === main ? MAIN_EL[id] : id);
			if (id === 'winctl' && key === 'tabs' && p.strip) {
				$id('titlebar').append(el);
				el.classList.remove('off');
				continue;
			}
			el.classList.remove('off');
			want.push(el);
		}
		if (key === 'tabs') want.push(grip);
		// переставляем, только если порядок изменился: перенос ручки во время перетаскивания сбросил бы захват мыши
		if (want.length !== host.children.length || want.some((el, i) => host.children[i] !== el)) host.append(...want);
	}
	for (const id of L.hidden) $id(id).classList.add('off');
	// Размер панели вкладок и ручка, за которую её растягивают
	const scale = l.tabsScale;
	document.body.style.setProperty('--tabs-h', Math.round(l.tabsBase.row * scale) + 'px');
	document.body.style.setProperty('--side-w', Math.round(l.tabsBase.side * scale) + 'px');
	grip.dataset.edge = p.side ? (p.side === 'left' ? 'right' : 'left') : (p.before.includes('tabs') ? 'bottom' : 'top');
	setTabsRows();
	$id('back').textContent = l.arrows[0];
	$id('forward').textContent = l.arrows[1];
	document.getElementById('win-max').title = l.maximized ? 'Восстановить' : 'Развернуть';
	document.getElementById('win-max-icon').innerHTML = l.maximized
		? '<rect x="2.2" y="3.8" width="6" height="6"/><path d="M4 3.8V2.2h5.8v5.8H8.2"/>'
		: '<rect x="2.2" y="2.2" width="7.6" height="7.6"/>';
	bmbar.classList.toggle('icons', !!l.bmOnlyIcons);
	renderBar();
	if (lastUpdate) showUpdate(lastUpdate);
}

function renderBar() {
	bmlist.textContent = '';
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
		bmlist.append(b);
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
		b.dataset.id = m.id;
		if (m.customIcon || m.icon) {
			fav = document.createElement('img');
			fav.className = 'fav';
			fav.src = m.customIcon || m.icon;
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
		bmlist.append(b);
	}
	if (!bmlist.children.length) {
		const hint = document.createElement('span');
		hint.className = 'empty';
		hint.textContent = 'Закладок пока нет: нажми ☆ в адресной строке';
		bmlist.append(hint);
	}
}

bmlist.addEventListener('contextmenu', (e) => {
	const b = e.target.closest('.bm[data-id]');
	if (!b) return;
	e.preventDefault();
	api.barMenu(b.dataset.id);
});

api.onBar((data) => {
	barData = data;
	renderBar();
});
api.onLayout(applyLayout);
barData = api.bar();
applyLayout(api.layout());
