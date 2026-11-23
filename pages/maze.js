// Мини-игра «Лабиринт»: на странице problet://game и на всех страницах 404.
// Монтируется в элемент #maze; уровни растут, рекорды хранятся в localStorage
(function () {
	const box = document.getElementById('maze');
	if (!box) return;
	const EN = document.documentElement.dataset.lang === 'en' || document.documentElement.lang === 'en';
	const L = (ru, en) => (EN ? en : ru);
	const compact = box.dataset.compact === '1'; // на 404 игра поменьше

	const store = {
		get(k, d) {
			try {
				const v = localStorage.getItem('maze-' + k);
				return v === null ? d : JSON.parse(v);
			} catch (e) {
				return d;
			}
		},
		set(k, v) {
			try {
				localStorage.setItem('maze-' + k, JSON.stringify(v));
			} catch (e) { /* без рекордов */ }
		},
	};

	box.innerHTML = '<div class="mz-hud"><span class="mz-level"></span><span class="mz-moves"></span><span class="mz-run"></span><span class="mz-time"></span><span class="mz-best"></span></div>'
		+ '<canvas class="mz-canvas" tabindex="0" aria-label="' + L('Лабиринт: управление стрелками или WASD', 'Maze: use the arrow keys or WASD') + '"></canvas>'
		+ '<div class="mz-msg" aria-live="polite"></div>'
		+ '<div class="mz-bar"><button class="mz-new">' + L('Новый лабиринт', 'New maze') + '</button>'
		+ '<button class="mz-reset">' + L('С первого уровня', 'Back to level 1') + '</button>'
		+ '<label class="mz-fog"><input type="checkbox"> ' + L('Туман', 'Fog') + '</label></div>'
		+ '<p class="mz-help">' + L('Стрелки или WASD — ходить, с Shift — бежать до развилки (с уровнями всё короче). Кружки одного цвета — порталы. Дойди до флажка.', 'Arrows or WASD to move, hold Shift to run to the next fork (shorter on higher levels). Circles of one colour are portals. Reach the flag.') + '</p>';
	const $ = (c) => box.querySelector(c);
	const canvas = $('.mz-canvas');
	const ctx = canvas.getContext('2d');
	const fogBox = $('.mz-fog input');

	let level = store.get('level', 1);
	let fog = store.get('fog', false);
	fogBox.checked = fog;
	let W = 0;
	let H = 0;
	let walls = null; // для каждой клетки: биты 1 — сверху, 2 — справа, 4 — снизу, 8 — слева
	let seen = null;
	let trail = null;
	let px = 0;
	let py = 0;
	let moves = 0;
	let started = 0;
	let finished = false;
	let timer = 0;
	let ex = 0; // выход
	let ey = 0;
	let portals = new Map(); // клетка -> клетка-пара
	let portalColor = new Map();

	// Сложность растёт с уровнем: размер, ветвистость (больше развилок и тупиков), короче бег с Shift, с 25-го уровня порталы
	const PORTAL_LEVEL = 25;
	const sizeFor = (lv) => Math.min(compact ? 41 : 51, lv <= 8 ? 7 + (lv - 1) * 2 : 21 + Math.floor((lv - 8) / 3) * 2);
	const branchFor = (lv) => Math.min(0.9, (lv - 1) * 0.06); // 0 — длинные коридоры, ближе к 1 — много коротких тупиков
	const runFor = (lv) => (lv <= 4 ? Infinity : Math.max(2, 30 - lv)); // сколько клеток можно пробежать за одно нажатие
	const portalsFor = (lv) => (lv < PORTAL_LEVEL ? 0 : Math.min(5, 1 + Math.floor((lv - PORTAL_LEVEL) / 4)));
	const PORTAL_COLORS = ['#c77dff', '#ffb347', '#4dd0e1', '#ff6b8b', '#b5e655'];

	// Лабиринт «растущим деревом»: продолжаем то с последней клетки (длинные коридоры), то со случайной (развилки).
	// Между любыми двумя клетками ровно один путь
	function generate() {
		W = sizeFor(level);
		H = compact ? Math.max(7, Math.round(W * 0.62)) : W;
		walls = new Uint8Array(W * H).fill(15);
		const visited = new Uint8Array(W * H);
		const branch = branchFor(level);
		const active = [0];
		visited[0] = 1;
		const DIRS = [[0, -1, 1, 4], [1, 0, 2, 8], [0, 1, 4, 1], [-1, 0, 8, 2]];
		while (active.length) {
			const i = Math.random() < branch ? Math.floor(Math.random() * active.length) : active.length - 1;
			const c = active[i];
			const x = c % W;
			const y = (c - x) / W;
			const opts = DIRS.filter(([dx, dy]) => {
				const nx = x + dx;
				const ny = y + dy;
				return nx >= 0 && ny >= 0 && nx < W && ny < H && !visited[ny * W + nx];
			});
			if (!opts.length) {
				active.splice(i, 1);
				continue;
			}
			const [dx, dy, bit, back] = opts[Math.floor(Math.random() * opts.length)];
			const n = (y + dy) * W + x + dx;
			walls[c] &= ~bit;
			walls[n] &= ~back;
			visited[n] = 1;
			active.push(n);
		}
		// Выход — в самой дальней по пути клетке от старта
		const dist = new Int32Array(W * H).fill(-1);
		const queue = [0];
		dist[0] = 0;
		let far = 0;
		for (let q = 0; q < queue.length; q++) {
			const c = queue[q];
			if (dist[c] > dist[far]) far = c;
			for (const [dx, dy, bit] of DIRS) {
				if (walls[c] & bit) continue;
				const n = c + dy * W + dx;
				if (dist[n] < 0) {
					dist[n] = dist[c] + 1;
					queue.push(n);
				}
			}
		}
		ex = far % W;
		ey = (far - ex) / W;
		// Порталы: пары клеток, шагнул на одну — оказался на другой. Не на старте, не на выходе и не рядом с ними
		portals = new Map();
		portalColor = new Map();
		const free = [];
		for (let c = 0; c < W * H; c++) {
			const x = c % W;
			const y = (c - x) / W;
			if (x + y > 2 && Math.abs(x - ex) + Math.abs(y - ey) > 2) free.push(c);
		}
		for (let k = 0; k < portalsFor(level) && free.length >= 2; k++) {
			const a = free.splice(Math.floor(Math.random() * free.length), 1)[0];
			const b = free.splice(Math.floor(Math.random() * free.length), 1)[0];
			portals.set(a, b);
			portals.set(b, a);
			portalColor.set(a, PORTAL_COLORS[k]);
			portalColor.set(b, PORTAL_COLORS[k]);
		}
		seen = new Uint8Array(W * H);
		trail = new Uint8Array(W * H);
		px = 0;
		py = 0;
		moves = 0;
		started = 0;
		finished = false;
		reveal();
		trail[0] = 1;
		msg('');
		resize();
		hud();
	}

	function reveal() {
		for (let y = py - 2; y <= py + 2; y++) for (let x = px - 2; x <= px + 2; x++) if (x >= 0 && y >= 0 && x < W && y < H) seen[y * W + x] = 1;
	}

	const css = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
	let cell = 20;
	function resize() {
		const maxW = Math.min(box.clientWidth || 600, compact ? 560 : 760);
		const maxH = compact ? 300 : Math.max(300, innerHeight - 260);
		cell = Math.max(8, Math.floor(Math.min(maxW / W, maxH / H)));
		const dpr = window.devicePixelRatio || 1;
		canvas.style.width = W * cell + 'px';
		canvas.style.height = H * cell + 'px';
		canvas.width = Math.round(W * cell * dpr);
		canvas.height = Math.round(H * cell * dpr);
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		draw();
	}

	function draw() {
		const bg = css('--panel', '#28282b');
		const wall = css('--text-strong', '#f4f4f6');
		const acc = css('--accent', '#7c9cf5');
		ctx.fillStyle = bg;
		ctx.fillRect(0, 0, W * cell, H * cell);
		// след
		ctx.fillStyle = acc;
		ctx.globalAlpha = 0.22;
		for (let i = 0; i < W * H; i++) {
			if (!trail[i]) continue;
			const x = i % W;
			const y = (i - x) / W;
			ctx.fillRect(x * cell + cell * 0.3, y * cell + cell * 0.3, cell * 0.4, cell * 0.4);
		}
		ctx.globalAlpha = 1;
		// порталы
		for (const [c, color] of portalColor) {
			if (fog && !seen[c]) continue;
			const x = c % W;
			const y = (c - x) / W;
			ctx.strokeStyle = color;
			ctx.fillStyle = color;
			ctx.lineWidth = Math.max(1.5, cell / 8);
			ctx.beginPath();
			ctx.arc(x * cell + cell / 2, y * cell + cell / 2, cell * 0.34, 0, Math.PI * 2);
			ctx.stroke();
			ctx.globalAlpha = 0.35;
			ctx.beginPath();
			ctx.arc(x * cell + cell / 2, y * cell + cell / 2, cell * 0.2, 0, Math.PI * 2);
			ctx.fill();
			ctx.globalAlpha = 1;
		}
		// выход
		if (!fog || seen[ey * W + ex]) {
			ctx.fillStyle = '#5fc47f';
			const s = cell * 0.22;
			ctx.fillRect(ex * cell + s * 1.4, ey * cell + s, cell * 0.08, cell - s * 2);
			ctx.beginPath();
			ctx.moveTo(ex * cell + s * 1.4 + cell * 0.08, ey * cell + s);
			ctx.lineTo(ex * cell + cell - s, ey * cell + s + cell * 0.16);
			ctx.lineTo(ex * cell + s * 1.4 + cell * 0.08, ey * cell + s + cell * 0.32);
			ctx.fill();
		}
		// стены
		ctx.strokeStyle = wall;
		ctx.lineWidth = Math.max(1.5, cell / 9);
		ctx.lineCap = 'round';
		ctx.beginPath();
		for (let y = 0; y < H; y++) {
			for (let x = 0; x < W; x++) {
				if (fog && !seen[y * W + x]) continue;
				const w = walls[y * W + x];
				const X = x * cell;
				const Y = y * cell;
				if (w & 1) { ctx.moveTo(X, Y); ctx.lineTo(X + cell, Y); }
				if (w & 2) { ctx.moveTo(X + cell, Y); ctx.lineTo(X + cell, Y + cell); }
				if (w & 4) { ctx.moveTo(X, Y + cell); ctx.lineTo(X + cell, Y + cell); }
				if (w & 8) { ctx.moveTo(X, Y); ctx.lineTo(X, Y + cell); }
			}
		}
		ctx.stroke();
		// туман
		if (fog) {
			ctx.fillStyle = css('--bg', '#1e1e20');
			for (let i = 0; i < W * H; i++) {
				if (seen[i]) continue;
				const x = i % W;
				const y = (i - x) / W;
				ctx.fillRect(x * cell - 1, y * cell - 1, cell + 2, cell + 2);
			}
		}
		// игрок
		ctx.fillStyle = acc;
		ctx.beginPath();
		ctx.arc(px * cell + cell / 2, py * cell + cell / 2, cell * 0.32, 0, Math.PI * 2);
		ctx.fill();
	}

	const fmt = (ms) => (ms / 1000).toFixed(1) + L(' с', ' s');
	function hud() {
		$('.mz-level').textContent = L('Уровень ', 'Level ') + level + ' · ' + W + '×' + H;
		const run = runFor(level);
		$('.mz-run').textContent = run === Infinity ? '' : L('Бег: ', 'Run: ') + run;
		$('.mz-moves').textContent = L('Ходов: ', 'Moves: ') + moves;
		$('.mz-time').textContent = L('Время: ', 'Time: ') + fmt(started ? (finished ? finished : Date.now()) - started : 0);
		const best = store.get('best', {})[recordKey()];
		$('.mz-best').textContent = best ? L('Рекорд: ', 'Best: ') + fmt(best) : '';
	}
	const recordKey = () => 'L' + level + (fog ? 'f' : ''); // рекорд на каждый уровень: лабиринты разных уровней устроены по-разному
	function msg(t) {
		$('.mz-msg').textContent = t;
	}

	const DIR = { ArrowUp: [0, -1, 1], ArrowRight: [1, 0, 2], ArrowDown: [0, 1, 4], ArrowLeft: [-1, 0, 8], w: [0, -1, 1], d: [1, 0, 2], s: [0, 1, 4], a: [-1, 0, 8], ц: [0, -1, 1], в: [1, 0, 2], ы: [0, 1, 4], ф: [-1, 0, 8] };
	function step(dx, dy, bit) {
		if (walls[py * W + px] & bit) return false;
		px += dx;
		py += dy;
		moves++;
		trail[py * W + px] = 1;
		reveal();
		const to = portals.get(py * W + px);
		if (to !== undefined) {
			px = to % W;
			py = (to - px) / W;
			trail[to] = 1;
			reveal();
			return 'portal';
		}
		return true;
	}
	const openings = (x, y) => 4 - [1, 2, 4, 8].filter((b) => walls[y * W + x] & b).length;
	function move(dx, dy, bit, run) {
		if (finished) return;
		if (!started) {
			started = Date.now();
			clearInterval(timer);
			timer = setInterval(hud, 100);
		}
		const first = step(dx, dy, bit);
		if (!first) return;
		// бег: по коридору до развилки, тупика или портала, но не дальше, чем позволяет уровень
		if (run && first !== 'portal') {
			let left = runFor(level) - 1;
			while (left-- > 0 && !(px === ex && py === ey) && openings(px, py) === 2) {
				const back = { 1: 4, 2: 8, 4: 1, 8: 2 }[bit];
				const next = [[0, -1, 1], [1, 0, 2], [0, 1, 4], [-1, 0, 8]].find(([, , b]) => b !== back && !(walls[py * W + px] & b));
				if (!next) break;
				[dx, dy, bit] = next;
				if (step(dx, dy, bit) === 'portal') break;
			}
		}
		draw();
		hud();
		if (px === ex && py === ey) win();
	}

	function win() {
		finished = Date.now();
		clearInterval(timer);
		const time = finished - started;
		const key = recordKey();
		const best = store.get('best', {});
		const record = !best[key] || time < best[key];
		if (record) {
			best[key] = time;
			store.set('best', best);
		}
		hud();
		level++;
		store.set('level', level);
		const news = level === PORTAL_LEVEL ? L(' Дальше — порталы!', ' Portals ahead!') : '';
		msg((record ? L('Новый рекорд! ', 'New record! ') : '') + L('Уровень пройден за ', 'Level cleared in ') + fmt(time) + L('. Enter — дальше', '. Press Enter for the next one') + news);
	}

	canvas.addEventListener('keydown', onKey);
	document.addEventListener('keydown', (e) => {
		if (document.activeElement === canvas || e.target !== document.body) return;
		onKey(e);
	});
	function onKey(e) {
		if (e.ctrlKey || e.metaKey || e.altKey) return;
		const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
		if (DIR[k]) {
			e.preventDefault();
			move(DIR[k][0], DIR[k][1], DIR[k][2], e.shiftKey);
		} else if (k === 'Enter' && finished) {
			e.preventDefault();
			generate();
		}
	}
	// касание и мышь: шаг в сторону нажатия от игрока
	canvas.addEventListener('pointerdown', (e) => {
		canvas.focus();
		const r = canvas.getBoundingClientRect();
		const dx = (e.clientX - r.left) / cell - (px + 0.5);
		const dy = (e.clientY - r.top) / cell - (py + 0.5);
		if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
		if (Math.abs(dx) > Math.abs(dy)) move(dx > 0 ? 1 : -1, 0, dx > 0 ? 2 : 8, e.shiftKey);
		else move(0, dy > 0 ? 1 : -1, dy > 0 ? 4 : 1, e.shiftKey);
	});
	$('.mz-new').addEventListener('click', () => {
		generate();
		canvas.focus();
	});
	$('.mz-reset').addEventListener('click', () => {
		level = 1;
		store.set('level', 1);
		generate();
		canvas.focus();
	});
	fogBox.addEventListener('change', () => {
		fog = fogBox.checked;
		store.set('fog', fog);
		draw();
		hud();
		canvas.focus();
	});
	window.addEventListener('resize', () => resize());
	new MutationObserver(draw).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style', 'class'] });
	generate();
	if (!compact) canvas.focus();
})();
