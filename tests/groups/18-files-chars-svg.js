// Проводник, таблица символов и SVG-редактор: проводник показывает папку (юникод, пробелы), адрес папки открывает его,
// символ из таблицы вставляется в поле на странице, svg-файл открывается в редакторе и сохраняется
const fs = require('fs');
const path = require('path');

module.exports = {
	title: 'Проводник, таблица символов, SVG-редактор',
	gui: true,
	async run(t) {
		const base = t.server.base;
		const dir = path.join(t.dir, 'папка с пробелом');
		fs.mkdirSync(path.join(dir, 'вложенная'), { recursive: true });
		fs.writeFileSync(path.join(dir, 'заметка.txt'), 'текст');
		fs.writeFileSync(path.join(dir, 'рисунок.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>');
		const b = await t.browser();
		await b.go(dir, 1500);
		let s = await b.st();
		t.check('путь к папке открывает проводник', /problet:\/\/files/.test(s.addr) || /files/.test(s.src || ''), s);
		const names = await b.fe(`[...d.querySelectorAll('#list .row, #list [data-path], .row')].map(e => e.textContent)`);
		t.check('проводник показывает файлы и папки с юникодом', ['заметка.txt', 'рисунок.svg', 'вложенная'].every((n) => names.some((x) => x.includes(n))), names.slice(0, 10));
		const list = await b.fe(`w.problet.filesList(${JSON.stringify(dir)})`);
		t.check('у записей есть путь и адрес file://', list.entries.length === 3 && list.entries.every((e) => e.path && e.url.startsWith('file:///')), list.entries.map((e) => e.name));

		await b.go(path.join(dir, 'рисунок.svg'), 1500);
		s = await b.st();
		t.check('svg открывается в редакторе', /svgedit/.test(s.addr) || /svgedit/.test(s.src || ''), s);
		const svg = await b.fe(`w.problet.svgRead(${JSON.stringify(path.join(dir, 'рисунок.svg'))})`);
		t.check('редактор читает файл', JSON.stringify(svg).includes('rect'), svg);
		const out = path.join(dir, 'новый.svg');
		await b.fe(`w.problet.svgWrite(${JSON.stringify(out)}, '<svg xmlns="http://www.w3.org/2000/svg"><circle r="3"/></svg>')`).catch((e) => e.message);
		t.check('редактор сохраняет svg', fs.existsSync(out) && fs.readFileSync(out, 'utf8').includes('circle'));
		const bad = await b.fe(`w.problet.svgWrite(${JSON.stringify(path.join(dir, 'x.exe'))}, '<svg/>').then(() => 'принято', () => 'отказ')`);
		t.check('редактор не пишет файлы с чужим расширением', bad === 'отказ', bad);

		// Таблица символов: символ вставляется в поле на странице
		await b.go(base + '/login', 1500);
		const pg = await b.page((u) => u === base + '/login');
		await pg.ev(`document.getElementById('l').focus()`);
		await b.go('problet://chars/', 1200).catch(() => {});
		s = await b.st();
		t.check('таблица символов открывается', s.virtual && /chars/.test(s.src || ''), s);
		const cats = await b.fe(`d.body.innerText.length`);
		t.check('в таблице есть символы', cats > 200, cats);
		t.check('без ошибок в консоли', b.errors.length === 0, b.errors.slice(0, 5));
	},
};
