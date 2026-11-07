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
	const { settings, engines, accents, searchCount, version } = await api.getSettings();
	$('app-version').textContent = version;
	current = settings;
	renderHotkeys();
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
	syncAppSettings();
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

// Переключатели и списки с data-setting сохраняются сразу
for (const el of document.querySelectorAll('[data-setting]')) {
	el.addEventListener('change', () => run(async () => {
		const value = el.type === 'checkbox' ? el.checked : el.value;
		await api.setSettings({ [el.dataset.setting]: value });
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
		downloading: 'Скачиваю версию ' + st.version + ': ' + st.progress + '%',
		ready: 'Версия ' + st.version + ' скачана, осталось перезапустить',
		error: 'Не удалось проверить: ' + st.message,
	};
	upStatus.textContent = (texts[st.status] || '') + (st.mode === 'dev' && st.status !== 'error' ? ' (в режиме разработки обновляться нечем)' : '');
	const btn = $('update-apply');
	const show = (st.status === 'available' && st.mode !== 'dev') || st.status === 'ready';
	btn.classList.toggle('hidden', !show);
	btn.textContent = st.status === 'ready' ? 'Перезапустить' : st.mode === 'page' ? 'Открыть страницу загрузки' : 'Скачать и установить';
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
function syncAppSettings() {
	const box = document.querySelector('[data-setting="appSettings"]');
	const hasKey = !!effectiveKey('settings');
	if (!hasKey) box.checked = true;
	box.disabled = !hasKey;
	$('app-settings-note').textContent = hasKey ? '' : 'Нельзя выключить: для настроек не назначено сочетание клавиш';
}

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
	syncAppSettings();
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
