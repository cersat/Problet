// Запуск Problet с отладочным портом и управление им через CDP.
// Внутренние страницы (problet://) открываются «виртуальными вкладками» — iframe в панели инструментов (problet://ui/),
// поэтому почти всё делается через одну цель: панель
const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { root, sleep, ensureDisplay } = require('./env');

const ELECTRON = require(path.join(root, 'node_modules', 'electron'));

const freePort = () => new Promise((resolve) => {
	const s = net.createServer();
	s.listen(0, '127.0.0.1', () => {
		const p = s.address().port;
		s.close(() => resolve(p));
	});
});

async function connect(target) {
	const ws = new WebSocket(target.webSocketDebuggerUrl);
	await new Promise((res, rej) => {
		ws.onopen = res;
		ws.onerror = rej;
	});
	let id = 0;
	const pending = new Map();
	const listeners = [];
	ws.onmessage = (m) => {
		const msg = JSON.parse(m.data);
		if (msg.id && pending.has(msg.id)) {
			pending.get(msg.id)(msg);
			pending.delete(msg.id);
		} else if (msg.method) for (const f of listeners) f(msg);
	};
	// Цель могла закрыться (вкладку закрыли, браузер вышел): ждущие ответа запросы не должны висеть вечно
	ws.onclose = () => {
		for (const res of pending.values()) res({ error: { message: 'цель отладки закрылась' } });
		pending.clear();
	};
	const send = (method, params = {}) => new Promise((res) => {
		if (ws.readyState !== 1) return res({ error: { message: 'цель отладки закрыта' } });
		const i = ++id;
		pending.set(i, res);
		ws.send(JSON.stringify({ id: i, method, params }));
		setTimeout(() => {
			if (pending.has(i)) {
				pending.delete(i);
				res({ error: { message: 'нет ответа за 60 с: ' + method } });
			}
		}, 60000);
	});
	const ev = async (expression) => {
		const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
		if (!r.result) throw new Error(JSON.stringify(r.error || r).slice(0, 300));
		if (r.result.exceptionDetails) {
			const d = r.result.exceptionDetails;
			throw new Error((d.exception && d.exception.description) || d.text);
		}
		return r.result.result.value;
	};
	return { send, ev, on: (f) => listeners.push(f), close: () => ws.close() };
}

// opts: { env, dir (папка профиля), args (доп. параметры), lang ('ru' | 'en'), keep (не стирать профиль) }
async function start(opts) {
	const display = await ensureDisplay();
	if (!opts.keep) fs.rmSync(opts.dir, { recursive: true, force: true });
	fs.mkdirSync(opts.dir, { recursive: true });
	// Язык задаём заранее, чтобы проверки не зависели от системы
	const dataFile = path.join(opts.dir, 'data.json');
	if (!fs.existsSync(dataFile)) fs.writeFileSync(dataFile, JSON.stringify({ settings: { language: opts.lang || 'ru', ...(opts.settings || {}) } }));
	const port = await freePort();
	const env = { ...opts.env, DISPLAY: display };
	const proc = spawn(ELECTRON, [root, '--no-sandbox', '--remote-debugging-port=' + port, '--user-data-dir=' + opts.dir, ...(opts.args || [])], { env, stdio: ['ignore', 'ignore', 'pipe'] });
	let stderr = '';
	proc.stderr.on('data', (d) => { stderr += d; });
	const targets = async () => (await fetch('http://127.0.0.1:' + port + '/json')).json();
	const find = async (pred, ms = 20000) => {
		const end = Date.now() + ms;
		while (Date.now() < end) {
			try {
				const t = (await targets()).find(pred);
				if (t) return t;
			} catch (e) { /* ещё не поднялся */ }
			await sleep(200);
		}
		throw new Error('Не нашлась цель отладки. stderr: ' + stderr.slice(-400));
	};
	const tb = await connect(await find((t) => t.url === 'problet://ui/'));
	// Ошибки консоли и исключения во всех внутренних страницах
	const errors = [];
	await tb.send('Runtime.enable');
	tb.on((m) => {
		if (m.method === 'Runtime.exceptionThrown') errors.push((m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text);
		if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value || a.description).join(' '));
	});
	await waitFor(() => tb.ev(`!!document.querySelector('iframe.vframe') || document.querySelectorAll('#tabs .tab').length > 0`), 15000);
	await sleep(800);

	const st = () => tb.ev(`(() => { const on = document.querySelector('iframe.vframe.on'); let src = null, title = null; try { src = on && on.contentWindow.location.href; title = on && on.contentDocument.title; } catch (e) {} return { virtual: !!on, src, title, addr: document.getElementById('address').value, back: !document.getElementById('back').disabled, fwd: !document.getElementById('forward').disabled, tabs: [...document.querySelectorAll('#tabs .tab')].map(e => e.title), active: (document.querySelector('#tabs .tab.active') || {}).title }; })()`);
	// Код в активной внутренней странице: w — её window, d — document
	const fe = (code) => tb.ev(`(async () => { const f = document.querySelector('iframe.vframe.on'); if (!f) throw new Error('активная вкладка не внутренняя'); const w = f.contentWindow; const d = w.document; return (${code}); })()`);
	const go = async (u, ms = 1500) => {
		await tb.ev(`problet.go(${JSON.stringify(u)})`);
		await sleep(ms);
		// Внутренняя страница: дожидаемся, пока именно она станет активной и в ней появится problet
		const m = /^problet:\/\/([^/?#]+)/.exec(u);
		if (m) await waitFor(async () => { const s = await st(); return s.src && s.src.includes('/' + m[1]) && await fe('!!w.problet && d.readyState === "complete"'); }, 8000);
	};
	const newTab = async (u, ms = 1500) => {
		await tb.ev('problet.newTab()');
		await sleep(600);
		if (u) await go(u, ms);
	};
	// Обычная страница (не внутренняя): отдельная цель отладки
	const page = async (pred, ms) => connect(await find((t) => t.type === 'page' && pred(t.url), ms));
	const x = (...args) => spawnSync('xdotool', args, { env, encoding: 'utf8' }).stdout.trim();
	const winId = () => x('search', '--name', 'Problet').split('\n').filter(Boolean).pop();
	const activate = async () => {
		const id = winId();
		if (id) x('windowactivate', '--sync', id);
		await sleep(300);
	};
	const shot = async (file) => {
		const r = await tb.send('Page.captureScreenshot', { format: 'png' });
		fs.writeFileSync(file, Buffer.from(r.result.data, 'base64'));
	};
	const close = async () => {
		try { tb.close(); } catch (e) { /* уже закрыто */ }
		try { proc.kill('SIGKILL'); } catch (e) { /* уже нет */ }
		await sleep(400);
	};
	// Обычное закрытие окна (сохраняет сессию и данные)
	const quit = async () => {
		tb.ev('problet.winClose()').catch(() => { /* окно закрылось вместе с панелью */ });
		const end = Date.now() + 8000;
		while (proc.exitCode === null && Date.now() < end) await sleep(200);
		await close();
	};
	process.on('exit', () => { try { proc.kill('SIGKILL'); } catch (e) { /* уже нет */ } });
	return { proc, port, env, dir: opts.dir, tb, st, fe, go, newTab, page, find, targets, errors, x, winId, activate, shot, close, quit, stderr: () => stderr };
}

async function waitFor(fn, ms = 10000, step = 200) {
	const end = Date.now() + ms;
	let last;
	while (Date.now() < end) {
		try {
			last = await fn();
			if (last) return last;
		} catch (e) { last = e; }
		await sleep(step);
	}
	return last instanceof Error ? false : last;
}

// Запуск без отладочного порта: для проверок, где порт сам по себе запрещён (родительский контроль)
function plain(opts) {
	return spawn(ELECTRON, [root, '--no-sandbox', '--user-data-dir=' + opts.dir, ...(opts.args || [])], { env: opts.env, stdio: ['ignore', 'pipe', 'pipe'] });
}

module.exports = { start, plain, connect, waitFor, ELECTRON };
