const $ = (id) => document.getElementById(id);
if (new URLSearchParams(location.search).has('popup')) document.body.classList.add('popup');
let state = { spaces: [], current: '' };
let editing = '';

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
				if (save && input.value.trim() && input.value.trim() !== s.name) await api.spacesRename(s.id, input.value.trim());
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
			li.append(nm, cnt, button('Переименовать', 'Переименовать', () => { editing = s.id; render(); }));
			if (s.id !== 'main') li.append(button('Удалить', 'Удалить пространство: вкладки уйдут в «Основное»', () => api.spacesRemove(s.id).then(load), 'danger'));
			li.addEventListener('click', () => {
				if (s.id === state.current) return;
				api.spacesSwitch(s.id).then(() => {
					if (document.body.classList.contains('popup')) api.panelClose();
					else load();
				});
			});
		}
		list.append(li);
	}
}

async function load() {
	state = await api.spaces();
	render();
}

$('add').addEventListener('submit', async (e) => {
	e.preventDefault();
	await api.spacesAdd($('name').value);
	$('name').value = '';
	if (document.body.classList.contains('popup')) api.panelClose();
	else load();
});

document.addEventListener('keydown', (e) => {
	if (e.key === 'Escape' && document.body.classList.contains('popup')) api.panelClose();
});
api.onChange((kinds) => {
	if (kinds.includes('spaces') && !editing) load();
});
load();
