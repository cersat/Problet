const list = document.getElementById('list');
const statusEl = document.getElementById('status');
let last = '';

function say(text, bad) {
	statusEl.textContent = text;
	statusEl.className = bad ? 'status bad' : 'status';
}

const errText = (e) => String((e && e.message) || e).replace(/^Error invoking remote method '[^']*': (Error: )?/, '');

function size(n) {
	if (!n) return '0 Б';
	const units = ['Б', 'КБ', 'МБ', 'ГБ'];
	let i = 0;
	while (n >= 1024 && i < units.length - 1) {
		n /= 1024;
		i++;
	}
	return (i ? n.toFixed(1) : n) + ' ' + units[i];
}

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

function row(d) {
	const el = document.createElement('div');
	el.className = 'item download';
	const info = document.createElement('div');
	info.className = 'info';
	const name = document.createElement('span');
	name.className = 'title';
	name.textContent = d.name;
	const sub = document.createElement('span');
	sub.className = 'url';
	if (d.state === 'progressing') {
		sub.textContent = d.total ? size(d.received) + ' из ' + size(d.total) : size(d.received);
	} else if (d.state === 'done') {
		sub.textContent = d.missing ? 'Файл удалён или перемещён' : 'Готово · ' + size(d.total);
	} else {
		sub.textContent = d.state === 'cancelled' ? 'Отменено' : 'Не удалось скачать';
	}
	info.append(name, sub);
	if (d.state === 'progressing') {
		const bar = document.createElement('div');
		bar.className = 'bar';
		const fill = document.createElement('i');
		fill.style.width = (d.total ? Math.min(100, (d.received / d.total) * 100) : 100) + '%';
		if (!d.total) fill.className = 'indeterminate';
		bar.append(fill);
		info.append(bar);
	}
	el.append(info);
	if (d.state === 'progressing') {
		el.append(button('Отмена', () => api.cancelDownload(d.id)));
	} else {
		if (d.state === 'done' && !d.missing) {
			el.append(button('Открыть', () => api.openDownload(d.id)), button('В папке', () => api.showDownload(d.id)));
		}
		el.append(button('×', () => api.removeDownload(d.id).then(refresh), 'icon-btn always'));
	}
	return el;
}

async function refresh() {
	let items;
	try {
		items = await api.downloads();
	} catch (e) {
		return;
	}
	const sig = JSON.stringify(items);
	if (sig === last) return;
	last = sig;
	list.textContent = '';
	if (!items.length) {
		const empty = document.createElement('p');
		empty.className = 'empty';
		empty.textContent = 'Загрузок пока нет';
		list.append(empty);
		return;
	}
	for (const d of items) list.append(row(d));
}

document.getElementById('clear').addEventListener('click', async () => {
	await api.clearDownloads();
	await refresh();
});

refresh();
setInterval(() => {
	if (!document.hidden) refresh();
}, 700);
