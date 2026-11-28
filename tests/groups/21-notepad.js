// Блокнот: свой лист в .pmd сохраняется и переживает перезапуск, текстовые файлы открываются и сохраняются,
// просмотр показывает md и html без скриптов, код с видимыми пробелами, Tab вставляет табуляцию, файлы идут в блокнот по настройке
const fs = require('fs');
const os = require('os');
const path = require('path');
module.exports = {
	title: 'Блокнот: свой лист, файлы, просмотр md/html/кода, Tab, текстовый редактор по умолчанию',
	gui: true,
	async run(t) {
		const b = await t.browser();
		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'np-'));
		const md = path.join(tmp, 'a.md');
		const html = path.join(tmp, 'b.html');
		const code = path.join(tmp, 'c.js');
		fs.writeFileSync(md, '# Заголовок\n\n**жирный** и [ссылка](https://example.com)\n\n- раз\n- два\n');
		fs.writeFileSync(html, '<h1 id="h">Привет</h1><script>document.title="взломано"</script><img src="x" onerror="alert(1)">');
		fs.writeFileSync(code, 'if (a) {\n\treturn 1;\n}\n');

		// Свой лист
		await b.go('problet://notepad/', 1200);
		await b.fe(`(async () => { const e = d.getElementById('editor'); e.innerHTML = '<b>важное</b> дело'; e.dispatchEvent(new w.Event('input')); })()`);
		await t.sleep(1200);
		const own = path.join(b.dir, 'notepad.pmd');
		t.check('свой лист пишется в notepad.pmd в папке Problet', fs.existsSync(own) && fs.readFileSync(own, 'utf8').includes('<b>важное</b>'), fs.existsSync(own) && fs.readFileSync(own, 'utf8'));

		// Разметка: скрипты из листа вычищаются
		await b.fe(`(async () => { const e = d.getElementById('editor'); e.innerHTML = 'a<script>1</script><i onclick="x()">b</i>'; e.dispatchEvent(new w.Event('input')); })()`);
		await t.sleep(1200);
		const saved = fs.readFileSync(own, 'utf8');
		t.check('скрипты и обработчики из листа не сохраняются', !/script|onclick/.test(saved) && saved.includes('<i>b</i>'), saved);

		// Markdown
		await b.go('problet://notepad/?f=' + encodeURIComponent(md), 1200);
		const mdv = await b.fe(`({ h1: d.querySelector('#view h1') && d.querySelector('#view h1').textContent, b: !!d.querySelector('#view b'), a: d.querySelector('#view a') && d.querySelector('#view a').getAttribute('href'), li: d.querySelectorAll('#view li').length, shown: !d.getElementById('view').classList.contains('hidden') })`);
		t.check('md открывается сразу в просмотре и разбирается', mdv.h1 === 'Заголовок' && mdv.b && mdv.a === 'https://example.com' && mdv.li === 2 && mdv.shown, mdv);

		// HTML без скриптов
		await b.go('problet://notepad/?f=' + encodeURIComponent(html), 1200);
		const hv = await b.fe(`(() => { const f = d.querySelector('#view iframe'); return { sandbox: f && f.getAttribute('sandbox'), doc: f && f.srcdoc }; })()`);
		t.check('html показывается во фрейме без скриптов', hv.sandbox === '' && hv.doc && !/<script|onerror/.test(hv.doc) && hv.doc.includes('Привет'), hv);

		// Код: видимые пробелы и Tab
		await b.go('problet://notepad/?f=' + encodeURIComponent(code), 1200);
		await b.fe(`d.getElementById('m-view').click()`);
		const cv = await b.fe(`({ sp: d.querySelectorAll('#view .sp').length, text: d.getElementById('view').textContent })`);
		t.check('в коде пробелы и табы показаны знаками', cv.sp >= 4 && cv.text.includes('→') && cv.text.includes('·'), cv);
		await b.fe(`d.getElementById('m-edit').click()`);
		await b.fe(`(() => { const e = d.getElementById('editor'); e.focus(); const r = d.createRange(); r.selectNodeContents(e); r.collapse(true); const s = w.getSelection(); s.removeAllRanges(); s.addRange(r); })()`);
		await b.tb.ev(`1`);
		await t.sleep(200);
		await b.x('key', 'Tab');
		await t.sleep(300);
		const tab = await b.fe(`d.getElementById('editor').innerText.startsWith('\\t')`);
		t.check('Tab в коде вставляет табуляцию', tab === true, tab);
		await b.fe(`d.getElementById('save').click()`);
		await t.sleep(500);
		t.check('файл сохраняется на диск', fs.readFileSync(code, 'utf8').startsWith('\tif (a)'), fs.readFileSync(code, 'utf8'));

		// По настройке текстовые файлы из проводника идут в блокнот
		await b.go('problet://settings/', 1000);
		await b.fe(`w.problet.setSettings({ notepadDefault: true })`);
		await b.go('problet://files/?p=' + encodeURIComponent(tmp), 1200);
		await b.fe(`w.problet.filesLaunch(${JSON.stringify(md)}, '')`);
		await t.sleep(1000);
		const st = await b.st();
		t.check('с настройкой текстовый файл из проводника открывается в блокноте', !!st.src && st.src.includes('/notepad/') && decodeURIComponent(st.src).includes(md.replace(/\\/g, '/')), st);

		// Перезапуск: лист на месте
		await b.quit();
		const b2 = await t.browser({ keep: true });
		await b2.go('problet://notepad/', 1200);
		const again = await b2.fe(`d.getElementById('editor').innerHTML`);
		t.check('свой лист переживает перезапуск', /a<i>b<\/i>/.test(again), again);
		t.check('в консоли нет ошибок', b.errors.length === 0 && b2.errors.length === 0, [...b.errors, ...b2.errors].slice(0, 5));
		fs.rmSync(tmp, { recursive: true, force: true });
	},
};
