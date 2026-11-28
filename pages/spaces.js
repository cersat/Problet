const $ = (id) => document.getElementById(id);
let state = { spaces: [], current: '' };
let editing = '';
let opened = '';

function button(text, title, onClick, cls) {
	const b = document.createElement('button');
	b.textContent = text;
	b.title = title;
	if (cls) b.className = cls;
	b.addEventListener('click', (e) => {
		e.stopPropagation();
		onClick();
	});
	return b;
}

function render() {
	const list = $('list');
	list.textContent = '';
	for (const s of state.spaces) {
		const li = document.createElement('li');
		li.className = 'row' + (s.id === state.current ? ' current' : '');
		if (editing === s.id) {
			const input = document.createElement('input');
			input.type = 'text';
			input.value = s.name;
			input.maxLength = 40;
			const done = async (save) => {
				editing = '';
				if (save && input.value.trim() && input.value.trim() !== s.name) await problet.spacesRename(s.id, input.value.trim());
				load();
			};
			input.addEventListener('keydown', (e) => {
				if (e.key === 'Enter') done(true);
				else if (e.key === 'Escape') {
					e.stopPropagation();
					done(false);
				}
			});
			input.addEventListener('blur', () => done(true));
			li.append(input);
			setTimeout(() => { input.focus(); input.select(); });
		} else {
			const nm = document.createElement('span');
			nm.className = 'nm';
			nm.textContent = s.name;
			const cnt = document.createElement('span');
			cnt.className = 'cnt';
			cnt.textContent = s.count;
			cnt.title = 'Вкладок в пространстве';
			li.append(nm);
			for (const [flag, text] of [['incognito', 'инкогнито'], ['local', 'локальное']]) {
				if (!s[flag]) continue;
				const tag = document.createElement('span');
				tag.className = 'tag';
				tag.textContent = text;
				li.append(tag);
			}
			li.append(cnt, button('Переименовать', 'Переименовать', () => { editing = s.id; render(); }));
			if (s.id !== 'main') li.append(button('Настройки', 'Настройки пространства', () => { opened = opened === s.id ? '' : s.id; render(); }));
			if (s.id !== 'main') li.append(button('Удалить', 'Удалить пространство: вкладки уйдут в «Основное»', () => problet.spacesRemove(s.id).then(load), 'danger'));
			li.addEventListener('click', () => {
				if (s.id === state.current) return;
				problet.spacesSwitch(s.id).then(load);
			});
		}
		list.append(li);
		if (opened === s.id && s.id !== 'main') list.append(options(s));
	}
}

// Строка с настройками пространства под ним
function options(s) {
	const li = document.createElement('li');
	li.className = 'row opts';
	for (const [flag, name, note] of [
		['incognito', 'Пространство инкогнито', 'Новые вкладки в нём открываются как инкогнито: без истории, куков и кеша на диске. Уже открытые вкладки остаются как были'],
		['local', 'Локальное пространство', 'Не синхронизируется с аккаунтом: ни само пространство, ни его вкладки на другие устройства не попадают'],
	]) {
		const row = document.createElement('div');
		row.className = 'setting';
		const what = document.createElement('div');
		what.className = 'what';
		what.textContent = name;
		const small = document.createElement('small');
		small.textContent = note;
		what.append(small);
		const label = document.createElement('label');
		label.className = 'switch';
		const input = document.createElement('input');
		input.type = 'checkbox';
		input.checked = !!s[flag];
		input.addEventListener('change', () => problet.spacesSetFlag(s.id, flag, input.checked).then(load));
		label.append(input, document.createElement('span'));
		row.append(what, label);
		li.append(row);
	}
	li.addEventListener('click', (e) => e.stopPropagation());
	return li;
}

async function load() {
	state = await problet.spaces();
	render();
}

$('add').addEventListener('submit', async (e) => {
	e.preventDefault();
	await problet.spacesAdd($('name').value);
	$('name').value = '';
	load();
});

problet.onChange((kinds) => {
	if (kinds.includes('spaces') && !editing) load();
});
load();
