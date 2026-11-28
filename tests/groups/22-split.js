// Разделённый экран: две страницы рядом, разделитель двигается и возвращается пополам, при закрытии одной страницы разделение снимается
module.exports = {
	title: 'Разделённый экран: две страницы рядом, разделитель, закрытие',
	gui: true,
	async run(t) {
		const b = await t.browser();
		const base = t.server.base;
		await b.newTab(base + '/a');
		await b.newTab(base + '/b');
		await b.activate();
		const pages = async () => (await b.targets()).filter((x) => x.type === 'page' && x.url.startsWith(base));
		const rects = async () => {
			const out = {};
			for (const p of await pages()) {
				const c = await b.page((u) => u === p.url);
				out[new URL(p.url).pathname] = await c.ev(`({ x: 0, w: innerWidth, vis: document.visibilityState })`);
				c.close();
			}
			return out;
		};
		const key = async (combo, ms = 900) => {
			await b.activate();
			b.x('key', '--clearmodifiers', combo);
			await t.sleep(ms);
		};
		let r = await rects();
		t.check('без разделения видна одна страница', r['/b'] && r['/b'].vis === 'visible' && r['/a'] && r['/a'].vis === 'hidden', r);

		await key('ctrl+alt+v');
		r = await rects();
		t.check('Ctrl+Alt+V ставит рядом две страницы', r['/a'].vis === 'visible' && r['/b'].vis === 'visible', r);
		const half = r['/a'].w;
		// слева страница, которая была активной (/b), справа — вторая (/a)
		t.check('страницы вдвое уже и примерно равны', Math.abs(r['/a'].w - r['/b'].w) <= 8 && half < 700, r);

		// Разделитель тянется
		const ev = (code) => b.tb.ev(code);
		const win = (await ev(`({ w: innerWidth, h: innerHeight })`));
		const x0 = Math.round(win.w / 2);
		const wid = b.winId();
		const geo = b.x('getwindowgeometry', '--shell', wid);
		const gx = Number((/X=(-?\d+)/.exec(geo) || [])[1] || 0);
		const gy = Number((/Y=(-?\d+)/.exec(geo) || [])[1] || 0);
		b.x('mousemove', String(gx + x0), String(gy + Math.round(win.h * 0.6)));
		b.x('mousedown', '1');
		b.x('mousemove', String(gx + x0 - 200), String(gy + Math.round(win.h * 0.6)));
		b.x('mouseup', '1');
		await t.sleep(700);
		r = await rects();
		t.check('разделитель двигает границу', r['/b'].w < half - 150 && r['/a'].w > half + 100, r);

		// Двойной щелчок по разделителю возвращает пополам
		const px = gx + Math.round(win.w / 2) - 200;
		b.x('mousemove', String(px), String(gy + Math.round(win.h * 0.6)));
		b.x('click', '--repeat', '2', '--delay', '80', '1');
		await t.sleep(700);
		r = await rects();
		t.check('двойной щелчок возвращает пополам', Math.abs(r['/a'].w - r['/b'].w) <= 10, r);

		await key('ctrl+alt+v');
		r = await rects();
		t.check('повторное нажатие убирает разделение', r['/b'].vis === 'visible' && r['/a'].vis === 'hidden', r);

		// Закрытие одной из пары снимает разделение
		await key('ctrl+alt+v');
		await key('ctrl+w');
		r = await rects();
		t.check('после закрытия одной страницы вторая занимает всё окно', Object.keys(r).length === 1 && Object.values(r)[0].w > half + 200, r);
		t.check('в консоли нет ошибок', b.errors.length === 0, b.errors.slice(0, 5));
	},
};
