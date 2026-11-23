// Окно: место, размер и режим (обычное/развёрнутое) переживают перезапуск; «тихий» запуск после обновления
// не забирает фокус у другого окна, а обычный — забирает. Нужен оконный менеджер (на Linux без экрана — openbox)
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { ELECTRON } = require('../lib/browser');
const env = require('../lib/env');

module.exports = {
	title: 'Окно: место, размер, развёрнутость после перезапуска, тихий запуск без кражи фокуса',
	gui: true,
	async run(t) {
		if (process.platform !== 'linux' || !env.has('xdotool') || !env.has('openbox')) t.skip('нужны Linux, xdotool и openbox');
		let b = await t.browser();
		const geo = () => b.x('getwindowgeometry', b.winId());
		b.x('windowmove', b.winId(), '150', '120');
		b.x('windowsize', b.winId(), '900', '600');
		await t.sleep(1500);
		await b.quit();
		const saved = JSON.parse(fs.readFileSync(path.join(b.dir, 'data.json'), 'utf8')).window;
		t.check('место и размер записаны при выходе', saved && saved.width === 900 && saved.height === 600 && saved.mode === 'normal', saved);
		b = await t.browser({ keep: true });
		let g = geo();
		t.check('после перезапуска тот же размер', /900x600/.test(g), g);
		t.check('после перезапуска то же место', /Position: 1[45]\d,1[0-9]\d/.test(g), g);

		await b.tb.ev('problet.winMaximize()');
		await t.sleep(1500);
		await b.quit();
		t.check('развёрнутость записана', JSON.parse(fs.readFileSync(path.join(b.dir, 'data.json'), 'utf8')).window.mode === 'maximized');
		b = await t.browser({ keep: true });
		g = geo();
		t.check('после перезапуска окно развёрнуто', /Geometry: 1[34]\d\dx(8[5-9]\d|9\d\d)/.test(g), g);
		await b.close();

		// Тихий запуск: другое окно в фокусе, Problet открывается в фоне
		const other = path.join(t.dir, 'other');
		fs.mkdirSync(other, { recursive: true });
		fs.writeFileSync(path.join(other, 'main.js'), "const { app, BrowserWindow } = require('electron'); app.whenReady().then(() => { const w = new BrowserWindow({ width: 300, height: 200, x: 500, y: 300, title: 'OTHERWIN' }); w.loadURL('data:text/html,<title>OTHERWIN</title>x'); w.on('page-title-updated', (e) => e.preventDefault()); });");
		const display = await env.ensureDisplay();
		for (const [quiet, mode] of [[true, 'normal'], [true, 'maximized'], [false, 'normal']]) {
			const o = spawn(ELECTRON, [path.join(other, 'main.js'), '--no-sandbox', '--user-data-dir=' + path.join(t.dir, 'other-ud')], { env: { ...t.env, DISPLAY: display }, stdio: 'ignore' });
			await t.sleep(3000);
			const xo = (...a) => require('child_process').spawnSync('xdotool', a, { env: { ...t.env, DISPLAY: display }, encoding: 'utf8' }).stdout.trim();
			xo('search', '--name', 'OTHERWIN', 'windowactivate');
			await t.sleep(500);
			const prof = path.join(t.dir, 'quiet-' + mode + quiet);
			fs.mkdirSync(prof, { recursive: true });
			fs.writeFileSync(path.join(prof, 'data.json'), JSON.stringify({ settings: { language: 'ru' }, window: { mode, quiet, x: 100, y: 50, width: 900, height: 600 } }));
			b = await t.browser({ profile: 'quiet-' + mode + quiet, keep: true });
			await t.sleep(2500);
			const act = xo('getactivewindow', 'getwindowname');
			if (quiet) t.check('тихий запуск (' + mode + ') не забрал фокус', act === 'OTHERWIN', act);
			else t.check('обычный запуск забрал фокус', act !== 'OTHERWIN', act);
			const after = JSON.parse(fs.readFileSync(path.join(prof, 'data.json'), 'utf8')).window;
			t.check('признак тихого запуска сброшен (' + mode + ')', !after.quiet, after);
			await b.close();
			o.kill('SIGKILL');
			await t.sleep(500);
		}
	},
};
