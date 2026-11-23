// Код: синтаксис всех файлов, загрузка модулей под Windows, macOS и Linux, отсутствие эмодзи и отладочных остатков
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.join(__dirname, '..', '..');

module.exports = {
	title: 'Код: синтаксис, модули под тремя системами, запрещённые вещи',
	async run(t) {
		const js = [];
		const walk = (d) => {
			for (const f of fs.readdirSync(d, { withFileTypes: true })) {
				if (['node_modules', 'dist', 'build', '.git', 'docs'].includes(f.name)) continue;
				const p = path.join(d, f.name);
				if (f.isDirectory()) walk(p);
				else if (f.name.endsWith('.js')) js.push(p);
			}
		};
		walk(root);
		const broken = js.filter((f) => spawnSync(process.execPath, ['--check', f]).status !== 0).map((f) => path.relative(root, f));
		t.check('все ' + js.length + ' JS-файлов без синтаксических ошибок', broken.length === 0, broken);

		for (const plat of ['win32', 'darwin', 'linux']) {
			const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'lib', 'platcheck.js'), plat], { encoding: 'utf8' });
			let res = null;
			try { res = JSON.parse(r.stdout.trim().split('\n').pop()); } catch (e) { /* упал */ }
			t.check('модули главного процесса грузятся как на ' + plat, res && res.errors.length === 0 && res.mods > 10, res || r.stderr.slice(-300));
		}

		// Эмодзи в коде запрещены (только SVG); проверяем исходники программы, не документацию и не тесты
		const emoji = /[\u{1F000}-\u{1FAFF}]|\uFE0F/u; // картинки-эмодзи; простые текстовые знаки вроде ☆ и ✓ можно
		const app = js.filter((f) => !f.includes(path.sep + 'tests' + path.sep) && !f.includes(path.sep + 'tools' + path.sep));
		const allowed = ['chars.js', 'i18n']; // таблица символов и словари: там символы — это данные
		const withEmoji = app.filter((f) => !allowed.some((a) => f.includes(a)) && emoji.test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(root, f));
		t.check('в коде нет эмодзи', withEmoji.length === 0, withEmoji);

		const debugLeft = app.filter((f) => /(^|[^.\w])debugger;|console\.log\(['"]DEBUG/m.test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(root, f));
		t.check('нет отладочных остатков (debugger;, console.log("DEBUG"))', debugLeft.length === 0, debugLeft);

		const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
		t.check('версия в package.json — X.Y.Z', /^\d+\.\d+\.\d+$/.test(pkg.version), pkg.version);
		t.check('точка входа — boot.js', pkg.main === 'boot.js', pkg.main);
		const fuses = pkg.build && pkg.build.electronFuses;
		t.check('фьюзы: Node-режим и отладчик выключены в сборке', fuses && fuses.runAsNode === false && fuses.enableNodeCliInspectArguments === false && fuses.enableNodeOptionsEnvironmentVariable === false, fuses);
		t.check('тесты не попадают в сборку', !pkg.build.files.some((f) => /tests/.test(f)) && pkg.build.files.includes('*.js'), pkg.build.files);
	},
};
