// Блокнот Problet: problet://notepad/ — свой лист (файл .pmd в папке Problet) или текстовый файл: problet://notepad/?f=<путь>
const $ = (id) => document.getElementById(id);
const file = new URLSearchParams(location.search).get('f') || '';
const ed = $('editor');
const view = $('view');
let kind = 'pmd'; // pmd — разметка HTML, md, html, code, text
let path = '';
let dirty = false;
let timer = 0;

const CODE = 'js mjs ts json css xml py c h cpp hpp java rs go sh yml yaml toml ini conf cfg csv tsv log';
const extOf = (p) => (p.includes('.') ? p.split('.').pop().toLowerCase() : '');
function kindOf(p) {
	if (!p) return 'pmd';
	const e = extOf(p);
	if (e === 'pmd') return 'pmd';
	if (e === 'md') return 'md';
	if (e === 'html' || e === 'htm' || e === 'xhtml') return 'html';
	return CODE.split(' ').includes(e) ? 'code' : 'text';
}
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Убирает из чужой разметки всё, что исполняется: скрипты, встроенные страницы, обработчики событий, javascript:
function clean(html) {
	const doc = new DOMParser().parseFromString(html, 'text/html');
	doc.querySelectorAll('script,iframe,object,embed,frame,frameset,link[rel=import],meta[http-equiv]').forEach((n) => n.remove());
	for (const n of doc.querySelectorAll('*')) {
		for (const a of [...n.attributes]) {
			if (/^on/i.test(a.name) || (/^(href|src|action|formaction|xlink:href)$/i.test(a.name) && /^\s*javascript:/i.test(a.value))) n.removeAttribute(a.name);
		}
	}
	return doc.body.innerHTML;
}

// Небольшой разбор markdown: заголовки, списки, цитаты, блоки кода, жирный, курсив, код, ссылки
function inline(s) {
	s = esc(s);
	s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
	s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*]+)\*/g, '$1<i>$2</i>');
	s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img alt="$1" src="$2" style="max-width:100%">');
	s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
	return s;
}
function renderMd(src) {
	const out = [];
	const lines = src.replace(/\r/g, '').split('\n');
	let list = '';
	let para = [];
	const endPara = () => {
		if (para.length) out.push('<p>' + para.map(inline).join('<br>') + '</p>');
		para = [];
	};
	const endList = () => {
		if (list) out.push('</' + list + '>');
		list = '';
	};
	for (let i = 0; i < lines.length; i++) {
		const l = lines[i];
		if (/^```/.test(l)) {
			endPara();
			endList();
			const code = [];
			for (i++; i < lines.length && !/^```/.test(lines[i]); i++) code.push(lines[i]);
			out.push('<pre><code>' + esc(code.join('\n')) + '</code></pre>');
			continue;
		}
		let m = /^(#{1,6})\s+(.*)$/.exec(l);
		if (m) {
			endPara();
			endList();
			out.push('<h' + m[1].length + '>' + inline(m[2]) + '</h' + m[1].length + '>');
			continue;
		}
		m = /^\s*([-*]|\d+\.)\s+(.*)$/.exec(l);
		if (m) {
			endPara();
			const tag = /\d/.test(m[1]) ? 'ol' : 'ul';
			if (list !== tag) {
				endList();
				out.push('<' + tag + '>');
				list = tag;
			}
			out.push('<li>' + inline(m[2]) + '</li>');
			continue;
		}
		if (/^>\s?/.test(l)) {
			endPara();
			endList();
			out.push('<blockquote>' + inline(l.replace(/^>\s?/, '')) + '</blockquote>');
			continue;
		}
		if (/^\s*(---|\*\*\*)\s*$/.test(l)) {
			endPara();
			endList();
			out.push('<hr>');
			continue;
		}
		if (!l.trim()) {
			endPara();
			endList();
			continue;
		}
		endList();
		para.push(l);
	}
	endPara();
	endList();
	return clean(out.join('\n'));
}

const getText = () => (kind === 'pmd' ? clean(ed.innerHTML) : ed.innerText.replace(/\n$/, ''));
function setText(t) {
	if (kind === 'pmd') ed.innerHTML = clean(t);
	else ed.textContent = t;
}

function showView() {
	const t = getText();
	view.className = '';
	view.textContent = '';
	if (kind === 'pmd') view.innerHTML = t;
	else if (kind === 'md') view.innerHTML = renderMd(t);
	else if (kind === 'html') {
		view.className = 'frame';
		const f = document.createElement('iframe');
		f.setAttribute('sandbox', '');
		f.srcdoc = '<meta http-equiv="Content-Security-Policy" content="script-src \'none\'">' + clean(t);
		view.append(f);
	} else {
		view.className = kind;
		// пробелы и табы показываем знаками, чтобы отступы были видны
		view.innerHTML = esc(t).replace(/\t/g, '<span class="sp">→\t</span>').replace(/ /g, '<span class="sp">·</span>');
	}
}

function mode(m) {
	const v = m === 'view';
	if (v) showView();
	view.classList.toggle('hidden', !v);
	ed.classList.toggle('hidden', v);
	$('m-edit').classList.toggle('on', !v);
	$('m-view').classList.toggle('on', v);
	$('marks').classList.toggle('hidden', v);
	if (!v) ed.focus();
}
$('m-edit').addEventListener('click', () => mode('edit'));
$('m-view').addEventListener('click', () => mode('view'));

function state(t, bad) {
	$('state').textContent = t;
	$('state').style.color = bad ? 'var(--danger)' : '';
}
async function save() {
	clearTimeout(timer);
	try {
		await problet.notepadWrite(file, getText());
		dirty = false;
		state('Сохранено');
	} catch (e) {
		state(String((e && e.message) || e).replace(/^Error invoking remote method '[^']*': (Error: )?/, ''), true);
	}
}
$('save').addEventListener('click', save);
ed.addEventListener('input', () => {
	dirty = true;
	state('Не сохранено');
	clearTimeout(timer);
	if (!file) timer = setTimeout(save, 600); // свой лист сохраняется сам
});
addEventListener('keydown', (ev) => {
	if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 's') {
		ev.preventDefault();
		save();
	}
});
// Tab в тексте и коде вставляет табуляцию, а не уводит фокус
ed.addEventListener('keydown', (ev) => {
	if (ev.key === 'Tab' && !ev.ctrlKey && !ev.altKey && kind !== 'pmd') {
		ev.preventDefault();
		document.execCommand('insertText', false, '\t');
	}
});
addEventListener('beforeunload', () => {
	if (dirty) problet.notepadWrite(file, getText());
});

// Кнопки разметки: в листе pmd оформляют текст, в md вставляют знаки разметки, в остальных файлах их нет
const pickImage = async (md) => {
	try {
		const r = await problet.notepadImage();
		if (!r) return;
		if (md) document.execCommand('insertText', false, '![' + r.name + '](' + r.url + ')');
		else document.execCommand('insertImage', false, r.data);
		ed.dispatchEvent(new Event('input'));
	} catch (e) {
		state(String((e && e.message) || e).replace(/^Error invoking remote method '[^']*': (Error: )?/, ''), true);
	}
};
const RICH = [
	['Жирный', 'Жирный текст', () => document.execCommand('bold')],
	['Курсив', 'Курсивный текст', () => document.execCommand('italic')],
	['Подчёркнутый', 'Подчёркнутый текст', () => document.execCommand('underline')],
	['Заголовок 1', 'Крупный заголовок', () => document.execCommand('formatBlock', false, 'h1')],
	['Заголовок 2', 'Заголовок', () => document.execCommand('formatBlock', false, 'h2')],
	['Заголовок 3', 'Малый заголовок', () => document.execCommand('formatBlock', false, 'h3')],
	['Список', 'Маркированный список', () => document.execCommand('insertUnorderedList')],
	['Нумерация', 'Нумерованный список', () => document.execCommand('insertOrderedList')],
	['Код', 'Блок кода', () => document.execCommand('formatBlock', false, 'pre')],
	['Цитата', 'Цитата', () => document.execCommand('formatBlock', false, 'blockquote')],
	['Картинка', 'Вставить картинку: откроется выбор файла', () => pickImage(false)],
];
const wrap = (a, b = a) => () => {
	const s = getSelection().toString();
	document.execCommand('insertText', false, a + (s || 'текст') + b);
};
const MD = [
	['Жирный', 'Жирный текст', wrap('**')],
	['Курсив', 'Курсивный текст', wrap('*')],
	['Заголовок 1', 'Крупный заголовок', wrap('# ', '')],
	['Заголовок 2', 'Заголовок', wrap('## ', '')],
	['Заголовок 3', 'Малый заголовок', wrap('### ', '')],
	['Список', 'Маркированный список', wrap('- ', '')],
	['Код', 'Код', wrap('`')],
	['Цитата', 'Цитата', wrap('> ', '')],
	['Картинка', 'Вставить картинку: откроется выбор файла', () => pickImage(true)],
];
function buildMarks() {
	const list = kind === 'pmd' ? RICH : kind === 'md' ? MD : [];
	$('marks').textContent = '';
	for (const [txt, title, run] of list) {
		const b = document.createElement('button');
		b.textContent = txt;
		b.title = title;
		b.addEventListener('mousedown', (ev) => ev.preventDefault()); // выделение в редакторе не пропадает
		b.addEventListener('click', () => {
			ed.focus();
			run();
			ed.dispatchEvent(new Event('input'));
		});
		$('marks').append(b);
	}
}

(async () => {
	kind = kindOf(file);
	ed.contentEditable = kind === 'pmd' ? 'true' : 'plaintext-only';
	if (kind === 'code' || kind === 'text') ed.classList.add(kind);
	buildMarks();
	try {
		const r = await problet.notepadRead(file);
		path = r.path;
		setText(r.text);
		$('name').textContent = r.own ? 'Мой блокнот' : r.path.split(/[\\/]/).pop();
		$('name').title = r.path;
		document.title = $('name').textContent + ' — Блокнот';
		if (kind === 'md' || kind === 'html') mode('view');
		else ed.focus();
	} catch (e) {
		state(String((e && e.message) || e).replace(/^Error invoking remote method '[^']*': (Error: )?/, ''), true);
		ed.contentEditable = 'false';
		$('save').disabled = true;
	}
})();
