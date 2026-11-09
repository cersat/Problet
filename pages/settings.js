const $ = (id) => document.getElementById(id);
const statusEl = $('status');

function say(text, bad) {
	statusEl.textContent = text;
	statusEl.className = bad ? 'status bad' : 'status';
}

function errText(e) {
	return String((e && e.message) || e).replace(/^Error invoking remote method '[^']*': (Error: )?/, '');
}

async function run(fn) {
	try {
		await fn();
	} catch (e) {
		say(errText(e), true);
	}
}

function showCustom(on) {
	$('custom-row').classList.toggle('hidden', !on);
	$('custom-hint').classList.toggle('hidden', !on);
}

async function load() {
	const { settings, engines, accents, searchCount, version, arrowSets } = await api.getSettings();
	arrows = arrowSets;
	$('app-version').textContent = version;
	current = settings;
	renderHotkeys();
	renderPanels();
	const select = $('engine');
	select.textContent = '';
	for (const e of engines) {
		const option = document.createElement('option');
		option.value = e.id;
		option.textContent = e.name;
		select.append(option);
	}
	select.value = settings.engine;
	$('custom').value = settings.customTemplate;
	showCustom(settings.engine === 'custom');
	$('history-count').textContent = 'Сохранено запросов: ' + searchCount;

	for (const el of document.querySelectorAll('[data-setting]')) {
		const v = settings[el.dataset.setting];
		if (el.type === 'checkbox') el.checked = !!v;
		else el.value = v;
	}
	$('startup-url').value = settings.startupUrl;
	showDownloadDir();
	$('startup-url-row').classList.toggle('hidden', settings.startup !== 'url');

	const box = $('swatches');
	box.textContent = '';
	for (const a of accents) {
		const b = document.createElement('button');
		b.className = 'swatch' + (a.id === settings.accent ? ' active' : '');
		b.dataset.accent = a.id;
		const dot = document.createElement('i');
		dot.style.background = a.color;
		b.append(dot, a.name);
		box.append(b);
	}
}

let current = {};
let arrows = {};

// ---------- Панели и кнопки ----------

const PANEL_NAMES = { tabs: 'Панель вкладок', toolbar: 'Панель инструментов', bmbar: 'Панель закладок', page: 'Окно вкладки' };
const BTN_NAMES = { sp1: 'Переменный промежуток 1', sp2: 'Переменный промежуток 2', sp3: 'Переменный промежуток 3', spaces: 'Пространства', newtab: 'Новая вкладка', winctl: 'Кнопки окна (свернуть, развернуть, закрыть)', back: 'Назад', forward: 'Вперёд', reload: 'Обновить страницу', update: 'Значок обновления', chars: 'Таблица символов', bookmarks: 'Закладки', passwords: 'Пароли', history: 'История поиска', downloads: 'Загрузки', settings: 'Настройки' };
const MAIN_NAMES = { 'm:tabs': 'Вкладки', 'm:address': 'Адресная строка', 'm:bookmarks': 'Закладки' };

function moveButton(text, title, disabled, onClick) {
	const b = document.createElement('button');
	b.className = 'move';
	b.textContent = text;
	b.title = title;
	b.disabled = disabled;
	b.addEventListener('click', onClick);
	return b;
}

function listRow(name, muted) {
	const row = document.createElement('div');
	row.className = 'prow' + (muted ? ' muted' : '');
	const label = document.createElement('span');
	label.className = 'pname';
	label.textContent = name;
	row.append(label);
	return row;
}

function saveLayout(patch, after) {
	run(async () => {
		current = await api.setSettings(patch);
		renderPanels();
		if (after) after();
		else say('Сохранено');
	});
}

// Свои кнопки: окно создания и изменения
let cbEditing = null;

function cbSync() {
	const t = $('cb-type').value;
	$('cb-url-row').classList.toggle('hidden', t !== 'url');
	$('cb-newtab-row').classList.toggle('hidden', t !== 'url');
	$('cb-script-row').classList.toggle('hidden', t !== 'script');
	$('cb-action-row').classList.toggle('hidden', t !== 'action');
}

function openCustom(c) {
	cbEditing = c || null;
	$('cb-title').textContent = c ? 'Изменить кнопку' : 'Новая кнопка';
	const sel = $('cb-action');
	if (!sel.children.length) for (const a of accel.ACTIONS) sel.append(new Option(a.label, a.id));
	$('cb-name').value = c ? c.name : '';
	$('cb-icon').value = c ? c.icon : '';
	$('cb-type').value = c ? c.type : 'url';
	$('cb-url').value = c && c.type === 'url' ? c.value : '';
	$('cb-newtab').checked = !!(c && c.newTab);
	$('cb-script').value = c && c.type === 'script' ? c.value : '';
	if (c && c.type === 'action') sel.value = c.value;
	$('cb-error').textContent = '';
	cbSync();
	$('cb-dialog').showModal();
	$('cb-name').focus();
}

$('cb-add').addEventListener('click', () => {
	if (current.customButtons.length >= 20) return say('Своих кнопок может быть не больше 20', true);
	openCustom(null);
});
$('cb-type').addEventListener('change', cbSync);
$('cb-cancel').addEventListener('click', () => $('cb-dialog').close());
$('cb-form').addEventListener('submit', async (e) => {
	e.preventDefault();
	const type = $('cb-type').value;
	const value = type === 'url' ? $('cb-url').value.trim() : type === 'script' ? $('cb-script').value : $('cb-action').value;
	const entry = {
		id: cbEditing ? cbEditing.id : 'cb:' + Math.random().toString(36).slice(2, 10).padEnd(8, '0'),
		name: $('cb-name').value, icon: $('cb-icon').value, type, value, newTab: $('cb-newtab').checked,
	};
	const list = cbEditing ? current.customButtons.map((c) => (c.id === entry.id ? entry : c)) : [...current.customButtons, entry];
	try {
		current = await api.setSettings({ customButtons: list });
		$('cb-dialog').close();
		renderPanels();
		say('Сохранено');
	} catch (err) {
		$('cb-error').textContent = errText(err);
	}
});

function renderPanels() {
	const glyphs = arrows[current.arrows] || ['◀', '▶'];
	const order = current.panelOrder;
	const box = $('panel-order');
	box.textContent = '';
	order.forEach((k, i) => {
		const note = k === 'tabs' && current.tabsPos !== 'row' ? ' (сбоку)' : k === 'bmbar' && !current.bookmarksBar ? ' (выключена)' : '';
		const row = listRow(PANEL_NAMES[k] + note, k === 'page');
		const swap = (d) => {
			const next = [...order];
			[next[i], next[i + d]] = [next[i + d], next[i]];
			saveLayout({ panelOrder: next });
		};
		row.append(moveButton('▲', 'Выше', i === 0, () => swap(-1)), moveButton('▼', 'Ниже', i === order.length - 1, () => swap(1)));
		box.append(row);
	});
	const lists = $('btn-lists');
	lists.textContent = '';
	const L = current.btnLayout;
	for (const key of ['tabs', 'toolbar', 'bmbar', 'hidden']) {
		const head = document.createElement('div');
		head.className = 'plist-head';
		head.textContent = key === 'hidden' ? 'Скрытые' : PANEL_NAMES[key];
		lists.append(head);
		const group = document.createElement('div');
		group.className = 'plist';
		if (!L[key].length) group.append(listRow('Пусто', true));
		L[key].forEach((id, i) => {
			if (MAIN_NAMES[id]) {
				group.append(listRow(MAIN_NAMES[id], true));
				return;
			}
			const custom = (current.customButtons || []).find((c) => c.id === id);
			const row = listRow(custom ? custom.icon + '  ' + custom.name : BTN_NAMES[id]);
			const sel = document.createElement('select');
			for (const p of ['tabs', 'toolbar', 'bmbar']) sel.append(new Option(PANEL_NAMES[p], p));
			sel.append(new Option('Скрыть', 'hidden'));
			sel.value = key;
			sel.addEventListener('change', () => {
				if (/^sp\d$/.test(id) && sel.value !== 'hidden' && L[sel.value].some((x) => /^sp\d$/.test(x))) {
					sel.value = key;
					say('На панели уже есть переменный промежуток: на одной панели он может быть только один', true);
					return;
				}
				const next = {};
				for (const k of Object.keys(L)) next[k] = L[k].filter((x) => x !== id);
				next[sel.value].push(id);
				saveLayout({ btnLayout: next }, () => {
					say(sel.value === 'hidden' && current.btnLayout.hidden.indexOf(id) < 0 ? 'Нельзя скрыть: для настроек не назначено сочетание клавиш' : 'Сохранено', sel.value === 'hidden' && current.btnLayout.hidden.indexOf(id) < 0);
				});
			});
			row.append(sel);
			if (key !== 'hidden') {
				const swap = (d) => {
					const next = JSON.parse(JSON.stringify(L));
					[next[key][i], next[key][i + d]] = [next[key][i + d], next[key][i]];
					saveLayout({ btnLayout: next });
				};
				row.append(moveButton(glyphs[0], 'Назад по панели', i === 0, () => swap(-1)), moveButton(glyphs[1], 'Вперёд по панели', i === L[key].length - 1, () => swap(1)));
			}
			if (custom) {
				const edit = moveButton('✎', 'Изменить кнопку', false, () => openCustom(custom));
				const del = moveButton('✕', 'Удалить кнопку', false, () => saveLayout({ customButtons: current.customButtons.filter((c) => c.id !== id) }));
				row.append(edit, del);
			}
			group.append(row);
		});
		lists.append(group);
	}
}

// Переключатели и списки с data-setting сохраняются сразу
for (const el of document.querySelectorAll('[data-setting]')) {
	el.addEventListener('change', () => run(async () => {
		const value = el.type === 'checkbox' ? el.checked : el.value;
		try {
			await api.setSettings({ [el.dataset.setting]: value });
		} catch (e) {
			if (el.type === 'checkbox') el.checked = !!current[el.dataset.setting];
			else el.value = current[el.dataset.setting];
			throw e;
		}
		current[el.dataset.setting] = value;
		if (el.dataset.setting === 'tabsPos' || el.dataset.setting === 'arrows') {
			current = { ...current, [el.dataset.setting]: value };
			renderPanels();
		}
		if (el.dataset.setting === 'startup') $('startup-url-row').classList.toggle('hidden', value !== 'url');
		say('Сохранено');
	}));
}

$('startup-url').addEventListener('change', () => run(async () => {
	await api.setSettings({ startupUrl: $('startup-url').value });
	say('Сохранено');
}));

$('swatches').addEventListener('click', (e) => {
	const b = e.target.closest('.swatch');
	if (!b) return;
	run(async () => {
		await api.setSettings({ accent: b.dataset.accent });
		for (const s of document.querySelectorAll('.swatch')) s.classList.toggle('active', s === b);
		say('Сохранено');
	});
});

$('view-history').addEventListener('click', () => run(() => api.openInNewTab('history')));

$('clear-visits').addEventListener('click', () => run(async () => {
	if (!confirm('Удалить всю историю посещений?')) return;
	await api.clearVisits();
	say('История посещений очищена');
}));

$('clear-cache').addEventListener('click', () => run(async () => {
	const r = await api.clearCache();
	say(r.message);
}));

async function saveCustom() {
	await api.setSettings({ engine: 'custom', customTemplate: $('custom').value });
	say('Поисковик сохранён');
}

$('engine').addEventListener('change', () => run(async () => {
	const id = $('engine').value;
	showCustom(id === 'custom');
	if (id === 'custom') {
		if ($('custom').value.trim()) await saveCustom();
		else say('Введи шаблон адреса поиска со значком %s, и он сохранится');
		return;
	}
	await api.setSettings({ engine: id });
	say('Поисковик сохранён');
}));

$('custom').addEventListener('change', () => run(saveCustom));

$('export').addEventListener('click', () => run(async () => {
	const r = await api.exportData();
	if (!r.canceled) say(r.message);
}));

$('import').addEventListener('click', () => run(async () => {
	const r = await api.importData();
	if (r.canceled) return;
	say(r.message);
	await load();
}));

$('export-html').addEventListener('click', () => run(async () => {
	const r = await api.exportBookmarksHtml();
	if (!r.canceled) say(r.message);
}));

// Находит имя папки для ссылки в файле закладок (формат Netscape)
function folderOf(a) {
	const dl = a.closest('dl');
	let prev = dl && dl.previousElementSibling;
	if (prev && prev.tagName === 'DT') prev = prev.querySelector('h3');
	return prev && prev.tagName === 'H3' ? prev.textContent.trim() : '';
}

function parseBookmarksHtml(text) {
	const doc = new DOMParser().parseFromString(text, 'text/html');
	return [...doc.querySelectorAll('a[href]')].map((a) => ({
		title: a.textContent.trim(),
		url: a.getAttribute('href'),
		folder: folderOf(a),
	}));
}

$('import-html').addEventListener('click', () => $('html-file').click());

$('html-file').addEventListener('change', () => run(async () => {
	const file = $('html-file').files[0];
	$('html-file').value = '';
	if (!file) return;
	if (file.size > 30 * 1024 * 1024) throw new Error('Файл слишком большой');
	const items = parseBookmarksHtml(await file.text());
	if (!items.length) throw new Error('В файле не найдено ни одной закладки');
	const r = await api.importBookmarkItems(items);
	say(r.message);
}));

// ---------- Импорт из других браузеров ----------

// Папки других браузеров читаем только по нажатию кнопки: на macOS система спрашивает разрешение на доступ к данным других приложений
let sourcesFound = false;

async function loadSources() {
	const list = await api.importSources();
	const sel = $('import-src');
	sel.textContent = '';
	for (const s of list) {
		const o = document.createElement('option');
		o.value = s.id;
		o.textContent = s.name;
		sel.append(o);
	}
	if (!list.length) {
		const o = document.createElement('option');
		o.textContent = 'Ничего не найдено';
		sel.append(o);
		return false;
	}
	sel.disabled = false;
	$('import-run').textContent = 'Импортировать';
	return true;
}

$('import-src').disabled = true;
$('import-run').textContent = 'Найти браузеры';
$('import-run').addEventListener('click', () => run(async () => {
	if (!sourcesFound) {
		sourcesFound = await loadSources();
		return;
	}
	const r = await api.importFrom($('import-src').value);
	say(r.message);
}));

// ---------- Расширения ----------

async function loadExtensions() {
	const list = await api.extList();
	const box = $('ext-list');
	box.textContent = '';
	for (const e of list) {
		const row = document.createElement('div');
		row.className = 'data-row';
		const what = document.createElement('div');
		what.className = 'what';
		const b = document.createElement('b');
		b.textContent = e.name + (e.version ? ' ' + e.version : '');
		const sub = document.createElement('span');
		sub.textContent = e.error ? 'Не загрузилось: ' + e.error : e.path;
		what.append(b, sub);
		const del = document.createElement('button');
		del.className = 'danger';
		del.textContent = 'Удалить';
		del.addEventListener('click', () => run(async () => {
			await api.extRemove(e.path);
			await loadExtensions();
		}));
		row.append(what, del);
		box.append(row);
	}
}

$('ext-store').addEventListener('click', () => run(async () => {
	const input = $('ext-store-input').value.trim();
	if (!input) throw new Error('Вставь ссылку или идентификатор расширения');
	say('Скачиваю…');
	const r = await api.extStore(input);
	$('ext-store-input').value = '';
	say(r.message);
	await loadExtensions();
}));

$('ext-add').addEventListener('click', () => run(async () => {
	const r = await api.extAdd();
	if (r && r.message) say(r.message);
	await loadExtensions();
}));

$('clear').addEventListener('click', () => run(async () => {
	if (!confirm('Удалить всю историю поиска? Подсказки в адресной строке исчезнут.')) return;
	await api.clearSearchHistory();
	say('История поиска очищена');
	await load();
}));

run(load);
run(loadExtensions);


// ---------- Категории: показываем по одному разделу ----------

const sections = [...document.querySelectorAll('main > section')];
const catsEl = $('cats');

function showCategory(i) {
	sections.forEach((s, n) => s.classList.toggle('hidden', n !== i));
	[...catsEl.children].forEach((b, n) => b.classList.toggle('active', n === i));
	try {
		localStorage.setItem('settings-category', String(i));
	} catch (e) { /* без сохранения тоже работает */ }
}

sections.forEach((s, i) => {
	const b = document.createElement('button');
	b.textContent = s.querySelector('h2').textContent;
	b.addEventListener('click', () => showCategory(i));
	catsEl.append(b);
});

let startCategory = 0;
try {
	startCategory = Number(localStorage.getItem('settings-category')) || 0;
} catch (e) { /* ничего */ }
showCategory(startCategory < sections.length ? startCategory : 0);

// ---------- Обновления ----------

const upStatus = $('update-status');
let upTimer = null;

function renderUpdate(st) {
	const texts = {
		idle: 'Ещё не проверялось',
		checking: 'Проверяю…',
		uptodate: 'Установлена последняя версия',
		available: 'Доступна версия ' + st.version,
		building: 'Версия ' + st.version + ' ещё не готова к установке: идёт сборка',
		downloading: 'Скачиваю версию ' + st.version + ': ' + st.progress + '%',
		ready: st.mode === 'dmg' ? 'Версия ' + st.version + ' скачана в «Загрузки»' : 'Версия ' + st.version + ' скачана, осталось перезапустить',
		error: 'Не удалось проверить: ' + st.message,
	};
	upStatus.textContent = (texts[st.status] || '') + (st.mode === 'dev' && st.status !== 'error' ? ' (в режиме разработки обновляться нечем)' : '');
	$('changelog-row').hidden = !st.changelog;
	$('changelog').textContent = st.changelog || '';
	const btn = $('update-apply');
	const show = (st.status === 'available' && st.mode !== 'dev') || st.status === 'ready';
	btn.classList.toggle('hidden', !show);
	btn.textContent = st.status === 'ready' ? (st.mode === 'dmg' ? 'Открыть установщик' : 'Перезапустить') : st.mode === 'page' ? 'Открыть страницу загрузки' : 'Скачать и установить';
	$('update-check').disabled = st.status === 'checking' || st.status === 'downloading';
	// Пока идёт работа, обновляем статус сами
	if (st.status === 'checking' || st.status === 'downloading') {
		if (!upTimer) upTimer = setInterval(() => run(async () => renderUpdate(await api.updateState())), 700);
	} else if (upTimer) {
		clearInterval(upTimer);
		upTimer = null;
	}
}

$('update-check').addEventListener('click', () => run(async () => {
	renderUpdate({ status: 'checking', mode: '' });
	renderUpdate(await api.checkUpdate());
}));

$('update-apply').addEventListener('click', () => run(() => api.applyUpdate()));

run(async () => renderUpdate(await api.updateState()));


// Апплет «Настройки» нельзя убрать, пока у настроек нет горячей клавиши: иначе до них не добраться
function showDownloadDir() {
	$('download-dir').textContent = current.downloadDir || 'Папка «Загрузки» в системе';
}

$('download-dir-pick').addEventListener('click', () => run(async () => {
	const r = await api.pickDownloadDir();
	if (!r || r.canceled) return;
	current = (await api.setSettings({ downloadDir: r.path })) || current;
	showDownloadDir();
	say('Сохранено');
}));

$('download-dir-reset').addEventListener('click', () => run(async () => {
	current = (await api.setSettings({ downloadDir: '' })) || current;
	showDownloadDir();
	say('Сохранено');
}));

$('open-bookmarks').addEventListener('click', () => run(() => api.openInNewTab('bookmarks')));
$('make-default').addEventListener('click', () => run(async () => {
	const r = await api.makeDefaultBrowser();
	say(r.message, !r.ok);
}));
$('open-blocklist').addEventListener('click', () => run(() => api.openInNewTab('blocklist')));
$('manage-spaces').addEventListener('click', () => run(() => api.openSpacesApplet()));

// ---------- Горячие клавиши ----------

const hkEl = $('hotkeys');
let recording = null; // { id, button }

function effectiveKey(id) {
	const custom = current.hotkeys || {};
	return Object.hasOwn(custom, id) ? custom[id] : accel.ACTIONS.find((a) => a.id === id).key;
}

function renderHotkeys() {
	hkEl.textContent = '';
	for (const a of accel.ACTIONS) {
		const row = document.createElement('div');
		row.className = 'setting';
		const what = document.createElement('div');
		what.className = 'what';
		what.textContent = a.label;
		const b = document.createElement('button');
		b.className = 'hotkey';
		b.dataset.id = a.id;
		b.textContent = effectiveKey(a.id) || 'Отключено';
		b.addEventListener('click', () => startRecording(a.id, b));
		row.append(what, b);
		hkEl.append(row);
	}
}

async function startRecording(id, button) {
	if (recording) stopRecording();
	recording = { id, button };
	button.textContent = 'Нажми сочетание…';
	button.classList.add('recording');
	await api.captureHotkeys(true);
}

function stopRecording() {
	if (!recording) return;
	const { id, button } = recording;
	recording = null;
	button.classList.remove('recording', 'conflict');
	button.textContent = effectiveKey(id) || 'Отключено';
	api.captureHotkeys(false);
}

async function saveHotkeys(next) {
	const r = await api.setSettings({ hotkeys: next });
	current = r || current;
	renderHotkeys();
}

document.addEventListener('keydown', (e) => {
	if (!recording) return;
	e.preventDefault();
	e.stopPropagation();
	recording.button.classList.remove('conflict');
	const combo = accel.fromEvent({ key: e.key, ctrl: e.ctrlKey, meta: e.metaKey, alt: e.altKey, shift: e.shiftKey });
	if (!combo) return; // нажаты одни модификаторы
	const { id } = recording;
	if (combo === 'Esc') {
		stopRecording();
		return;
	}
	const bare = combo === 'Delete' || combo === 'Backspace';
	if (!bare && !/^(Ctrl|Alt)\+/.test(combo) && !/^(Shift\+)?F([1-9]|1[0-2])$/.test(combo)) {
		say('Нужна Ctrl, Alt или клавиша F1–F12', true);
		recording.button.classList.add('conflict');
		return;
	}
	const value = bare ? '' : combo;
	const owner = accel.ACTIONS.find((a) => a.id !== id && value && effectiveKey(a.id) === value);
	if (owner) {
		say('«' + value + '» уже занято: ' + owner.label, true);
		recording.button.classList.add('conflict'); // поле с клавишей краснеет, пока не нажмёшь другое сочетание
		recording.button.textContent = 'Занято: ' + owner.label;
		recording.button.title = '«' + value + '» уже используется: ' + owner.label;
		return;
	}
	stopRecording();
	run(async () => {
		await saveHotkeys({ ...(current.hotkeys || {}), [id]: value });
		say('Сохранено');
	});
}, true);

window.addEventListener('blur', () => stopRecording());

$('hotkeys-reset').addEventListener('click', () => run(async () => {
	stopRecording();
	await saveHotkeys({});
	say('Клавиши сброшены');
}));

$('open-passwords').addEventListener('click', () => run(() => api.openInNewTab('passwords')));


// ---------- Пароли: выгрузка и загрузка ----------

for (const [id, method] of [['pw-export', 'pwExport'], ['pw-import', 'pwImport']]) {
	$(id).addEventListener('click', () => run(async () => {
		const master = $('pw-master').value;
		if (!master) throw new Error('Введи мастер-пароль');
		const r = await api[method](master);
		$('pw-master').value = '';
		if (!r.canceled) say(r.message);
	}));
}

$('open-version').addEventListener('click', () => run(() => api.openInNewTab('version')));


// ---------- Счётчик заблокированной рекламы: обновляется на глазах ----------

async function refreshBlocked() {
	const s = await api.adblockStats();
	$('blocked-total').textContent = s.total.toLocaleString('ru-RU');
	$('blocked-note').textContent = 'С запуска браузера: ' + s.session.toLocaleString('ru-RU') + '. Число идёт с момента, когда включён блокировщик';
}

refreshBlocked().catch(() => {});
setInterval(() => {
	if (document.visibilityState === 'visible') refreshBlocked().catch(() => {});
}, 2000);
