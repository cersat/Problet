const list = document.getElementById('list');
const statusEl = document.getElementById('status');
const q = document.getElementById('q');
let items = [];

const failEl = document.getElementById('fails');
function say(text, bad) {
	failEl.textContent = '';
	statusEl.textContent = text;
	statusEl.className = bad ? 'status bad' : 'status';
}
const errText = (e) => String((e && e.message) || e).replace(/^Error invoking remote method '[^']*': (Error: )?/, '');

function size(n) {
	const units = ['Б', 'КБ', 'МБ', 'ГБ'];
	let i = 0;
	while (n >= 1024 && i < units.length - 1) {
		n /= 1024;
		i++;
	}
	return (i ? n.toFixed(1) : n) + ' ' + units[i];
}
const when = (t) => new Date(t).toLocaleString(probletLocale(), { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

function button(text, onClick, cls) {
	const b = document.createElement('button');
	b.textContent = text;
	if (cls) b.className = cls;
	b.addEventListener('click', async () => {
		try {
			await onClick();
		} catch (e) {
			say(errText(e), true);
		}
	});
	return b;
}

function row(e) {
	const el = document.createElement('div');
	el.className = 'item';
	const info = document.createElement('div');
	info.className = 'info';
	const title = document.createElement('span');
	title.className = 'title';
	title.textContent = e.title;
	const sub = document.createElement('span');
	sub.className = 'url';
	sub.textContent = e.url;
	const meta = document.createElement('span');
	meta.className = 'url';
	meta.textContent = e.missing ? 'Файл удалён' : when(e.savedAt) + ' · ' + size(e.size);
	info.append(title, sub, meta);
	el.append(info);
	if (!e.missing) el.append(button('Открыть', () => api.offlineOpen(e.id)));
	el.append(button('×', async () => {
		await api.offlineDelete(e.id);
		await refresh();
	}, 'icon-btn always'));
	return el;
}

function render() {
	const text = q.value.trim().toLowerCase();
	const shown = items.filter((e) => !text || e.title.toLowerCase().includes(text) || e.url.toLowerCase().includes(text));
	list.textContent = '';
	if (!shown.length) {
		const empty = document.createElement('p');
		empty.className = 'empty';
		empty.textContent = items.length ? 'Ничего не найдено' : 'Сохранённых страниц пока нет';
		list.append(empty);
		return;
	}
	for (const e of shown) list.append(row(e));
}

async function refresh() {
	try {
		items = await api.offlineList();
	} catch (e) {
		return;
	}
	render();
}

q.addEventListener('input', render);
document.getElementById('save-all').addEventListener('click', async (ev) => {
	ev.target.disabled = true;
	say('Сохраняю…');
	try {
		const r = await api.offlineSaveAll();
		if (!r.saved && !r.failed.length) say('Нет страниц из интернета для сохранения', true);
		else {
			say('Сохранено: ' + r.saved, !r.saved);
			if (r.failed.length) failEl.textContent = 'Не удалось: ' + r.failed.length + ' (' + r.failed[0] + ')';
		}
		await refresh();
	} catch (e) {
		say(errText(e), true);
	} finally {
		ev.target.disabled = false;
	}
});

refresh();
window.addEventListener('focus', refresh);
