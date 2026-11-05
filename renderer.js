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
document.getElementById('history').addEventListener('click', () => api.openInternal('history'));
document.getElementById('pwoffer').addEventListener('click', () => api.pwOfferAccept());
document.getElementById('zoom').addEventListener('click', () => api.zoomReset());
document.getElementById('downloads').addEventListener('click', () => api.openInternal('downloads'));
document.getElementById('settings').addEventListener('click', () => api.openInternal('settings'));
document.getElementById('newtab').addEventListener('click', () => api.newTab());

// ---------- Вкладки ----------

function tabLabel(t, showUrl) {
	const isNew = t.url.startsWith('problet://newtab');
	if (isNew) return 'Новая вкладка';
	if (showUrl) return t.url || t.title || 'Новая вкладка';
	return t.title || t.url || 'Загрузка…';
}

function makeTab(t, state) {
	const el = document.createElement('div');
	el.className = 'tab' + (t.id === state.activeId ? ' active' : '') + (t.pinned ? ' pinned' : '');
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

	const text = document.createElement('span');
	text.className = 'label';
	text.textContent = label;
	const close = document.createElement('button');
	close.className = 'close';
	close.dataset.close = t.id;
	close.title = 'Закрыть вкладку (Ctrl+W)';
	close.textContent = '×';
	el.append(text, close);
	return el;
}

api.onTabs((state) => {
	tabsEl.classList.toggle('scroll', state.overflow === 'scroll');
	tabsEl.style.setProperty('--n', state.tabs.length);
	tabsEl.textContent = '';
	for (const t of state.tabs) tabsEl.append(makeTab(t, state));
	const active = tabsEl.querySelector('.tab.active');
	if (active && state.overflow === 'scroll') active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
});

tabsEl.addEventListener('contextmenu', (e) => {
	const tab = e.target.closest('.tab');
	if (!tab) return;
	e.preventDefault();
	api.tabMenu(Number(tab.dataset.id));
});

// Перетаскивание вкладок. Позиция считается среди остальных вкладок (без перетаскиваемой)
let dragId = null;

function dropTarget(x) {
	const others = [...tabsEl.querySelectorAll('.tab')].filter((el) => Number(el.dataset.id) !== dragId);
	let index = others.findIndex((el) => {
		const r = el.getBoundingClientRect();
		return x < r.left + r.width / 2;
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
	const t = dropTarget(e.clientX);
	for (const el of tabsEl.querySelectorAll('.drop-before, .drop-after')) el.classList.remove('drop-before', 'drop-after');
	if (t.before) t.before.classList.add('drop-before');
	else if (t.last) t.last.classList.add('drop-after');
});

tabsEl.addEventListener('drop', (e) => {
	if (dragId === null) return;
	e.preventDefault();
	const t = dropTarget(e.clientX);
	api.moveTab(dragId, t.index);
	dragId = null;
	clearDrop();
});

tabsEl.addEventListener('dragend', () => {
	dragId = null;
	clearDrop();
});

// Кнопка обновления видна, только когда есть что ставить
const updateBtn = document.getElementById('update');
updateBtn.addEventListener('click', () => api.updateApply());
function showUpdate(st) {
	const on = st && (st.status === 'ready' || st.status === 'downloading' || (st.status === 'available' && st.mode !== 'dev'));
	updateBtn.classList.toggle('hidden', !on);
	if (!on) return;
	const titles = {
		ready: 'Обновить до ' + st.version + ' и перезапустить',
		downloading: 'Скачивается обновление ' + st.version + ': ' + st.progress + '%',
		available: 'Доступна версия ' + st.version + (st.mode === 'page' ? ': открыть страницу загрузки' : ': скачать и установить'),
	};
	updateBtn.title = titles[st.status];
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
	if (!tabsEl.classList.contains('scroll')) return;
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
