// Установка и первый запуск: страница приветствия на чистом профиле (и только на нём), портативная папка данных,
// веб-установщик для Linux (скачивает файл и становится им), установщик Windows содержит выбор портативной установки
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
module.exports = {
	title: 'Установка: приветствие, портативная папка, веб-установщик',
	gui: true,
	async run(t) {
		const root = path.join(__dirname, '..', '..');

		// Новый профиль (welcomeDone ещё не отмечен) открывает приветствие, профиль без этой отметки (старый) — нет
		const fresh = path.join(t.dir, 'fresh');
		fs.rmSync(fresh, { recursive: true, force: true });
		fs.mkdirSync(fresh, { recursive: true });
		const b = await t.browser({ profile: 'fresh', keep: true, settings: { welcomeDone: false } });
		await t.sleep(1500);
		let st = await b.st();
		t.check('на чистом профиле открывается приветствие', st.src && st.src.includes('/welcome/'), st);
		await b.fe(`(async () => { const e = d.getElementById('darkTheme'); e.checked = !e.checked; e.dispatchEvent(new w.Event('change', { bubbles: true })); const l = d.getElementById('tabsPos'); l.value = 'left'; l.dispatchEvent(new w.Event('change', { bubbles: true })); })()`);
		await t.sleep(700);
		const s1 = await b.fe(`w.problet.getSettings().then((r) => r.settings)`);
		t.check('выбор на странице сразу записывается в настройки', s1.tabsPos === 'left' && s1.welcomeDone === false, { tabsPos: s1.tabsPos, welcomeDone: s1.welcomeDone });
		await b.fe(`d.getElementById('done').click()`);
		await t.sleep(1200);
		st = await b.st();
		const s2 = await b.fe(`w.problet.getSettings().then((r) => r.settings)`).catch(() => null);
		const data = JSON.parse(fs.readFileSync(path.join(fresh, 'data.json'), 'utf8')).settings || {};
		t.check('«Начать» открывает новую вкладку и запоминает, что приветствие показано', st.src && st.src.includes('/newtab/') && (s2 ? s2.welcomeDone : data.welcomeDone) === true, { st, welcomeDone: s2 && s2.welcomeDone });
		await b.quit();
		const b2 = await t.browser({ profile: 'fresh', keep: true });
		await t.sleep(1500);
		st = await b2.st();
		t.check('после этого приветствие больше не появляется', !(st.src || '').includes('/welcome/'), st);
		await b2.quit();

		// Портативная установка: метка рядом с программой переносит данные в папку data
		const portable = require(path.join(root, 'portable.js'));
		const app = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-'));
		const exe = path.join(app, 'Problet.exe');
		t.check('без метки установка не портативная', portable.dataDir(exe, []) === '');
		fs.writeFileSync(path.join(app, 'portable.txt'), 'x');
		t.check('с меткой данные лежат в папке data рядом', portable.dataDir(exe, []) === path.join(app, 'data'));
		t.check('явно заданный профиль главнее метки', portable.dataDir(exe, ['--user-data-dir=/x']) === '');
		fs.rmSync(app, { recursive: true, force: true });

		// Веб-установщик Linux: на поддельном сайте лежит «AppImage», установщик скачивает его, становится им и запускает
		const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wi-'));
		const fake = '#!/bin/sh\necho запущен-настоящий-problet\n';
		const srv = http.createServer((req, res) => {
			if (req.url === '/download/stable') {
				res.writeHead(200, { 'content-type': 'application/json' });
				res.end(JSON.stringify({ version: '9.4.0', files: [{ name: 'Problet-9.4.0-linux-x86_64.AppImage' }] }));
			} else if (req.url === '/download/stable/Problet-9.4.0-linux-x86_64.AppImage') {
				res.writeHead(200, { 'content-type': 'application/octet-stream' });
				res.end(fake);
			} else {
				res.writeHead(404);
				res.end();
			}
		});
		await new Promise((r) => srv.listen(0, '127.0.0.1', r));
		const script = path.join(work, 'Problet-web-linux.sh');
		fs.copyFileSync(path.join(root, 'installers', 'Problet-web-linux.sh'), script);
		fs.chmodSync(script, 0o755);
		const env = { ...process.env, PROBLET_SITE: 'http://127.0.0.1:' + srv.address().port };
		delete env.DISPLAY;
		delete env.WAYLAND_DISPLAY;
		const run = await new Promise((resolve) => {
			const p = require('child_process').spawn(script, [], { env, cwd: work });
			let out = '';
			p.stdout.on('data', (d) => { out += d; });
			p.stderr.on('data', (d) => { out += d; });
			p.on('close', (code) => resolve({ code, out }));
		});
		srv.close();
		const real = path.join(work, 'Problet.AppImage');
		t.check('веб-установщик скачал файл и запустил его', run.code === 0 && run.out.includes('запущен-настоящий-problet'), run);
		t.check('файл исполняемый, сам установщик удалился, временных файлов нет', fs.existsSync(real) && (fs.statSync(real).mode & 0o111) !== 0 && !fs.existsSync(script) && fs.readdirSync(work).length === 1, fs.readdirSync(work));
		const bad = spawnSync('bash', [path.join(root, 'installers', 'Problet-web-linux.sh'), 'nightly'], { encoding: 'utf8' });
		t.check('неизвестный поток отвергается', bad.status === 2, bad.stderr);
		fs.rmSync(work, { recursive: true, force: true });

		// Установщик Windows: выбор портативной установки и двух языков описан в настройках сборки
		const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).build;
		const nsh = fs.readFileSync(path.join(root, 'build', 'installer.nsh'), 'utf8');
		t.check('установщик Windows: два языка, выбор портативной установки, веб-версия', pkg.nsis.multiLanguageInstaller === true && pkg.nsis.installerLanguages.length === 2 && pkg.win.target.includes('nsis-web') && /customWelcomePage/.test(nsh) && /portable\.txt/.test(nsh), { nsis: pkg.nsis, target: pkg.win.target });
	},
};
