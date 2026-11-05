const list = document.getElementById('list');

function makeRow(item, index, selected) {
	const row = document.createElement('div');
	row.className = 'row' + (index === selected ? ' selected' : '');

	const icon = document.createElement('span');
	icon.className = 'icon';
	icon.textContent = item.type === 'calc' ? '=' : item.type === 'page' ? '↗' : '↺';

	const text = document.createElement('span');
	text.className = 'text';
	if (item.type === 'calc') {
		const expr = document.createElement('span');
		expr.className = 'dim';
		expr.textContent = item.label + ' = ';
		const result = document.createElement('b');
		result.textContent = item.text;
		text.append(expr, result);
	} else if (item.type === 'page') {
		text.textContent = item.label || item.text;
		const url = document.createElement('span');
		url.className = 'dim';
		url.textContent = '  —  ' + item.text;
		text.append(url);
	} else {
		text.textContent = item.text;
	}
	row.append(icon, text);

	if (item.type === 'history') {
		const del = document.createElement('button');
		del.className = 'del';
		del.textContent = '×';
		del.title = 'Удалить из истории поиска';
		del.addEventListener('mousedown', (e) => {
			e.preventDefault();
			e.stopPropagation();
			api.remove(index);
		});
		row.append(del);
	}

	row.addEventListener('mousedown', (e) => {
		e.preventDefault();
		api.pick(index);
	});
	return row;
}

api.onRender(({ items, selected }) => {
	list.textContent = '';
	items.forEach((item, i) => list.append(makeRow(item, i, selected)));
});
