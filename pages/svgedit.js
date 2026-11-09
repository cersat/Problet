const $ = (id) => document.getElementById(id);
const file = new URLSearchParams(location.search).get('p') || '';
let saved = '';
let zoom = 1;
let timer = null;
let blobUrl = '';

$('file').textContent = file;
document.title = (file.split(/[\\/]/).pop() || 'SVG') + ' — редактор';

function say(text, ms) {
	$('state').textContent = text;
	if (ms) setTimeout(() => { if ($('state').textContent === text) updateState(); }, ms);
}
function updateState() {
	$('state').textContent = $('src').value === saved ? 'Сохранено' : 'Есть несохранённые изменения';
}

function parse(text) {
	const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
	const bad = doc.querySelector('parsererror');
	if (bad) return { error: bad.textContent.split('\n').find((l) => l.trim() && !/^This page|Below is/.test(l)) || 'Ошибка разбора' };
	if (doc.documentElement.localName !== 'svg') return { error: 'Корневой элемент должен быть <svg>' };
	return { doc };
}

const TEMPLATE = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">\n  \n</svg>\n';

function preview() {
	const text = $('src').value;
	if (!text.trim()) {
		// Пустой файл: не ошибка, просто нечего показывать
		$('err').hidden = true;
		$('img').removeAttribute('src');
		$('size').textContent = 'Пусто';
		return;
	}
	const r = parse(text);
	$('err').hidden = !r.error;
	$('err').textContent = r.error || '';
	if (r.error) return;
	if (blobUrl) URL.revokeObjectURL(blobUrl);
	blobUrl = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
	$('img').src = blobUrl;
}
$('img').addEventListener('load', () => {
	const img = $('img');
	$('size').textContent = img.naturalWidth + ' × ' + img.naturalHeight + ' пикс.';
	applyZoom();
});

function applyZoom() {
	const img = $('img');
	img.style.width = img.naturalWidth * zoom + 'px';
	img.style.height = img.naturalHeight * zoom + 'px';
	$('zoom-fit').textContent = Math.round(zoom * 100) + '%';
}
function fit() {
	const img = $('img');
	const box = $('stage');
	if (!img.naturalWidth) return;
	zoom = Math.min((box.clientWidth - 40) / img.naturalWidth, (box.clientHeight - 40) / img.naturalHeight);
	zoom = Math.max(0.05, Math.min(zoom, 8));
	applyZoom();
}

// Простое форматирование: каждый тег с новой строки, вложенность отступами
function pretty(text) {
	const r = parse(text);
	if (r.error) throw new Error(r.error);
	const out = [];
	const walk = (node, depth) => {
		const pad = '  '.repeat(depth);
		if (node.nodeType === 3) {
			const t = node.textContent.trim();
			if (t) out.push(pad + t.replace(/&/g, '&amp;').replace(/</g, '&lt;'));
			return;
		}
		if (node.nodeType === 8) {
			out.push(pad + '<!--' + node.textContent + '-->');
			return;
		}
		if (node.nodeType !== 1) return;
		const attrs = [...node.attributes].map((a) => ' ' + a.name + '="' + a.value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;') + '"').join('');
		const kids = [...node.childNodes].filter((c) => c.nodeType !== 3 || c.textContent.trim());
		if (!kids.length) {
			out.push(pad + '<' + node.tagName + attrs + '/>');
			return;
		}
		if (kids.length === 1 && kids[0].nodeType === 3) {
			out.push(pad + '<' + node.tagName + attrs + '>' + kids[0].textContent.trim().replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</' + node.tagName + '>');
			return;
		}
		out.push(pad + '<' + node.tagName + attrs + '>');
		for (const k of kids) walk(k, depth + 1);
		out.push(pad + '</' + node.tagName + '>');
	};
	walk(r.doc.documentElement, 0);
	return out.join('\n') + '\n';
}

async function save() {
	try {
		await api.svgWrite(file, $('src').value);
		saved = $('src').value;
		say('Сохранено');
	} catch (e) {
		say('Не удалось сохранить: ' + String((e && e.message) || e).replace(/^Error invoking remote method '[^']*': (Error: )?/, ''));
	}
}

$('src').addEventListener('input', () => {
	updateState();
	clearTimeout(timer);
	timer = setTimeout(preview, 200);
});
$('src').addEventListener('keydown', (e) => {
	if (e.key === 'Tab') {
		e.preventDefault();
		const t = e.target;
		t.setRangeText('  ', t.selectionStart, t.selectionEnd, 'end');
		t.dispatchEvent(new Event('input'));
	}
});
document.addEventListener('keydown', (e) => {
	if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
		e.preventDefault();
		save();
	}
});
$('save').addEventListener('click', save);
$('save-as').addEventListener('click', async () => {
	try {
		const r = await api.svgSaveAs($('src').value);
		if (r) say('Сохранено в ' + r.path, 4000);
	} catch (e) {
		say(String((e && e.message) || e));
	}
});
$('format').addEventListener('click', () => {
	try {
		$('src').value = pretty($('src').value);
		$('src').dispatchEvent(new Event('input'));
	} catch (e) {
		say('Нельзя отформатировать: ' + e.message, 4000);
	}
});
$('copy').addEventListener('click', async () => {
	try {
		await navigator.clipboard.writeText($('src').value);
		say('Скопировано', 2000);
	} catch (e) {
		$('src').select();
		say('Выделено: нажми Ctrl+C', 3000);
	}
});
$('raw').addEventListener('click', () => api.filesOpen(file, true));
$('bg').addEventListener('click', (e) => {
	const b = e.target.closest('button[data-bg]');
	if (!b) return;
	for (const x of $('bg').children) x.classList.toggle('on', x === b);
	$('stage').className = 'stage ' + b.dataset.bg;
});
$('zoom-in').addEventListener('click', () => { zoom = Math.min(zoom * 1.25, 16); applyZoom(); });
$('zoom-out').addEventListener('click', () => { zoom = Math.max(zoom / 1.25, 0.05); applyZoom(); });
$('zoom-fit').addEventListener('click', fit);

api.svgRead(file).then((r) => {
	saved = r.text;
	$('src').value = r.text.trim() ? r.text : TEMPLATE; // пустой файл начинаем с заготовки; в файл она попадёт только после сохранения
	updateState();
	preview();
	if (!r.text.trim()) {
		$('src').focus();
		$('src').setSelectionRange(TEMPLATE.indexOf('\n') + 3, TEMPLATE.indexOf('\n') + 3);
	}
}).catch((e) => {
	$('err').hidden = false;
	$('err').textContent = 'Не удалось открыть файл: ' + String((e && e.message) || e).replace(/^Error invoking remote method '[^']*': (Error: )?/, '');
});
