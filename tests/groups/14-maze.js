// Мини-игра «Лабиринт»: растёт с уровнем, становится ветвистее, бег с Shift укорачивается, с 25-го уровня порталы
// (шагнул в портал — оказался у пары), выход в самой дальней клетке. Игра есть на problet://game и на страницах 404
const fs = require('fs');
const path = require('path');

module.exports = {
	title: 'Лабиринт: сложность по уровням, бег с Shift, порталы, выход, 404',
	gui: true,
	async run(t) {
		// Копия игры с доступом к внутренностям (только для проверки, в программу не входит)
		const root = path.join(__dirname, '..', '..');
		const dir = path.join(t.dir, 'maze');
		fs.mkdirSync(dir, { recursive: true });
		let src = fs.readFileSync(path.join(root, 'pages', 'maze.js'), 'utf8');
		const hook = '\tgenerate();\n\tif (!compact) canvas.focus();';
		t.check('в игре есть точка, где она запускается', src.includes(hook));
		src = src.replace(hook, '\tgenerate();\n\twindow.__mz = { get portals() { return portals; }, get pos() { return [px, py]; }, get exit() { return [ex, ey]; }, get W() { return W; }, get H() { return H; }, get walls() { return walls; }, move, regen: () => generate() };');
		fs.writeFileSync(path.join(dir, 'maze.js'), src);
		fs.copyFileSync(path.join(root, 'pages', 'maze.css'), path.join(dir, 'maze.css'));
		fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="maze.css"></head><body><div id="maze"></div><script>localStorage.setItem("maze-level", new URLSearchParams(location.search).get("l") || "1")</script><script src="maze.js"></script></body></html>');
		const b = await t.browser();
		const at = async (level) => {
			const url = 'file://' + path.join(dir, 'index.html') + '?l=' + level;
			await b.go(url, 1500);
			return b.page((u) => u.startsWith('file://') && u.endsWith('?l=' + level));
		};
		// Тупики: клетки с одним проходом
		const stats = `(() => { const m = window.__mz; let dead = 0; for (let c = 0; c < m.W * m.H; c++) { const w = m.walls[c]; const open = 4 - ((w & 1 ? 1 : 0) + (w & 2 ? 1 : 0) + (w & 4 ? 1 : 0) + (w & 8 ? 1 : 0)); if (open === 1) dead++; } return { W: m.W, H: m.H, dead, cells: m.W * m.H, portals: m.portals.size / 2, exit: m.exit, hud: document.querySelector('.mz-hud').textContent }; })()`;
		const info = {};
		for (const lv of [1, 5, 15, 25, 30, 45]) {
			const pg = await at(lv);
			info[lv] = await pg.ev(stats);
			pg.close();
		}
		t.check('размер растёт с уровнем', info[1].W < info[5].W && info[5].W < info[15].W && info[15].W < info[30].W, Object.fromEntries(Object.entries(info).map(([k, v]) => [k, v.W + 'x' + v.H])));
		t.check('тупиков становится больше (доля)', info[30].dead / info[30].cells > info[1].dead / info[1].cells * 1.4, [info[1].dead / info[1].cells, info[30].dead / info[30].cells]);
		t.check('до 25-го уровня порталов нет, с 25-го есть, дальше больше', info[15].portals === 0 && info[25].portals === 1 && info[45].portals > info[25].portals, [info[15].portals, info[25].portals, info[45].portals]);
		t.check('выход не в углу старта', info[30].exit[0] + info[30].exit[1] > 4, info[30].exit);
		t.check('бег показан в строке: на 1-м без ограничения, на 30-м — 2 клетки', !/Бег/.test(info[1].hud) && /Бег: 2/.test(info[30].hud), [info[1].hud, info[30].hud]);

		// Бег с Shift: на 30-м уровне одно нажатие — не больше двух шагов
		let pg = await at(30);
		const ran = await pg.ev(`(() => { const m = window.__mz; const D = [[1, 0, 2], [0, 1, 4], [-1, 0, 8], [0, -1, 1]]; const [x, y] = m.pos; const c = y * m.W + x; const d = D.find(([, , bit]) => !(m.walls[c] & bit)); m.move(d[0], d[1], d[2], true); const [x2, y2] = m.pos; return Math.abs(x2 - x) + Math.abs(y2 - y); })()`);
		t.check('бег с Shift на 30-м уровне не дальше 2 клеток', ran >= 1 && ran <= 2, ran);
		pg.close();

		// Портал: идём к клетке портала по проходам и оказываемся у пары
		pg = await at(25);
		const tp = await pg.ev(`(() => { const m = window.__mz; const W = m.W; const [a, b] = [...m.portals][0]; const D = [[0, -1, 1], [1, 0, 2], [0, 1, 4], [-1, 0, 8]]; const prev = new Map([[0, null]]); const q = [0]; for (let i = 0; i < q.length; i++) { const c = q[i]; if (c === a) break; for (const [dx, dy, bit] of D) { if (m.walls[c] & bit) continue; const n = c + dy * W + dx; if (!prev.has(n)) { prev.set(n, [c, dx, dy, bit]); q.push(n); } } } const path = []; for (let c = a; prev.get(c); c = prev.get(c)[0]) path.unshift(prev.get(c)); for (const [c, dx, dy, bit] of path) { const [x, y] = m.pos; if (y * W + x !== c) return { skip: true }; m.move(dx, dy, bit, false); } const [x, y] = m.pos; return { a, b, now: y * W + x }; })()`);
		t.check('шагнул в портал — оказался у его пары', tp.skip || tp.now === tp.b, tp);
		pg.close();

		await b.go('problet://game/', 1200);
		t.check('problet://game: игра на месте', await b.fe(`!!d.querySelector('.mz-canvas')`));
		await b.go('problet://такой-нет/', 1200);
		t.check('страница 404 — тоже с игрой', await b.fe(`!!d.querySelector('.mz-canvas')`));
		t.check('без ошибок в консоли', b.errors.length === 0, b.errors.slice(0, 5));
	},
};
