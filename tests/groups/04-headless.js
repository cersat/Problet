// Режим без окна: одноразовая загрузка (--fetch, --text, --eval, --shot, --insert, --adblock), выход сам,
// --detach (терминал сразу свободен и ничего не печатает), и большой сквозной прогон tools/smoke.js через HTTP-управление
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { ELECTRON } = require('../lib/browser');
const root = path.join(__dirname, '..', '..');

function run(args, env, ms = 60000) {
	return new Promise((resolve) => {
		const t0 = Date.now();
		const p = spawn(ELECTRON, [root, '--no-sandbox', ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
		let out = '';
		let err = '';
		p.stdout.on('data', (d) => { out += d; });
		p.stderr.on('data', (d) => { err += d; });
		const timer = setTimeout(() => p.kill('SIGKILL'), ms);
		p.on('exit', (code) => {
			clearTimeout(timer);
			resolve({ code, out, err, ms: Date.now() - t0 });
		});
	});
}
const json = (s) => {
	try {
		return JSON.parse(s.slice(s.indexOf('{')));
	} catch (e) {
		return null;
	}
};

module.exports = {
	title: 'Режим без окна: --fetch и его параметры, --detach, сквозной прогон tools/smoke.js',
	async run(t) {
		const base = t.server.base;
		const r1 = await run(['--headless', '--fetch=' + base + '/a', '--wait=300', '--text', '--eval=document.getElementById("p").textContent + "|" + (1+2)'], t.env);
		const j1 = json(r1.out);
		t.check('--fetch: отчёт JSON, страница загружена, выход с кодом 0', r1.code === 0 && j1 && j1.runs[0].loaded && j1.runs[0].title === 'A', { code: r1.code, out: r1.out.slice(0, 300), err: r1.err.slice(-300) });
		t.check('--text и --eval попали в отчёт', j1 && j1.runs[0].text.includes('страница A') && j1.runs[0].eval === 'страница A|3', j1 && j1.runs[0]);
		t.check('сводка запросов по хостам', j1 && j1.hosts.some((h) => /127\.0\.0\.1/.test(h.host || h[0] || JSON.stringify(h))), j1 && j1.hosts);

		const shot = path.join(t.dir, 'shot.png');
		const r2 = await run(['--headless', '--fetch=' + base + '/b', '--wait=200', '--shot=' + shot, '--size=800x600'], t.env);
		const png = fs.existsSync(shot) ? fs.readFileSync(shot) : null;
		t.check('--shot сохраняет PNG', r2.code === 0 && png && png.readUInt32BE(0) === 0x89504e47 && png.readUInt32BE(16) === 800 && png.readUInt32BE(20) === 600, png && [png.readUInt32BE(16), png.readUInt32BE(20)]);

		const r3 = await run(['--headless', '--fetch=' + base + '/a', '--wait=200', '--insert=window.__ins = 7', '--eval=window.__ins'], t.env);
		t.check('--insert выполняется до скриптов страницы', (json(r3.out) || { runs: [{}] }).runs[0].eval === 7, r3.out.slice(0, 300));

		const r4 = await run(['--headless', '--fetch=' + base + '/', '--wait=300', '--runs=2', '--eval=String(window.okLoaded)'], t.env);
		const j4 = json(r4.out);
		t.check('--runs=2: две загрузки с чистого листа, --eval — в первой', j4 && j4.runs.length === 2 && j4.runs.every((r) => r.loaded) && j4.runs[0].eval === '1', j4 && j4.runs);

		const r5 = await run(['--headless', '--fetch=http://127.0.0.1:1/', '--wait=100'], t.env);
		const j5 = json(r5.out);
		t.check('недоступный адрес: отчёт есть, загрузка не удалась с причиной, браузер не завис', r5.ms < 40000 && j5 && j5.runs[0].loaded === false && !!j5.runs[0].error, { ms: r5.ms, out: r5.out.slice(0, 200) });

		// Сайт-определитель браузера (подставляем его имя через --host-resolver-rules): видит только Problet
		const port = new URL(base).port;
		const r8 = await run(['--headless', '--host-resolver-rules=MAP whatismybrowser.com 127.0.0.1:' + port, '--fetch=http://whatismybrowser.com/headers', '--wait=500', '--eval=JSON.stringify({ h: JSON.parse(document.getElementById("h").textContent), ua: navigator.userAgent, av: navigator.appVersion, platform: navigator.platform, vendor: navigator.vendor, brands: navigator.userAgentData.brands, uadPlatform: navigator.userAgentData.platform })'], t.env);
		let id8 = null;
		try { id8 = JSON.parse(json(r8.out).runs[0].eval); } catch (e) { /* разберём ниже */ }
		const ver = require(path.join(root, 'package.json')).version;
		t.check('определитель: заголовок User-Agent — только «Problet/версия»', id8 && id8.h['user-agent'] === 'Problet/' + ver, id8 && id8.h['user-agent']);
		// Client Hints Chromium шлёт только по https, поэтому здесь их может не быть вовсе; подмену самих заголовков проверяет группа 02
		t.check('определитель: Sec-CH-UA — только Problet (если есть), системы и прочего нет', id8 && (id8.h['sec-ch-ua'] === undefined || id8.h['sec-ch-ua'] === '"Problet";v="' + ver.split('.')[0] + '"') && !Object.keys(id8.h).some((k) => /^sec-ch-ua-(platform|mobile|arch|model|bitness)/.test(k)), id8 && Object.fromEntries(Object.entries(id8.h).filter(([k]) => k.startsWith('sec-ch'))));
		t.check('определитель: navigator — только Problet в строке и брендах; система, как и везде, на месте', id8 && id8.ua === 'Problet/' + ver && id8.brands.length === 1 && id8.brands[0].brand === 'Problet' && id8.platform !== '' && id8.uadPlatform !== '', id8 && { ua: id8.ua, platform: id8.platform, vendor: id8.vendor, brands: id8.brands });
		// «Скрывать метаданные системы» — на всех сайтах
		const hideDir = path.join(t.dir, 'hide');
		fs.mkdirSync(hideDir, { recursive: true });
		fs.writeFileSync(path.join(hideDir, 'data.json'), JSON.stringify({ settings: { hideSystem: true, language: 'ru' } }));
		const r10 = await run(['--headless', '--user-data-dir=' + hideDir, '--fetch=' + base + '/headers', '--wait=500', '--eval=JSON.stringify({ h: JSON.parse(document.getElementById("h").textContent), ua: navigator.userAgent, platform: navigator.platform, vendor: navigator.vendor, cores: navigator.hardwareConcurrency, mem: String(navigator.deviceMemory), uad: navigator.userAgentData.platform, gl: (() => { const c = document.createElement("canvas").getContext("webgl"); return c ? c.getParameter(0x9246) : "нет webgl"; })() })'], t.env);
		let h10 = null;
		try { h10 = JSON.parse(json(r10.out).runs[0].eval); } catch (e) { /* разберём ниже */ }
		// Тесты идут на Linux/macOS/Windows; вместо настоящей системы у всех одна и та же: Windows 10 x64
		const COMMON = 'Windows NT 10.0; Win64; x64';
		const REAL = process.platform === 'win32' ? null : /Linux|X11|Macintosh/;
		t.check('скрыть систему: в заголовке User-Agent одинаковая у всех система', h10 && h10.h['user-agent'].includes(COMMON) && !(REAL && REAL.test(h10.h['user-agent'])) && /Chrome\/\d+/.test(h10.h['user-agent']), h10 && h10.h['user-agent']);
		t.check('скрыть систему: navigator — одинаковые у всех система, производитель и ядра, памяти нет', h10 && h10.ua.includes(COMMON) && h10.platform === 'Win32' && h10.vendor === 'Google Inc.' && h10.uad === 'Windows' && h10.cores === 4 && h10.mem === 'undefined', h10 && { ua: h10.ua, platform: h10.platform, vendor: h10.vendor, cores: h10.cores, mem: h10.mem, uad: h10.uad });
		t.check('скрыть систему: WebGL не называет настоящую видеокарту', h10 && (h10.gl === 'Google Inc.' || h10.gl === 'нет webgl'), h10 && h10.gl);
		const r9 = await run(['--headless', '--fetch=' + base + '/headers', '--wait=300', '--eval=navigator.userAgent'], t.env);
		const ua9 = (json(r9.out) || { runs: [{}] }).runs[0].eval || '';
		t.check('обычный сайт: как раньше — Chrome и Problet в User-Agent', /Chrome\/\d+/.test(ua9) && /Problet\//.test(ua9), ua9);

		// --detach: команда сразу возвращается и ничего не печатает
		const r6 = await run(['--detach', '--headless', '--fetch=' + base + '/a', '--wait=100'], t.env, 15000);
		t.check('--detach: команда сразу свободна и молчит', r6.code === 0 && r6.ms < 5000 && r6.out.trim() === '', { code: r6.code, ms: r6.ms, out: r6.out.slice(0, 200) });
		const r7 = await run(['--headless', '--fetch=' + base + '/a', '--wait=100'], t.env);
		t.check('без --detach команда ждёт конца и печатает отчёт', r7.code === 0 && !!json(r7.out));

		// Сквозной прогон: tools/smoke.js (HTTP-управление, настройки, закладки, проводник, скачивания, аддоны, пароли, пространства, перезапуск)
		const smoke = await new Promise((resolve) => {
			const p = spawn(process.execPath, [path.join(root, 'tools', 'smoke.js')], { env: t.env, cwd: root });
			let out = '';
			p.stdout.on('data', (d) => { out += d; });
			p.stderr.on('data', (d) => { out += d; });
			p.on('exit', (code) => resolve({ code, out }));
		});
		const lines = smoke.out.split('\n').filter((l) => /^(OK|FAIL) /.test(l));
		for (const l of lines) t.check('smoke: ' + l.replace(/^(OK|FAIL)\s+/, '').replace(/\s+->.*$/, ''), l.startsWith('OK'), l.includes('->') ? l.split('->')[1].trim() : undefined);
		t.check('smoke: прогон дошёл до конца', smoke.code === 0 && lines.length >= 50, { code: smoke.code, tail: smoke.out.slice(-300) });
	},
};
