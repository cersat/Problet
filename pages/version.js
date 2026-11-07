const $ = (id) => document.getElementById(id);
const MASKS = { chrome: 'Chrome', problet: 'Problet', firefox: 'Firefox' };
let text = '';

function row(label, value, wide) {
	const card = document.createElement('div');
	card.className = 'cell' + (wide ? ' wide' : '');
	const l = document.createElement('span');
	l.textContent = label;
	const v = document.createElement('b');
	v.textContent = value;
	card.append(l, v);
	$('grid').append(card);
}

function updateText(st) {
	const t = {
		uptodate: 'Установлена последняя версия',
		available: 'Доступна версия ' + st.version,
		downloading: 'Скачивается версия ' + st.version + ': ' + st.progress + '%',
		ready: 'Версия ' + st.version + ' скачана, нужен перезапуск',
		checking: 'Проверяю…',
		error: 'Не удалось проверить обновления',
	};
	$('upd').textContent = t[st.status] || '';
}

async function load() {
	const info = await api.versionInfo();
	$('ver').textContent = 'Версия ' + info.version;
	$('grid').textContent = '';
	const items = [
		['Problet', info.version],
		['Chromium', info.chromium],
		['Electron', info.electron],
		['Node.js', info.node],
		['V8', info.v8],
		['Система', info.os + ', ' + info.arch],
		['Сборка', info.packaged ? 'установленная' : 'запуск из исходников'],
		['Маскировка под браузер', MASKS[info.mask] || info.mask],
	];
	for (const [k, v] of items) row(k, v);
	$('grid').firstElementChild.dataset.tap = ''; // карточка «Problet — версия»
	row('User-Agent', info.userAgent, true);
	row('Папка с данными', info.data, true);
	text = items.map(([k, v]) => k + ': ' + v).join('\n') + '\nUser-Agent: ' + info.userAgent;
	updateText(await api.updateState());
}

$('copy').addEventListener('click', async () => {
	try {
		await navigator.clipboard.writeText(text);
		$('status').textContent = 'Скопировано';
	} catch (e) {
		$('status').textContent = 'Не удалось скопировать';
	}
});

$('check').addEventListener('click', async () => {
	$('upd').textContent = 'Проверяю…';
	updateText(await api.checkUpdate());
});

load().catch((e) => {
	$('status').textContent = String((e && e.message) || e);
});

// Семь нажатий подряд на версию в карточке открывают меню отладки (оно же по адресу problet://version/debug/)
let taps = 0;
let tapTimer = null;
$('grid').addEventListener('click', (e) => {
	const cell = e.target.closest('.cell');
	if (!cell || cell.dataset.tap === undefined) return;
	taps++;
	clearTimeout(tapTimer);
	tapTimer = setTimeout(() => { taps = 0; }, 2000);
	if (taps >= 7) location.assign('problet://version/debug/');
});
