const list = document.getElementById('list');
const search = document.getElementById('search');
const MAX_ROWS = 500;
let visits = [];

const pad = (n) => String(n).padStart(2, '0');
const timeOf = (t) => pad(new Date(t).getHours()) + ':' + pad(new Date(t).getMinutes()); // 24 часа
const dayKey = (t) => new Date(t).toDateString();

function dayLabel(t) {
	const today = new Date();
	const yesterday = new Date(today.getTime() - 86400000);
	if (dayKey(t) === today.toDateString()) return 'Сегодня';
	if (dayKey(t) === yesterday.toDateString()) return 'Вчера';
	return new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

function render() {
	const words = search.value.toLowerCase().split(/\s+/).filter(Boolean);
	const shown = visits.filter((v) => {
		const hay = (v.title + ' ' + v.url).toLowerCase();
		return words.every((w) => hay.includes(w));
	});
	list.textContent = '';
	if (!shown.length) {
		const empty = document.createElement('p');
		empty.className = 'empty';
		empty.textContent = visits.length ? 'Ничего не найдено' : 'История пока пуста';
		list.append(empty);
		return;
	}
	let lastDay = '';
	for (const v of shown.slice(0, MAX_ROWS)) {
		if (dayKey(v.time) !== lastDay) {
			lastDay = dayKey(v.time);
			const h = document.createElement('div');
			h.className = 'day';
			h.textContent = dayLabel(v.time);
			list.append(h);
		}
		const row = document.createElement('div');
		row.className = 'item';
		const time = document.createElement('span');
		time.className = 'time';
		time.textContent = timeOf(v.time);
		const info = document.createElement('div');
		info.className = 'info';
		const a = document.createElement('a');
		a.className = 'title';
		a.href = v.url;
		a.textContent = v.title || v.url;
		const url = document.createElement('span');
		url.className = 'url';
		url.textContent = v.url;
		info.append(a, url);
		const del = document.createElement('button');
		del.className = 'icon-btn';
		del.title = 'Удалить из истории';
		del.textContent = '×';
		del.addEventListener('click', async () => {
			await api.removeVisit(v.id);
			visits = visits.filter((x) => x.id !== v.id);
			render();
		});
		row.append(time, info, del);
		list.append(row);
	}
	if (shown.length > MAX_ROWS) {
		const more = document.createElement('p');
		more.className = 'empty';
		more.textContent = 'Показано ' + MAX_ROWS + ' из ' + shown.length + '. Уточни поиск, чтобы увидеть остальные.';
		list.append(more);
	}
}

search.addEventListener('input', render);
document.getElementById('clear').addEventListener('click', async () => {
	if (!visits.length || !confirm('Удалить всю историю посещений?')) return;
	await api.clearVisits();
	visits = [];
	render();
});

async function reload() {
	visits = await api.visits();
	render();
}

reload();
api.onChange((kinds) => {
	if (kinds.includes('visits') || kinds.includes('all')) reload();
});
