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
	const { settings, engines, accents, searchCount, version, arrowSets, themes: th, defaultKeywords: dk } = await api.getSettings();
	defaultKeywords = dk;
	arrows = arrowSets;
	themes = th;
	accentSet = accents;
	fillSelect($('bg-tint'), Object.entries(th.tints));
	fillSelect($('contrast'), Object.entries(th.contrasts));
	fillSelect($('ui-scale'), th.scales.map((n) => [String(n), n + '%']));
	$('ui-scale').value = String(settings.uiScale);
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

	renderSwatches();
	renderPresets();
}

function fillSelect(sel, pairs) {
	const v = sel.value;
	sel.textContent = '';
	for (const [value, label] of pairs) sel.append(new Option(label, value));
	if (v) sel.value = v;
}

const isHex = (v) => /^#[0-9a-f]{6}$/i.test(v || '');
const accentHex = (v) => (isHex(v) ? v : ((accentSet.find((a) => a.id === v) || accentSet[0] || {}).color || '#7c9cf5'));

function renderSwatches() {
	const box = $('swatches');
	box.textContent = '';
	for (const a of accentSet) {
		const b = document.createElement('button');
		b.className = 'swatch' + (a.id === current.accent ? ' active' : '');
		b.dataset.accent = a.id;
		const dot = document.createElement('i');
		dot.style.background = a.color;
		b.append(dot, a.name);
		box.append(b);
	}
	// Свой цвет: палитра системы
	const own = document.createElement('label');
	own.className = 'swatch own' + (isHex(current.accent) ? ' active' : '');
	own.title = 'Выбрать свой цвет';
	const dot = document.createElement('i');
	dot.style.background = isHex(current.accent) ? current.accent : 'conic-gradient(#f28b9b, #f5d77a, #7fcf9a, #6cb2f0, #b79cf0, #f28b9b)';
	const input = document.createElement('input');
	input.type = 'color';
	input.value = accentHex(current.accent);
	input.addEventListener('input', () => { dot.style.background = input.value; });
	input.addEventListener('change', () => applyTheme({ accent: input.value.toLowerCase() }));
	own.append(dot, isHex(current.accent) ? 'Свой ' + current.accent : 'Свой цвет', input);
	box.append(own);
}

// Набор темы: превью из фона, панели и акцента
function presetCard(p, own) {
	const t = p.theme;
	const card = document.createElement('div');
	card.className = 'preset';
	card.tabIndex = 0;
	card.setAttribute('role', 'button');
	const same = themes.keys.every((k) => String(t[k]) === String(current[k]));
	card.classList.toggle('active', same);
	const look = document.createElement('div');
	look.className = 'look';
	const pal = themes.palettes[t.darkTheme ? 'dark' : 'light'][t.bgTint];
	for (const color of [pal[0], pal[2], accentHex(t.accent)]) {
		const sp = document.createElement('span');
		sp.style.background = color;
		if (color === accentHex(t.accent)) sp.className = 'acc';
		look.append(sp);
	}
	const name = document.createElement('b');
	name.textContent = p.name;
	const info = document.createElement('small');
	info.textContent = [t.darkTheme ? 'тёмная' : 'светлая', themes.tints[t.bgTint].split(' ')[0].toLowerCase(), t.contrast === 'high' ? 'контрастная' : '', t.uiScale !== 100 ? t.uiScale + '%' : ''].filter(Boolean).join(', ');
	card.append(look, name, info);
	const apply = () => applyTheme({ ...t }, 'Набор «' + p.name + '» применён');
	card.addEventListener('click', apply);
	card.addEventListener('keydown', (e) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			apply();
		}
	});
	if (own) {
		const del = document.createElement('button');
		del.className = 'del';
		del.textContent = '✕';
		del.title = 'Удалить набор';
		del.addEventListener('click', (e) => {
			e.stopPropagation();
			run(async () => {
				const r = await api.setSettings({ themePresets: current.themePresets.filter((x) => x.id !== p.id) });
				current = r;
				renderPresets();
				say('Набор «' + p.name + '» удалён');
			});
		});
		card.append(del);
	}
	return card;
}

function renderPresets() {
	const box = $('presets');
	box.textContent = '';
	for (const p of themes.presets) box.append(presetCard(p, false));
	for (const p of current.themePresets || []) box.append(presetCard(p, true));
}

// Меняет параметры темы и перерисовывает весь раздел
function applyTheme(patch, message) {
	return run(async () => {
		current = await api.setSettings(patch);
		for (const el of document.querySelectorAll('[data-setting]')) {
			const k = el.dataset.setting;
			if (!Object.hasOwn(patch, k)) continue;
			if (el.type === 'checkbox') el.checked = !!current[k];
			else el.value = current[k];
		}
		$('ui-scale').value = String(current.uiScale);
		renderSwatches();
		renderPresets();
		if (Object.hasOwn(patch, 'arrows')) renderPanels();
		say(message || 'Сохранено');
	});
}

let current = {};
let arrows = {};
let themes = { presets: [], tints: {}, contrasts: {}, scales: [], keys: [], palettes: {} };
let accentSet = [];
let defaultKeywords = [];

// ---------- Панели и кнопки ----------

const PANEL_NAMES = { tabs: 'Панель вкладок', toolbar: 'Панель инструментов', bmbar: 'Панель закладок', extra: 'Четвёртая панель', page: 'Окно вкладки' };
const BTN_NAMES = { sp1: 'Переменный промежуток 1', sp2: 'Переменный промежуток 2', sp3: 'Переменный промежуток 3', sp4: 'Переменный промежуток 4', clock: 'Часы', spaces: 'Пространства', newtab: 'Новая вкладка', winctl: 'Кнопки окна (свернуть, развернуть, закрыть)', back: 'Назад', forward: 'Вперёд', reload: 'Обновить страницу', update: 'Значок обновления', darkpage: 'Тёмная тема страницы', translate: 'Перевод страницы', chars: 'Таблица символов', bookmarks: 'Закладки', passwords: 'Пароли', history: 'История поиска', downloads: 'Загрузки', settings: 'Настройки' };
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
async function cbSave() {
	const type = $('cb-type').value;
	const value = type === 'url' ? $('cb-url').value.trim() : type === 'script' ? $('cb-script').value : $('cb-action').value;
	const entry = {
		id: cbEditing ? cbEditing.id : 'cb:' + Math.random().toString(36).slice(2, 10).padEnd(8, '0'),
		name: $('cb-name').value, icon: $('cb-icon').value, svg: cbEditing ? cbEditing.svg : '', type, value, newTab: $('cb-newtab').checked,
	};
	const list = cbEditing ? current.customButtons.map((c) => (c.id === entry.id ? entry : c)) : [...current.customButtons, entry];
	try {
		current = await api.setSettings({ customButtons: list });
		$('cb-dialog').close();
		renderPanels();
		return entry;
	} catch (err) {
		$('cb-error').textContent = errText(err);
		return null;
	}
}
$('cb-form').addEventListener('submit', async (e) => {
	e.preventDefault();
	if (await cbSave()) say('Сохранено');
});
// Рисунок для кнопки: сначала сохраняем саму кнопку, затем открываем редактор svg
$('cb-draw').addEventListener('click', async () => {
	const entry = await cbSave();
	if (entry) location.href = 'problet://svgedit/?bm=' + encodeURIComponent(entry.id);
});
// Рисунок мог измениться в редакторе, пока эта страница была открыта
window.addEventListener('focus', async () => {
	try {
		current = (await api.getSettings()).settings;
		renderPanels();
	} catch (e) { /* страница закрывается */ }
});

function renderPanels() {
	if (!recording) renderHotkeys(); // у своих кнопок есть клавиши
	const glyphs = arrows[current.arrows] || ['◀', '▶'];
	const order = current.panelOrder;
	const box = $('panel-order');
	box.textContent = '';
	order.forEach((k, i) => {
		const note = k === 'tabs' && current.tabsPos !== 'row' ? ' (сбоку)' : k === 'bmbar' && !current.bookmarksBar ? ' (выключена)' : k === 'extra' && !current.btnLayout.extra.length ? ' (скрыта, пока пуста)' : '';
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
	for (const key of ['tabs', 'toolbar', 'bmbar', 'extra', 'hidden']) {
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
			const row = listRow(custom ? custom.icon + '  ' + custom.name : id.startsWith('x:') ? 'Расширение: ' + (extNames[id] || 'удалено') : BTN_NAMES[id]);
			const sel = document.createElement('select');
			for (const p of ['tabs', 'toolbar', 'bmbar', 'extra']) sel.append(new Option(PANEL_NAMES[p], p));
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
		if (themes.keys.includes(el.dataset.setting)) {
			current = { ...current, [el.dataset.setting]: value };
			renderPresets(); // подсветка набора, который совпадает с текущей темой
		}
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
		await applyTheme({ accent: b.dataset.accent });
	});
});

$('ui-scale').addEventListener('change', () => applyTheme({ uiScale: Number($('ui-scale').value) }));

$('preset-save').addEventListener('click', () => run(async () => {
	const name = $('preset-name').value.trim();
	if (!name) throw new Error('Введи название набора');
	const theme = {};
	for (const k of themes.keys) theme[k] = current[k];
	const id = 't:' + Date.now().toString(36);
	current = await api.setSettings({ themePresets: [...(current.themePresets || []), { id, name, theme }] });
	$('preset-name').value = '';
	renderPresets();
	say('Набор «' + name + '» сохранён');
}));
$('preset-name').addEventListener('keydown', (e) => {
	if (e.key === 'Enter') $('preset-save').click();
});

$('view-history').addEventListener('click', () => run(() => api.openInNewTab('history')));

$('clear-visits').addEventListener('click', () => run(async () => {
	const sel = $('clear-period');
	const label = sel.selectedOptions[0].textContent.toLowerCase();
	if (!confirm(probletTr('Удалить историю посещений ' + label + '?'))) return;
	const n = await api.clearVisitsSince(sel.value);
	say(n ? 'Удалено записей: ' + n : 'За этот период записей не было');
	renderTop();
}));

const cacheBytes = (n) => {
	if (n < 1024) return n + ' Б';
	const u = ['КБ', 'МБ', 'ГБ', 'ТБ'];
	let i = -1;
	do {
		n /= 1024;
		i++;
	} while (n >= 1024 && i < u.length - 1);
	return n.toFixed(n < 10 ? 1 : 0) + ' ' + u[i];
};
async function renderCache() {
	$('cache-dir').textContent = current.cacheDir || 'По умолчанию (в папке данных браузера)';
	$('cache-dir-reset').classList.toggle('hidden', !current.cacheDir);
	try {
		$('cache-size').textContent = cacheBytes(await api.cacheSize());
	} catch (e) {
		$('cache-size').textContent = 'Не удалось узнать';
	}
}
$('offline-open').addEventListener('click', () => run(() => api.openInNewTab('offline')));
$('cache-size-refresh').addEventListener('click', () => run(renderCache));
$('cache-dir-pick').addEventListener('click', () => run(async () => {
	const r = await api.cacheDirPick();
	if (r.canceled) return;
	current = await api.setSettings({ cacheDir: r.path });
	await renderCache();
	say('Сохранено. Перезапусти браузер, чтобы кеш перешёл в новую папку');
}));
$('cache-dir-reset').addEventListener('click', () => run(async () => {
	current = await api.setSettings({ cacheDir: '' });
	await renderCache();
	say('Сохранено. Перезапусти браузер');
}));
$('cache-restart').addEventListener('click', () => run(() => api.restart()));
$('clear-cache').addEventListener('click', () => run(async () => {
	const r = await api.clearCache();
	say(r.message);
	await renderCache();
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

const extNames = {};
function iconEl(e) {
	const ico = document.createElement('div');
	ico.className = 'ico';
	if (e.icon && e.icon.icon) {
		const img = document.createElement('img');
		img.src = e.icon.icon;
		img.alt = '';
		ico.append(img);
	} else ico.textContent = (e.icon && e.icon.letter) || '🧩';
	return ico;
}
async function loadExtensions() {
	const list = await api.extList();
	for (const k of Object.keys(extNames)) delete extNames[k];
	for (const e of list) if (e.id) extNames['x:' + e.id] = e.name;
	if (current.btnLayout) renderPanels();
	const box = $('ext-list');
	box.textContent = '';
	for (const e of list) {
		const row = document.createElement('div');
		row.className = 'data-row';
		const what = document.createElement('div');
		what.className = 'what';
		const b = document.createElement('b');
		b.textContent = e.name + (e.version ? ' ' + e.version : '');
		const tag = document.createElement('span');
		tag.className = 'tag';
		tag.textContent = e.addon ? 'аддон Problet' : 'Chrome';
		b.append(tag);
		const sub = document.createElement('span');
		if (e.error) sub.textContent = 'Не загрузилось: ' + e.error;
		else if (e.addon) {
			const allowed = e.granted.filter((g) => g.allowed).map((g) => g.label);
			const denied = e.granted.filter((g) => !g.allowed).map((g) => g.label);
			sub.textContent = [e.description.replace(/\.$/, ''), allowed.length ? 'Разрешено: ' + allowed.join('; ') : '', denied.length ? 'Запрещено: ' + denied.join('; ') : ''].filter(Boolean).join('. ');
		} else sub.textContent = e.path;
		what.append(b, sub);
		const acts = document.createElement('div');
		acts.className = 'acts';
		if (e.addon && e.options) {
			const opt = document.createElement('button');
			opt.textContent = 'Настройки';
			opt.addEventListener('click', () => run(() => api.addonOptions(e.id)));
			acts.append(opt);
		}
		if (e.addon && e.granted.length) {
			const reset = document.createElement('button');
			reset.textContent = 'Сбросить разрешения';
			reset.title = 'Аддон снова спросит, прежде чем делать опасное';
			reset.addEventListener('click', () => run(async () => {
				await api.addonReset(e.id);
				say('Разрешения аддона «' + e.name + '» сброшены');
				await loadExtensions();
			}));
			acts.append(reset);
		}
		const del = document.createElement('button');
		del.className = 'danger';
		del.textContent = 'Удалить';
		del.addEventListener('click', () => run(async () => {
			if (e.addon) await api.addonRemove(e.id);
			else await api.extRemove(e.path);
			await loadExtensions();
		}));
		acts.append(del);
		row.append(iconEl(e), what, acts);
		box.append(row);
	}
}

// ---------- Добавление аддона Problet: из каталога, по ссылке, из архива ----------

const addonErr = (text) => { $('addon-error').textContent = text || ''; };
async function addonDone(r) {
	if (!r || r.canceled) return;
	say(r.message);
	$('addon-dialog').close();
	await loadExtensions();
}
async function loadCatalog() {
	const box = $('addon-catalog');
	box.textContent = '';
	const wait = Object.assign(document.createElement('div'), { className: 'empty', textContent: 'Загружаю список аддонов…' });
	box.append(wait);
	let list;
	try {
		list = await api.addonCatalog();
	} catch (e) {
		wait.textContent = 'Не удалось загрузить список: ' + errText(e);
		return;
	}
	box.textContent = '';
	if (!list.length) box.append(Object.assign(document.createElement('div'), { className: 'empty', textContent: 'В каталоге пока пусто' }));
	for (const x of list) {
		const item = document.createElement('div');
		item.className = 'item';
		const what = document.createElement('div');
		what.className = 'what';
		const b = document.createElement('b');
		b.textContent = x.name + (x.version ? ' ' + x.version : '');
		const d = document.createElement('span');
		d.textContent = x.description;
		what.append(b, d);
		const btn = document.createElement('button');
		const update = x.installed && x.installed !== x.version;
		btn.textContent = x.installed ? (update ? 'Обновить' : 'Установлен') : 'Установить';
		btn.className = x.installed && !update ? '' : 'primary';
		btn.disabled = !!x.installed && !update;
		btn.addEventListener('click', async () => {
			addonErr('');
			btn.disabled = true;
			try {
				await addonDone(await api.addonInstallCatalog(x.id));
			} catch (e) {
				addonErr(errText(e));
			}
			btn.disabled = false;
		});
		item.append(iconEl({ icon: { letter: x.icon } }), what, btn);
		box.append(item);
	}
}
$('addon-add').addEventListener('click', () => {
	addonErr('');
	$('addon-url').value = '';
	$('addon-dialog').showModal();
	loadCatalog();
});
$('addon-close').addEventListener('click', () => $('addon-dialog').close());
async function addonByUrl() {
	addonErr('');
	const v = $('addon-url').value.trim();
	if (!v) return addonErr('Вставь ссылку на addon.json');
	try {
		await addonDone(await api.addonInstallUrl(v));
	} catch (e) {
		addonErr(errText(e));
	}
}
$('addon-url-go').addEventListener('click', addonByUrl);
$('addon-url').addEventListener('keydown', (e) => {
	if (e.key === 'Enter') {
		e.preventDefault();
		addonByUrl();
	}
});
$('addon-zip').addEventListener('click', async () => {
	addonErr('');
	try {
		await addonDone(await api.addonInstallZip());
	} catch (e) {
		addonErr(errText(e));
	}
});
$('ext-add').addEventListener('click', () => run(async () => {
	const r = await api.extAdd();
	if (r && r.message) say(r.message);
	await loadExtensions();
}));

$('clear').addEventListener('click', () => run(async () => {
	if (!confirm(probletTr('Удалить всю историю поиска? Подсказки в адресной строке исчезнут.'))) return;
	await api.clearSearchHistory();
	say('История поиска очищена');
	await load();
}));

const loaded = run(load);
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

// Действия браузера и свои кнопки (у них клавиши по умолчанию нет)
const hkActions = () => [...accel.ACTIONS, ...(current.customButtons || []).map((c) => ({ id: c.id, label: 'Кнопка: ' + c.icon + ' ' + c.name, key: '' }))];
function effectiveKey(id) {
	const custom = current.hotkeys || {};
	return Object.hasOwn(custom, id) ? custom[id] : hkActions().find((a) => a.id === id).key;
}

function renderHotkeys() {
	hkEl.textContent = '';
	for (const a of hkActions()) {
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
	const owner = hkActions().find((a) => a.id !== id && value && effectiveKey(a.id) === value);
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
	$('blocked-total').textContent = s.total.toLocaleString(probletLocale());
	$('blocked-note').textContent = 'С запуска браузера: ' + s.session.toLocaleString(probletLocale()) + '. Число идёт с момента, когда включён блокировщик';
}

refreshBlocked().catch(() => {});
setInterval(() => {
	if (document.visibilityState === 'visible') refreshBlocked().catch(() => {});
}, 2000);

// Настройки могли измениться не здесь (поставили расширение, растянули панель вкладок, нарисовали значок кнопки): списки панелей и клавиш перечитываются
api.onChange((kinds) => {
	if (!kinds.includes('settings') && !kinds.includes('all')) return;
	if (recording || $('cb-dialog').open) return;
	if (kinds.includes('all')) run(loadExtensions);
	api.getSettings().then((r) => {
		current = r.settings;
		return loadExtensions(); // заодно перерисует «Панели»: в них названия расширений и аддонов
	}).catch(() => {});
});

// ---------- Закладки: папка по умолчанию, резервные копии, битые закладки ----------

async function renderBmDefault() {
	const st = await api.bookmarks();
	const sel = $('bm-default-folder');
	sel.textContent = '';
	sel.append(new Option('Без папки', ''), new Option('В последнюю выбранную', 'last'));
	for (const f of st.folders) sel.append(new Option('В папку «' + f.name + '»', f.id));
	sel.value = current.bmDefaultFolder || '';
	if (sel.value !== (current.bmDefaultFolder || '')) sel.value = '';
}
$('bm-default-folder').addEventListener('change', () => run(async () => {
	current = await api.setSettings({ bmDefaultFolder: $('bm-default-folder').value });
	say('Сохранено');
}));

const kb = (n) => (n < 1024 ? n + ' Б' : (n / 1024).toFixed(1).replace('.0', '') + ' КБ');
async function renderBackups() {
	const { dir, list } = await api.bmBackupList();
	$('bm-backup-dir').textContent = dir;
	$('bm-backup-reset').classList.toggle('hidden', !current.bmBackupDir);
	$('bm-backup-count').textContent = list.length ? 'Сохранено копий: ' + list.length + ', последняя ' + list[0].date : 'Копий пока нет';
	const box = $('bm-backups');
	box.textContent = '';
	for (const b of list.slice(0, 5)) {
		const item = document.createElement('div');
		item.className = 'item';
		const info = document.createElement('div');
		info.className = 'info';
		const t = document.createElement('b');
		t.textContent = b.date;
		const sub = document.createElement('small');
		sub.textContent = (b.count === null ? 'файл повреждён' : 'закладок: ' + b.count) + ' · ' + kb(b.size);
		info.append(t, sub);
		const btn = document.createElement('button');
		btn.textContent = 'Восстановить';
		btn.disabled = b.count === null;
		btn.addEventListener('click', () => run(async () => {
			if (!confirm(probletTr('Заменить все закладки и папки копией от ' + b.date + '? Текущие закладки перед этим сохранятся отдельной копией.'))) return;
			const r = await api.bmBackupRestore(b.name);
			say(r.message);
			await renderBackups();
			await renderBmDefault();
		}));
		item.append(info, btn);
		box.append(item);
	}
	if (list.length > 5) box.append(Object.assign(document.createElement('div'), { className: 'more', textContent: 'И ещё ' + (list.length - 5) + ' — в папке с копиями' }));
}
$('bm-backup-now').addEventListener('click', () => run(async () => {
	say((await api.bmBackupNow()).message);
	await renderBackups();
}));
$('bm-backup-pick').addEventListener('click', () => run(async () => {
	const r = await api.bmBackupDirPick();
	if (r.canceled) return;
	current = await api.setSettings({ bmBackupDir: r.path });
	await renderBackups();
	say('Сохранено');
}));
$('bm-backup-reset').addEventListener('click', () => run(async () => {
	current = await api.setSettings({ bmBackupDir: '' });
	await renderBackups();
	say('Сохранено');
}));
$('bm-backup-open').addEventListener('click', () => run(() => api.bmBackupOpen()));

api.onBmCheckProgress((done, total) => {
	$('bm-check-status').textContent = 'Проверено ' + done + ' из ' + total;
});
function renderBroken(list) {
	const box = $('bm-broken');
	box.textContent = '';
	const broken = list.filter((x) => x.kind === 'broken');
	for (const x of list) {
		const item = document.createElement('div');
		item.className = 'item';
		const info = document.createElement('div');
		info.className = 'info';
		const t = document.createElement('b');
		t.textContent = x.title;
		const url = document.createElement('small');
		url.textContent = (x.folder ? x.folder + ' · ' : '') + x.url;
		const why = document.createElement('small');
		why.className = x.kind === 'broken' ? 'bad' : 'warn';
		why.textContent = (x.kind === 'broken' ? 'Не открывается: ' : 'Возможно, временно: ') + x.reason;
		info.append(t, url, why);
		const open = document.createElement('button');
		open.textContent = 'Открыть';
		open.addEventListener('click', () => run(() => api.folderOpen(x.url, true)));
		const del = document.createElement('button');
		del.className = 'danger';
		del.textContent = 'Удалить';
		del.addEventListener('click', () => run(async () => {
			await api.removeBookmark(x.id);
			renderBroken(list.filter((y) => y !== x));
			say('Закладка удалена');
		}));
		item.append(info, open, del);
		box.append(item);
	}
	if (broken.length > 1) {
		const bar = document.createElement('div');
		bar.className = 'bm-actions';
		const all = document.createElement('button');
		all.className = 'danger';
		all.textContent = 'Удалить все неоткрывающиеся (' + broken.length + ')';
		all.addEventListener('click', () => run(async () => {
			if (!confirm(probletTr('Удалить ' + broken.length + ' закладок, которые больше не открываются?'))) return;
			for (const x of broken) await api.removeBookmark(x.id);
			renderBroken(list.filter((y) => y.kind !== 'broken'));
			say('Удалено закладок: ' + broken.length);
		}));
		bar.append(all);
		box.append(bar);
	}
}
$('bm-check').addEventListener('click', () => run(async () => {
	$('bm-check').disabled = true;
	$('bm-broken').textContent = '';
	$('bm-check-status').textContent = 'Проверяю…';
	try {
		const list = await api.bmCheck();
		$('bm-check-status').textContent = list.length ? 'Не открываются: ' + list.filter((x) => x.kind === 'broken').length + ', под вопросом: ' + list.filter((x) => x.kind === 'maybe').length : 'Все закладки открываются';
		renderBroken(list);
	} catch (e) {
		$('bm-check-status').textContent = 'Проверить, какие адреса больше не открываются';
		throw e;
	} finally {
		$('bm-check').disabled = false;
	}
}));

run(async () => {
	await loaded;
	await renderBmDefault();
	await renderBackups();
	await renderCache();
});
api.onChange((kinds) => {
	if (kinds.includes('bookmarks') || kinds.includes('all')) run(renderBmDefault);
});

// ---------- Префиксы поисковиков ----------

let kwDraft = [];
function kwDirty(on) {
	$('kw-save').disabled = !on;
}
function renderKeywords() {
	const box = $('kw-list');
	box.textContent = '';
	kwDraft.forEach((k, i) => {
		const row = document.createElement('div');
		row.className = 'kw-row';
		const field = (key, ph, cls) => {
			const inp = document.createElement('input');
			inp.type = 'text';
			inp.value = k[key];
			inp.placeholder = ph;
			inp.className = cls;
			inp.spellcheck = false;
			inp.addEventListener('input', () => {
				k[key] = inp.value;
				kwDirty(true);
			});
			return inp;
		};
		const del = document.createElement('button');
		del.className = 'kw-del';
		del.textContent = '✕';
		del.title = 'Убрать префикс';
		del.addEventListener('click', () => {
			kwDraft.splice(i, 1);
			kwDirty(true);
			renderKeywords();
		});
		row.append(field('key', 'w', 'kw-key'), field('name', 'Название', 'kw-name'), field('url', 'https://…?q=%s', 'kw-url'), del);
		box.append(row);
	});
}
function loadKeywords() {
	kwDraft = (current.searchKeywords || []).map((k) => ({ ...k }));
	kwDirty(false);
	renderKeywords();
}
$('kw-add').addEventListener('click', () => {
	kwDraft.push({ key: '', name: '', url: '' });
	kwDirty(true);
	renderKeywords();
	const keys = document.querySelectorAll('#kw-list .kw-key');
	keys[keys.length - 1].focus();
});
$('kw-reset').addEventListener('click', () => run(async () => {
	if (!confirm(probletTr('Вернуть стандартный набор префиксов? Свои префиксы пропадут.'))) return;
	current = await api.setSettings({ searchKeywords: defaultKeywords });
	loadKeywords();
	say('Префиксы сброшены');
}));
$('kw-save').addEventListener('click', () => run(async () => {
	const list = kwDraft.filter((k) => k.key.trim() || k.name.trim() || k.url.trim());
	current = await api.setSettings({ searchKeywords: list });
	loadKeywords();
	say('Префиксы сохранены');
}));

// ---------- Счётчик посещений ----------

async function renderTop() {
	const box = $('top-list');
	box.textContent = '';
	const list = await api.topSites();
	for (const s of list) {
		const row = document.createElement('div');
		row.className = 'top-row';
		const host = document.createElement('span');
		host.className = 'host';
		host.textContent = s.host;
		const n = document.createElement('span');
		n.className = 'count';
		n.textContent = s.count + ' ' + plural(s.count, 'посещение', 'посещения', 'посещений');
		row.append(host, n);
		box.append(row);
	}
}
function plural(n, one, few, many) {
	const m10 = n % 10;
	const m100 = n % 100;
	if (m10 === 1 && m100 !== 11) return one;
	if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
	return many;
}
$('lang-restart').addEventListener('click', () => run(() => api.restart()));
document.querySelector('[data-setting="topSites"]').addEventListener('change', () => setTimeout(() => run(renderTop), 100));

run(async () => {
	await loaded;
	loadKeywords();
	await renderTop();
});
