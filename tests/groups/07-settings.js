// Настройки: каждый переключатель и список на странице сохраняется и переживает перезапуск, разделы переключаются,
// зависимые строки показываются только при нужном значении
const fs = require('fs');
const path = require('path');

module.exports = {
	title: 'Настройки: каждый переключатель и список сохраняется, разделы, перезапуск',
	gui: true,
	async run(t) {
		const b = await t.browser();
		await b.go('problet://settings/', 1500);
		const cats = await b.fe(`[...d.getElementById('cats').children].map(c => c.textContent.trim())`);
		t.check('разделы настроек на месте', cats.length >= 15 && cats.includes('Родительский контроль') && cats.includes('Панели'), cats);
		// Каждый раздел открывается и показывает свои настройки
		const emptyCats = await b.fe(`(async () => { const out = []; for (const c of [...d.getElementById('cats').children]) { c.click(); await new Promise(r => setTimeout(r, 80)); const sec = [...d.querySelectorAll('main > section')].find(s => !s.classList.contains('hidden')); if (!sec || sec.querySelectorAll('.setting, button, input, select, table, .plist-title').length === 0) out.push(c.textContent.trim()); } return out; })()`);
		t.check('в каждом разделе что-то есть', emptyCats.length === 0, emptyCats);

		// Все переключатели и списки: меняем через интерфейс и смотрим, что сохранилось
		const controls = await b.fe(`[...d.querySelectorAll('[data-setting]')].map(e => ({ key: e.dataset.setting, type: e.type, options: e.tagName === 'SELECT' ? [...e.options].map(o => o.value) : null, value: e.type === 'checkbox' ? e.checked : e.value }))`);
		t.check('на странице много настроек', controls.length >= 50, controls.length);
		const SKIP = new Set(['language', 'tabsTwoRows']); // язык и два ряда вкладок проверяются отдельно
		const set = (key, v) => b.fe(`(async () => { const e = d.querySelector('[data-setting="${key}"]'); if (e.type === 'checkbox') e.checked = ${JSON.stringify(v)}; else e.value = ${JSON.stringify(v)}; e.dispatchEvent(new w.Event('change', { bubbles: true })); await new Promise(r => setTimeout(r, 150)); return (await w.problet.getSettings()).settings[${JSON.stringify(key)}]; })()`).catch((e) => 'ошибка: ' + e.message);
		const failed = [];
		let tried = 0;
		// Каждую меняем и сразу возвращаем назад, чтобы настройки не влияли друг на друга
		for (const c of controls) {
			if (SKIP.has(c.key) || c.type === 'text' || c.type === 'number' || c.type === 'color') continue;
			const values = c.type === 'checkbox' ? [!c.value] : (c.options || []).filter((o) => o !== c.value);
			for (const next of values) {
				tried++;
				const r = await set(c.key, next);
				if (String(r) !== String(next)) failed.push({ key: c.key, want: next, got: r });
			}
			await set(c.key, c.value);
		}
		t.check('каждое значение каждой настройки сохраняется сразу (' + tried + ' шт.)', failed.length === 0 && tried >= 80, failed);
		t.check('после всех изменений в консоли нет ошибок', b.errors.length === 0, b.errors.slice(0, 5));
		// Два ряда вкладок: только когда панель вкладок растянута почти вдвое
		const two = await b.fe(`(async () => { const r = []; try { await w.problet.setSettings({ tabsTwoRows: true }); r.push('принято'); } catch (e) { r.push('отказ'); } await w.problet.setSettings({ tabsScale: 2 }); await w.problet.setSettings({ tabsTwoRows: true }); r.push((await w.problet.getSettings()).settings.tabsTwoRows); await w.problet.setSettings({ tabsTwoRows: false, tabsScale: 1 }); return r; })()`);
		t.check('два ряда вкладок: без растянутой панели — отказ, с растянутой — включается', two[0] === 'отказ' && two[1] === true, two);
		// Для проверки перезапуска — несколько безобидных изменений
		const wanted = { tabsAlign: 'top', showUrlInTabs: true, calcSuggest: false, suggestCount: '5' };
		for (const [k, v] of Object.entries(wanted)) await set(k, v);

		// Зависимая строка: адрес стартовой страницы виден только при «открывать адрес»
		const dep = await b.fe(`(async () => { const e = d.querySelector('[data-setting="startup"]'); const row = d.getElementById('startup-url-row'); const res = []; for (const v of ['url', 'session']) { e.value = v; e.dispatchEvent(new w.Event('change', { bubbles: true })); await new Promise(r => setTimeout(r, 120)); res.push(row.classList.contains('hidden')); } return res; })()`);
		t.check('зависимая строка показывается только при нужном значении', dep[0] === false && dep[1] === true, dep);
		wanted.startup = 'session';

		// Перезапуск: всё на месте
		await b.quit();
		fs.writeFileSync(path.join(b.dir, 'update-cache.json'), JSON.stringify({ changelog: '', stableSeries: [9, 4], stableVersion: '9.4.7', betaVersion: '9.5.2' }));
		const data = JSON.parse(fs.readFileSync(path.join(b.dir, 'data.json'), 'utf8')).settings;
		const lost = Object.entries(wanted).filter(([k, v]) => String(data[k]) !== String(v)).map(([k]) => k);
		t.check('всё записано на диск при выходе', lost.length === 0, lost);
		const b2 = await t.browser({ keep: true });
		await b2.go('problet://settings/', 1200);
		const s2 = await b2.fe(`w.problet.getSettings().then(r => r.settings)`);
		const lost2 = Object.entries(wanted).filter(([k, v]) => String(s2[k]) !== String(v)).map(([k]) => k);
		t.check('после перезапуска настройки те же', lost2.length === 0, lost2);

		// В переключателе потока обновлений показаны последние версии stable и beta
		const chan = await b2.fe(`(async () => { await new Promise(r => setTimeout(r, 500)); return [...d.querySelector('[data-setting="updateChannel"]').options].map(o => o.textContent); })()`);
		t.check('переключатель stable/beta показывает последние версии', chan[0] === 'Stable (9.4.7)' && chan[1] === 'Beta (9.5.2)', chan);

		// Язык на лету
		const lang = await b2.fe(`(async () => { const e = d.querySelector('[data-setting="language"]'); e.value = 'en'; e.dispatchEvent(new w.Event('change', { bubbles: true })); await new Promise(r => setTimeout(r, 800)); const en = d.querySelector('h1').textContent; e.value = 'ru'; e.dispatchEvent(new w.Event('change', { bubbles: true })); await new Promise(r => setTimeout(r, 800)); return [en, d.querySelector('h1').textContent]; })()`);
		t.check('язык интерфейса переключается на лету', lang[0] === 'Settings' && lang[1] === 'Настройки', lang);
	},
};
