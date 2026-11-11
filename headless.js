// Режим без окна: `problet --headless`. Браузер работает скрыто, с одноразовым профилем (если не задан --user-data-dir).
//
// Одноразовая загрузка (печатает отчёт JSON в stdout и выходит):
//   problet --headless --fetch=URL [--runs=N] [--wait=мс] [--text] [--shot=файл.png] [--eval=JS] [--adblock]
//     --runs   сколько раз загрузить страницу с чистого листа (счётчики запросов складываются)
//     --wait   сколько ждать после окончания загрузки, пока страница дорисуется (по умолчанию 4000)
//     --size   размер страницы, по умолчанию 1280x800
//     --adblock включить блокировщик рекламы в этом запуске
//     --insert  скрипт (код или путь к .js файлу), который выполнится на каждой странице до её собственных скриптов (работает и в режиме управления)
//
// Управление по HTTP (127.0.0.1, нужен токен): `problet --headless [--control-port=N]`
//   адрес, порт и токен печатаются в stdout и пишутся в <tmp>/problet/headless.json
//   GET  /tabs                      список вкладок
//   POST /open     {url, wait}      открыть адрес в новой вкладке и дождаться загрузки
//   POST /eval     {tab, js}        выполнить JS на странице, вернуть результат
//   GET  /text?tab=                 текст страницы
//   GET  /screenshot?tab=           PNG
//   GET  /requests?clear=1          сводка запросов по хостам (blocked — заблокирован блокировщиком)
//   GET  /console?clear=1           ошибки и предупреждения из консоли страниц
//   GET  /log?lines=200             хвост журнала
//   POST /close    {tab}            закрыть вкладку
//   POST /quit                      выйти
// Токен — в заголовке x-token или в параметре ?token=

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const argv = process.argv;
const flag = (name) => argv.includes('--' + name);
const opt = (name) => {
	const a = argv.find((x) => x.startsWith('--' + name + '='));
	return a ? a.slice(name.length + 3) : null;
};

const enabled = flag('headless');

// Сводка запросов по хостам: host -> { n, blocked, types }
const hosts = new Map();

function record(entry) {
	const h = hosts.get(entry.host) || { n: 0, blocked: 0, types: new Set() };
	h.n++;
	if (entry.blocked) h.blocked++;
	h.types.add(entry.type);
	hosts.set(entry.host, h);
}

function summary() {
	return [...hosts.entries()]
		.map(([host, h]) => ({ host, requests: h.n, blocked: h.blocked, types: [...h.types] }))
		.sort((a, b) => b.requests - a.requests);
}

// --insert=код или --insert=путь/к/файлу.js
function insertSource() {
	const v = opt('insert');
	if (!v) return '';
	try {
		if (fs.statSync(v).isFile()) return fs.readFileSync(v, 'utf8');
	} catch (e) { /* не файл: это сам код */ }
	return v;
}

// Без окна у вкладки нет настоящего размера: задаём его через отладчик (--size=1280x800)
async function sizeView(wc) {
	const m = /^(\d+)x(\d+)$/.exec(opt('size') || '');
	const width = m ? Number(m[1]) : 1280;
	const height = m ? Number(m[2]) : 800;
	if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
	await limit(wc.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }), 10000, 'размер');
	// Скрытое окно — «невидимая» страница: многие сайты в таком состоянии замирают, поэтому изображаем, что вкладка на виду
	await wc.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
	const source = insertSource();
	if (source) {
		await wc.debugger.sendCommand('Page.enable');
		await wc.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source });
	}
	wc.setBackgroundThrottling(false);
}

// Снимок через отладчик: работает и без окна, и без дисплея
async function capture(_ctx, wc) {
	const dbg = wc.debugger;
	const attached = dbg.isAttached();
	if (!attached) dbg.attach('1.3');
	try {
		const shot = await limit(dbg.sendCommand('Page.captureScreenshot', { format: 'png' }), 15000, 'снимок');
		return Buffer.from(shot.data, 'base64');
	} finally {
		if (!attached) dbg.detach();
	}
}

// Сообщения консоли страниц (ошибки и предупреждения): последние 200
const consoleLog = [];
function watchConsole(wc) {
	wc.on('console-message', (e) => {
		const level = e.level !== undefined ? e.level : 'info';
		if (level === 'error' || level === 'warning' || level === 2 || level === 3) {
			consoleLog.push({ level: String(level), text: String(e.message || '').slice(0, 300), source: String(e.sourceId || '').slice(0, 120), line: e.lineNumber });
			if (consoleLog.length > 200) consoleLog.shift();
		}
	});
}

// Страница может зависнуть (окно alert, тяжёлый скрипт): любое обращение к ней ограничено по времени, отчёт выходит всегда
const limit = (p, ms, what) => Promise.race([p, new Promise((_r, rej) => setTimeout(() => rej(new Error('Страница не ответила за ' + ms / 1000 + ' с: ' + what)), ms))]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function waitLoaded(wc, timeout = 30000) {
	return new Promise((resolve) => {
		if (!wc.isLoading()) return resolve(true);
		const done = (ok) => {
			clearTimeout(timer);
			wc.removeListener('did-stop-loading', onStop);
			resolve(ok);
		};
		const onStop = () => done(true);
		const timer = setTimeout(() => done(false), timeout);
		wc.on('did-stop-loading', onStop);
	});
}

// ctx: { dir, tabs(), createTab, closeTab, activeTab, log, quit, readLog, clearSite }
function start(ctx) {
	const wcOf = (id) => {
		const t = id ? ctx.tabs().find((x) => x.id === Number(id)) : ctx.activeTab();
		if (!t || !t.view.webContents || t.view.webContents.isDestroyed()) throw new Error('Вкладка не найдена');
		return t.view.webContents;
	};
	const info = (t) => ({ id: t.id, url: t.view.webContents.getURL(), title: t.view.webContents.getTitle(), loading: t.view.webContents.isLoading(), active: t === ctx.activeTab(), space: t.space });

	async function open(url, wait) {
		const t = ctx.createTab('about:blank', { activate: true });
		const wc = t.view.webContents;
		watchConsole(wc);
		await sizeView(wc);
		wc.loadURL(url).catch(() => {});
		const t0 = Date.now();
		const loaded = await waitLoaded(wc);
		await sleep(Number.isFinite(wait) ? wait : 1000);
		return { ...info(t), loaded, loadMs: Date.now() - t0 };
	}

	const oneShot = opt('fetch');
	if (oneShot) return fetchMode(ctx, oneShot, { ctx, runs: Number(opt('runs')) || 1, wait: opt('wait') === null ? 4000 : Number(opt('wait')), text: flag('text'), shot: opt('shot'), evalJs: opt('eval'), open, wcOf });

	const token = crypto.randomBytes(16).toString('hex');
	const server = http.createServer(async (req, res) => {
		const send = (code, body, type) => {
			res.writeHead(code, { 'content-type': type || 'application/json; charset=utf-8' });
			res.end(Buffer.isBuffer(body) || typeof body === 'string' ? body : JSON.stringify(body, null, 1));
		};
		try {
			const url = new URL(req.url, 'http://127.0.0.1');
			if ((req.headers['x-token'] || url.searchParams.get('token')) !== token) return send(401, { error: 'нужен токен' });
			let body = {};
			if (req.method === 'POST') {
				const chunks = [];
				for await (const c of req) chunks.push(c);
				try {
					body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
				} catch (e) {
					return send(400, { error: 'тело запроса — не JSON' });
				}
			}
			const tab = url.searchParams.get('tab') || body.tab;
			switch (req.method + ' ' + url.pathname) {
				case 'GET /tabs': return send(200, ctx.tabs().filter((t) => t.view.webContents && !t.view.webContents.isDestroyed()).map(info));
				case 'POST /open': return send(200, await open(String(body.url || ''), body.wait));
				case 'POST /eval': return send(200, { result: await wcOf(tab).executeJavaScript(String(body.js || 'undefined')) });
				case 'GET /text': return send(200, await wcOf(tab).executeJavaScript('document.body ? document.body.innerText : ""'), 'text/plain; charset=utf-8');
				case 'GET /screenshot': return send(200, await capture(ctx, wcOf(tab)), 'image/png');
				case 'GET /requests': {
					const out = summary();
					if (url.searchParams.get('clear')) hosts.clear();
					return send(200, out);
				}
				case 'GET /console': {
					const out = consoleLog.slice();
					if (url.searchParams.get('clear')) consoleLog.length = 0;
					return send(200, out);
				}
				case 'GET /log': return send(200, ctx.readLog(Number(url.searchParams.get('lines')) || 200), 'text/plain; charset=utf-8');
				case 'POST /close': ctx.closeTab(Number(tab)); return send(200, { ok: true });
				case 'POST /quit': send(200, { ok: true }); setTimeout(ctx.quit, 50); return;
				default: return send(404, { error: 'нет такого метода' });
			}
		} catch (e) {
			ctx.log('headless', req.method, req.url, e);
			send(500, { error: String(e && e.message || e) });
		}
	});
	server.listen(Number(opt('control-port')) || 0, '127.0.0.1', () => {
		const port = server.address().port;
		const file = path.join(ctx.dir, 'headless.json');
		const data = { url: 'http://127.0.0.1:' + port, port, token, pid: process.pid };
		try {
			fs.mkdirSync(path.dirname(file), { recursive: true });
			fs.writeFileSync(file, JSON.stringify(data), { mode: 0o600 });
		} catch (e) { /* без файла тоже работает: всё есть в stdout */ }
		process.stdout.write('PROBLET_HEADLESS ' + JSON.stringify(data) + '\n');
		ctx.log('headless: управление на', data.url);
	});
	return null;
}

async function fetchMode(ctx, target, o) {
	const report = { url: target, runs: [] };
	try {
		for (let i = 0; i < o.runs; i++) {
			hosts.clear();
			await ctx.clearSite();
			const first = i === 0;
			const r = await o.open(/^[a-z][a-z0-9+.-]*:/i.test(target) ? target : 'https://' + target, o.wait);
			const wc = o.wcOf(r.id);
			const run = { console: consoleLog.splice(0), loaded: r.loaded, loadMs: r.loadMs, title: r.title, finalUrl: r.url, hosts: summary() };
			if (first && o.text) run.text = await limit(wc.executeJavaScript('document.body ? document.body.innerText : ""'), 15000, 'текст').catch((e) => 'Ошибка: ' + e.message);
			if (first && o.shot) {
				try {
					fs.writeFileSync(o.shot, await capture(ctx, wc));
					run.shot = o.shot;
				} catch (e) {
					run.shotError = e.message;
				}
			}
			if (first && o.evalJs) run.eval = await limit(wc.executeJavaScript(o.evalJs), 15000, 'eval').catch((e) => 'Ошибка: ' + e.message);
			report.runs.push(run);
			ctx.closeTab(r.id);
		}
		// Сводка по всем прогонам
		const total = new Map();
		for (const run of report.runs) {
			for (const h of run.hosts) {
				const t = total.get(h.host) || { host: h.host, requests: 0, blocked: 0, runs: 0, types: new Set() };
				t.requests += h.requests;
				t.blocked += h.blocked;
				t.runs++;
				h.types.forEach((x) => t.types.add(x));
				total.set(h.host, t);
			}
		}
		report.hosts = [...total.values()].map((t) => ({ ...t, types: [...t.types] })).sort((a, b) => b.requests - a.requests);
	} catch (e) {
		report.error = String(e && e.message || e);
	}
	process.stdout.write(JSON.stringify(report, null, 1) + '\n');
	ctx.quit();
}

module.exports = { enabled, flag, opt, record, start };
