// Раскладка окна: вкладки в ряду / слева / справа, панель закладок вкл/выкл, выравнивание кнопок на растянутой панели
// вкладок, переставленные кнопки появляются на нужной панели; страница занимает место под панелями
module.exports = {
	title: 'Раскладка и кнопки: положение вкладок, панель закладок, выравнивание, кнопки по панелям, настройки кнопок',
	gui: true,
	async run(t) {
		const b = await t.browser();
		await b.go('problet://settings/', 1200);
		const set = async (patch) => {
			await b.fe(`w.problet.setSettings(${JSON.stringify(patch)})`);
			await t.sleep(600);
			return b.tb.ev(`({ ...document.body.dataset, bmbarVisible: !!document.getElementById('bmbar').offsetHeight })`);
		};
		let ds = await set({ tabsPos: 'left' });
		t.check('вкладки слева', ds.tabs === 'left', ds);
		ds = await set({ tabsPos: 'right' });
		t.check('вкладки справа', ds.tabs === 'right', ds);
		ds = await set({ tabsPos: 'row' });
		t.check('вкладки в ряду панелей', ds.tabs === 'top' || ds.tabs === 'bottom', ds);
		ds = await set({ bookmarksBar: false });
		t.check('панель закладок выключается', ds.bm === 'off' && !ds.bmbarVisible, ds);
		ds = await set({ bookmarksBar: true });
		t.check('панель закладок включается', ds.bm !== 'off' && ds.bmbarVisible, ds);
		for (const a of ['center', 'top', 'bottom']) {
			ds = await set({ tabsAlign: a });
			t.check('выравнивание кнопок на панели вкладок: ' + a, ds.tabsAlign === a, ds);
		}
		// Кнопка «История» переезжает на панель закладок
		const layout = (await b.fe(`w.problet.getSettings()`)).settings.btnLayout;
		const L = JSON.parse(JSON.stringify(layout));
		const id = [...L.toolbar].find((x) => x === 'history') || L.toolbar.find((x) => !/^(back|forward|reload|address|x:)/.test(x));
		for (const k of Object.keys(L)) L[k] = L[k].filter((x) => x !== id);
		L.bmbar.unshift(id);
		await set({ btnLayout: L });
		const where = await t.waitFor(() => b.tb.ev(`(() => { const el = document.getElementById('${id}'); return el && el.closest('#bmbar') ? 'bmbar' : ''; })()`), 5000) || await b.tb.ev(`(() => { const el = document.getElementById('${id}'); return el ? el.parentElement.id : 'нет'; })()`);
		t.check('кнопка «' + id + '» переехала на панель закладок', where === 'bmbar', { id, where });
		await set({ btnLayout: layout });
		// Страница не залезает под панели
		await b.go(t.server.base + '/a', 1200);
		const pg = await b.page((u) => u === t.server.base + '/a');
		const vh = await pg.ev('innerHeight');
		const top = await b.tb.ev(`Math.round(document.getElementById('bmbar').getBoundingClientRect().bottom)`);
		t.check('страница не прячется под панелями', vh > 300 && vh + top <= 1000, { vh, top });

		// ---------- Настройки кнопок (шестерёнка на карточке в «Панелях») ----------
		const fs = require('fs');
		const path = require('path');
		const base = t.server.base;
		await b.go('problet://settings/', 1000);
		await b.fe(`([...d.getElementById('cats').children].find(c => /Панели/.test(c.textContent)).click(), 1)`);
		const gears = await b.fe(`[...d.querySelectorAll('button[data-opts]')].map(g => g.dataset.opts)`);
		t.check('шестерёнки на карточках кнопок с настройками', ['darkpage', 'clock', 'date', 'downloads', 'reload', 'newtab'].every((x) => gears.includes(x)), gears);
		const openOpts = (id) => b.fe(`(d.querySelector('button[data-opts="${id}"]').click(), new Promise(r => setTimeout(r, 300)))`);
		const setOpt = async (sel, v) => {
			await b.fe(`(() => { const e = d.querySelector('[data-opt="${sel}"]'); if (e.type === 'checkbox') e.checked = ${JSON.stringify(v)}; else e.value = ${JSON.stringify(v)}; e.dispatchEvent(new w.Event('change')); })()`);
			await t.sleep(500);
		};
		await openOpts('clock');
		t.check('шестерёнка раскрывает настройки кнопки', await b.fe(`!!d.querySelector('[data-opt="clock.ampm"]') && !!d.querySelector('[data-opt="clock.tz"]')`));
		// Часы и дата на панель инструментов
		const lay = (await b.fe(`w.problet.getSettings()`)).settings.btnLayout;
		const L2 = JSON.parse(JSON.stringify(lay));
		for (const k of Object.keys(L2)) L2[k] = L2[k].filter((x) => x !== 'clock' && x !== 'date');
		L2.toolbar.push('clock', 'date');
		await b.fe(`w.problet.setSettings({ btnLayout: ${JSON.stringify(L2)} })`);
		await t.sleep(800);
		const clock = () => b.tb.ev(`document.getElementById('clock').textContent`);
		t.check('часы по умолчанию — 24 часа без секунд', /^\d{2}:\d{2}$/.test(await clock()), await clock());
		await setOpt('clock.ampm', true);
		await setOpt('clock.seconds', true);
		await t.sleep(1200);
		t.check('часы: AM/PM и секунды', /^\d{1,2}:\d{2}:\d{2} (AM|PM)$/.test(await clock()), await clock());
		await setOpt('clock.ampm', false);
		await setOpt('clock.tz', 'UTC+0');
		await t.sleep(1200);
		const utcNow = new Date();
		const c0 = await clock();
		t.check('часы: другой часовой пояс', c0.endsWith('UTC+0') && c0.startsWith(String(utcNow.getUTCHours()).padStart(2, '0') + ':'), c0);
		await setOpt('clock.tz', 'плохо');
		t.check('кривой часовой пояс не принимается', (await b.fe(`w.problet.getSettings()`)).settings.btnOptions.clock.tz === '+0' && /UTC/.test(await b.fe(`d.getElementById('status').textContent`)));
		await setOpt('clock.tz', '');
		await setOpt('clock.seconds', false);
		await openOpts('date');
		const dateText = () => b.tb.ev(`document.getElementById('date').textContent`);
		const nowD = new Date();
		t.check('кнопка «Дата» на панели, вид по умолчанию 24.11', (await dateText()) === String(nowD.getDate()).padStart(2, '0') + '.' + String(nowD.getMonth() + 1).padStart(2, '0'), await dateText());
		await setOpt('date.format', 'full');
		await t.sleep(1200);
		t.check('дата: полный вид с годом', (await dateText()).endsWith('.' + nowD.getFullYear()), await dateText());
		await setOpt('date.calendar', true);
		await t.sleep(1200);
		t.check('дата: при «открывать календарь» на кнопке подсказка и курсор-рука', await b.tb.ev(`document.getElementById('date').style.cursor === 'pointer' && /календар/.test(document.getElementById('date').title)`));

		// Загрузки: подсветка после завершения и число идущих загрузок
		const dl = path.join(t.dir, 'dl');
		fs.mkdirSync(dl, { recursive: true });
		await b.fe(`w.problet.setSettings({ askDownload: false, downloadDir: ${JSON.stringify(dl)} })`);
		await openOpts('downloads');
		await setOpt('downloads.highlight', true);
		await setOpt('downloads.count', true);
		await b.go(base + '/slow.bin', 1200);
		t.check('загрузки: пока идёт загрузка, на кнопке число', (await b.tb.ev(`document.getElementById('downloads').dataset.count`)) === '1');
		await t.waitFor(() => fs.existsSync(path.join(dl, 'slow.bin')) && fs.statSync(path.join(dl, 'slow.bin')).size === 6 * 65536, 10000);
		await t.sleep(800);
		t.check('загрузки: файл скачан — кнопка подсвечена, числа нет', await b.tb.ev(`document.getElementById('downloads').classList.contains('fresh') && !document.getElementById('downloads').dataset.count`));
		await b.tb.ev(`document.getElementById('downloads').click()`);
		await t.sleep(600);
		t.check('загрузки: нажатие снимает подсветку', !(await b.tb.ev(`document.getElementById('downloads').classList.contains('fresh')`)));

		// Обновить без кеша
		await b.go('problet://settings/', 800);
		await b.fe(`([...d.getElementById('cats').children].find(c => /Панели/.test(c.textContent)).click(), 1)`);
		await openOpts('reload');
		await setOpt('reload.hard', true);
		await b.go(base + '/cached', 1500);
		const before = t.server.heads.length;
		await b.tb.ev('problet.reload()');
		await t.sleep(1500);
		const re = t.server.heads.slice(before).filter((h) => h.url === '/pic.svg');
		t.check('обновить без кеша: картинка запрошена заново с no-cache', re.length >= 1 && /no-cache/.test((re[0].headers['cache-control'] || '') + (re[0].headers.pragma || '')), re.map((h) => h.headers['cache-control']));

		// Тёмная тема страницы запоминается для сайта
		await b.go('problet://settings/', 800);
		await b.fe(`([...d.getElementById('cats').children].find(c => /Панели/.test(c.textContent)).click(), 1)`);
		await openOpts('darkpage');
		await setOpt('darkpage.remember', true);
		await b.go(base + '/light', 1500);
		await b.tb.ev('problet.darkPage()');
		await t.sleep(800);
		await b.tb.ev('problet.reload()');
		await t.sleep(1500);
		let lp = await b.page((u) => u === base + '/light');
		t.check('тёмная тема включилась снова после перезагрузки сайта', /invert/.test(await lp.ev('document.documentElement.style.filter')));
		await b.tb.ev('problet.darkPage()');
		await t.sleep(800);
		await b.tb.ev('problet.reload()');
		await t.sleep(1500);
		lp = await b.page((u) => u === base + '/light');
		t.check('выключенная — не включается', (await lp.ev('document.documentElement.style.filter')) === '');

		// Боковая панель и пятый промежуток
		await b.go('problet://settings/', 800);
		const curLay = (await b.fe('w.problet.getSettings()')).settings.btnLayout;
		const sideLay = JSON.parse(JSON.stringify(curLay));
		for (const k of Object.keys(sideLay)) sideLay[k] = sideLay[k].filter((x) => !['history', 'downloads', 'sp5', 'winctl'].includes(x));
		sideLay.side = ['history', 'sp5', 'downloads', 'winctl'];
		await b.fe(`w.problet.setSettings(${JSON.stringify({ sidebar: 'left', btnLayout: sideLay })})`);
		await t.sleep(1000);
		const side = await b.tb.ev(`(() => { const s = document.getElementById('sidebar'); const r = s.getBoundingClientRect(); return { w: r.width, h: r.height, inside: ['history', 'downloads', 'sp5'].every((id) => s.contains(document.getElementById(id))), winctlVertical: getComputedStyle(document.getElementById('winctl')).flexDirection }; })()`);
		t.check('боковая панель слева: показана, кнопки и промежуток внутри', side.w > 20 && side.h > 200 && side.inside, side);
		t.check('кнопки окна на боковой панели встают столбцом', side.winctlVertical === 'column', side);
		const sp = await b.tb.ev(`(() => { const a = document.getElementById('history').getBoundingClientRect(); const z = document.getElementById('downloads').getBoundingClientRect(); return z.top - a.top; })()`);
		t.check('промежуток прижимает нижние кнопки панели к её концу', sp > 150, sp);
		await b.fe(`w.problet.setSettings({ sidebar: 'off' })`);
		await t.sleep(800);
		t.check('боковая панель выключается', (await b.tb.ev(`document.getElementById('sidebar').getBoundingClientRect().width`)) < 2);
		// Новая вкладка — инкогнито
		await b.go('problet://settings/', 800);
		await b.fe(`([...d.getElementById('cats').children].find(c => /Панели/.test(c.textContent)).click(), 1)`);
		await openOpts('newtab');
		await setOpt('newtab.incognito', true);
		await b.tb.ev(`document.getElementById('newtab').click()`);
		await t.sleep(1000);
		t.check('кнопка «Новая вкладка» открывает инкогнито', await b.tb.ev(`!!document.querySelector('#tabs .tab.active.incognito')`));
		t.check('без ошибок в консоли', b.errors.length === 0, b.errors.slice(0, 5));
	},
};
