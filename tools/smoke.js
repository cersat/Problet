// Сквозная проверка Problet без окна: запускает браузер в режиме --headless и через его HTTP-управление проходит по основным функциям.
// Запуск: node tools/smoke.js   (из корня репозитория, после npm ci). Код выхода 0 — всё прошло.
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const electron = require(path.join(root, 'node_modules', 'electron'));
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'problet-smoke-'));
const profile = path.join(work, 'profile');
const files = path.join(work, 'файлы с пробелом');
const dl = path.join(work, 'downloads');
fs.mkdirSync(files, { recursive: true });
fs.mkdirSync(dl, { recursive: true });
fs.writeFileSync(path.join(files, 'страница.html'), '<!doctype html><meta charset="utf-8"><title>Локальная</title><p id="p">привет</p>');
fs.writeFileSync(path.join(files, 'pic.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>');
fs.mkdirSync(path.join(files, 'вложенная'));

let failed = 0;
const results = [];
function check(name, ok, info) {
	results.push((ok ? 'OK   ' : 'FAIL ') + name + (ok || info === undefined ? '' : '  -> ' + JSON.stringify(info)));
	console.log(results[results.length - 1]);
	if (!ok) failed++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Локальный сайт: обычная страница, «реклама», файл для скачивания
const server = http.createServer((req, res) => {
	if (req.url === '/') {
		res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
		res.end('<!doctype html><title>Сайт</title><h1 id="h">сайт</h1><form id="f"><input name="login" id="l"><input type="password" id="pw"></form><script src="/ads/banner.js"></script><script src="/ok.js"></script>');
	} else if (req.url === '/ads/banner.js') {
		res.writeHead(200, { 'content-type': 'text/javascript' });
		res.end('window.adLoaded = 1;');
	} else if (req.url === '/ok.js') {
		res.writeHead(200, { 'content-type': 'text/javascript' });
		res.end('window.okLoaded = 1;');
	} else if (req.url === '/plain.bin') {
		res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="plain.bin"' });
		res.end(Buffer.alloc(100, 7));
	} else if (req.url === '/file.bin') {
		res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': "attachment; filename*=UTF-8''" + encodeURIComponent('загрузка.bin') });
		res.end(Buffer.alloc(4096, 7));
	} else {
		res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
		res.end('нет');
	}
});

function launch(extra = []) {
	const args = [root, '--headless', '--user-data-dir=' + profile, ...extra];
	if (process.platform === 'linux') args.push('--no-sandbox');
	const child = spawn(electron, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PROBLET_TEST_SAVE_DIR: work } });
	let out = '';
	let err = '';
	child.stderr.on('data', (d) => { err += d; });
	const ready = new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('браузер не запустился за 60 с\n' + out + '\n' + err.slice(-2000))), 60000);
		child.stdout.on('data', (d) => {
			out += d;
			const m = /PROBLET_HEADLESS (\{.*\})/.exec(out);
			if (m) {
				clearTimeout(timer);
				resolve(JSON.parse(m[1]));
			}
		});
		child.on('exit', (code) => reject(new Error('браузер вышел с кодом ' + code + '\n' + out + '\n' + err.slice(-2000))));
	});
	return { child, ready };
}

function client(info) {
	const call = (method, p, body) => new Promise((resolve, reject) => {
		const data = body ? JSON.stringify(body) : null;
		const req = http.request({ host: '127.0.0.1', port: info.port, path: p, method, headers: { 'x-token': info.token, ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}) } }, (res) => {
			const chunks = [];
			res.on('data', (c) => chunks.push(c));
			res.on('end', () => {
				const buf = Buffer.concat(chunks);
				if (/image\/png/.test(res.headers['content-type'] || '')) return resolve(buf);
				const text = buf.toString('utf8');
				if (/json/.test(res.headers['content-type'] || '')) {
					const j = JSON.parse(text);
					if (res.statusCode >= 400) return reject(new Error(j.error || text));
					return resolve(j);
				}
				resolve(text);
			});
		});
		req.on('error', reject);
		req.setTimeout(60000, () => req.destroy(new Error('нет ответа: ' + p)));
		if (data) req.write(data);
		req.end();
	});
	return {
		open: (url, wait = 800) => call('POST', '/open', { url, wait }),
		ev: async (tab, js) => (await call('POST', '/eval', { tab, js })).result,
		tabs: () => call('GET', '/tabs'),
		text: (tab) => call('GET', '/text?tab=' + tab),
		shot: (tab) => call('GET', '/screenshot?tab=' + tab),
		console: () => call('GET', '/console?clear=1'),
		close: (tab) => call('POST', '/close', { tab }),
		quit: () => call('POST', '/quit', {}),
	};
}

async function first(base) {
	const b = launch();
	const c = client(await b.ready);
	const exited = new Promise((r) => b.child.on('exit', r));

	// --- обычные страницы
	let t = await c.open('data:text/html;charset=utf-8,<title>Данные</title><b id=x>42</b>');
	check('data: страница открывается', t.loaded && t.title === 'Данные', t);
	check('eval на странице', (await c.ev(t.id, 'document.getElementById("x").textContent')) === '42');
	check('текст страницы', (await c.text(t.id)).trim() === '42');
	const png = await c.shot(t.id);
	check('снимок страницы — PNG', Buffer.isBuffer(png) && png.length > 100 && png.readUInt32BE(0) === 0x89504e47, png && png.length);

	// --- настройки
	const s = await c.open('problet://settings/');
	check('страница настроек', /settings/.test(s.url) && !!(await c.ev(s.id, 'typeof api.getSettings')), s);
	const cur = await c.ev(s.id, 'api.getSettings().then(r => r.settings)');
	check('настройки читаются', cur && cur.engine === 'duckduckgo' && Array.isArray(cur.btnLayout.toolbar), cur && cur.engine);
	check('кнопка тёмной темы в скрытых по умолчанию', cur.btnLayout.hidden.includes('darkpage'), cur.btnLayout.hidden);
	const set = await c.ev(s.id, `api.setSettings({ adblock: true, customBlock: '127.0.0.1/ads/', downloadDir: ${JSON.stringify(dl)}, saveHistory: true, startup: 'session' }).then(r => [r.adblock, r.downloadDir, r.startup])`);
	check('настройки сохраняются', set[0] === true && set[1] === dl && set[2] === 'session', set);
	const bad = await c.ev(s.id, `api.setSettings({ engine: 'нет такого' }).then(() => 'принято', e => 'отказ')`);
	check('неверная настройка отклоняется', bad === 'отказ', bad);
	const cb = await c.ev(s.id, `(async () => { const st = (await api.getSettings()).settings; const e = { id: 'cb:smoke001', name: 'Проверка', icon: 'П', svg: '', type: 'script', value: 'document.title = "HK"', newTab: false }; let r = await api.setSettings({ customButtons: [...st.customButtons, e] }); r = await api.setSettings({ hotkeys: { ...r.hotkeys, 'cb:smoke001': 'Ctrl+Alt+J' } }); return [r.btnLayout.toolbar.includes('cb:smoke001'), r.hotkeys['cb:smoke001']]; })()`);
	check('своя кнопка и её клавиша', cb[0] === true && cb[1] === 'Ctrl+Alt+J', cb);
	const dup = await c.ev(s.id, `api.getSettings().then(r => api.setSettings({ hotkeys: { ...r.settings.hotkeys, find: 'Ctrl+Alt+J' } })).then(() => 'принято', () => 'отказ')`);
	check('занятое сочетание отклоняется', dup === 'отказ', dup);
	await sleep(900); // страница настроек узнаёт об изменениях с небольшой задержкой
	const hk = await c.ev(s.id, `[...document.querySelectorAll('#hotkeys .what')].map(e => e.textContent).filter(t => /Проверка|Тёмная тема/.test(t)).length`);
	check('в списке клавиш есть тёмная тема и своя кнопка', hk === 2, hk);
	const rows = await c.ev(s.id, `[...document.querySelectorAll('#btn-lists .pname')].map(e => e.textContent).join('|')`);
	check('в «Панелях» есть своя кнопка и тёмная тема', /Проверка/.test(rows) && /Тёмная тема страницы/.test(rows), rows);
	const ver = await c.ev(s.id, 'api.versionInfo()');
	check('сведения о версии', ver && ver.name === 'Problet' && /^\d+\./.test(ver.version) && !!ver.data, ver);
	const src = await c.ev(s.id, `api.importSources().then(l => Array.isArray(l), e => String(e))`);
	check('поиск других браузеров не падает', src === true, src);

	// --- закладки
	const bm = await c.open('problet://bookmarks/');
	const fileUrl = require('url').pathToFileURL(path.join(files, 'страница.html')).href;
	const st1 = await c.ev(bm.id, `(async () => { await api.addFolder('Папка'); let st = await api.bookmarks(); const f = st.folders[0]; await api.setFolderColor(f.id, st.colors[2].hex); await api.addBookmark({ title: 'Сайт', url: ${JSON.stringify(base + '/')}, folder: f.id }); await api.addBookmark({ title: 'Файл', url: ${JSON.stringify(fileUrl)} }); st = await api.bookmarks(); return { n: st.bookmarks.length, color: st.folders[0].color, folder: st.bookmarks[0].folder === f.id }; })()`);
	check('закладки, папка и её цвет', st1.n === 2 && /^#/.test(st1.color) && st1.folder, st1);
	const badBm = await c.ev(bm.id, `api.addBookmark({ title: 'x', url: 'javascript:alert(1)' }).then(() => 'принято', () => 'отказ')`);
	check('закладка с javascript: отклоняется', badBm === 'отказ', badBm);
	await sleep(600);
	const shown = await c.ev(bm.id, `document.querySelectorAll('#list .item').length`);
	check('менеджер закладок показывает обе', shown === 2, shown);
	// ссылка на локальный файл со страницы браузера
	await c.ev(bm.id, `[...document.querySelectorAll('#list .item a.info')].find(a => a.href.startsWith('file:')).click()`);
	await sleep(1500);
	const after = (await c.tabs()).find((x) => x.id === bm.id);
	check('закладка на локальный файл открывается из менеджера', !!after && after.url.startsWith('file:'), after && after.url);

	// --- проводник и локальные файлы
	const fl = await c.open('problet://files/?p=' + encodeURIComponent(files));
	const names = await c.ev(fl.id, `[...document.querySelectorAll('#list .row .name span:not(.ext)')].map(e => e.textContent)`);
	check('проводник показывает папку с юникодом и пробелом', names.includes('страница.html') && names.includes('pic.svg') && names.includes('вложенная'), names);
	const list = await c.ev(fl.id, `api.filesList(${JSON.stringify(files)})`);
	check('у записей проводника есть путь и адрес file://', list.entries.every((e) => e.path && e.url.startsWith('file:///')) && list.parent === work, list.parent);
	const rootDir = path.parse(files).root;
	const top = await c.ev(fl.id, `api.filesList(${JSON.stringify(rootDir)})`);
	if (process.platform === 'win32') {
		check('у корня диска родитель — список дисков', top.parent === '::drives', top.parent);
		const drives = await c.ev(fl.id, `api.filesList('::drives')`);
		check('список дисков Windows', drives.virtual === true && drives.entries.some((e) => e.path.toUpperCase() === rootDir.toUpperCase()), drives.entries.map((e) => e.path));
		const dr = await c.open('problet://files/?p=' + encodeURIComponent('::drives'));
		check('страница списка дисков', (await c.ev(dr.id, `document.querySelectorAll('#list .row').length`)) >= 1);
		await c.close(dr.id);
	} else {
		check('у корня нет родителя', top.parent === '' && top.entries.length > 0, top.parent);
	}
	const denied = await c.ev(fl.id, `api.filesList(${JSON.stringify(path.join(files, 'нет такой'))})`);
	check('несуществующая папка даёт понятную ошибку', !!denied.error && denied.entries.length === 0, denied.error);
	const lf = await c.open(fileUrl);
	check('локальная страница открывается', lf.title === 'Локальная' && (await c.ev(lf.id, 'document.getElementById("p").textContent')) === 'привет', lf);
	const dirTab = await c.open(require('url').pathToFileURL(files).href);
	check('адрес папки открывает проводник', dirTab.url.startsWith('problet://files/'), dirTab.url);
	const svgTab = await c.open(require('url').pathToFileURL(path.join(files, 'pic.svg')).href, 2500);
	check('svg открывается в редакторе', svgTab.url.startsWith('problet://svgedit/'), svgTab.url);
	const svgFile = path.join(files, 'новый.svg');
	const pngFile = path.join(files, 'точка.png');
	const png1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
	const io = await c.ev(fl.id, `(async () => { await api.svgWrite(${JSON.stringify(svgFile)}, '<svg xmlns="http://www.w3.org/2000/svg"/>'); const r = await api.svgRead(${JSON.stringify(svgFile)}); await api.pngWrite(${JSON.stringify(pngFile)}, 'data:image/png;base64,${png1}'); const p = await api.pngRead(${JSON.stringify(pngFile)}); const no = await api.svgWrite(${JSON.stringify(path.join(files, 'x.txt'))}, 'x').then(() => 'принято', () => 'отказ'); return [r.text.includes('<svg'), p.width, p.height, no]; })()`);
	check('чтение и запись svg и png', io[0] === true && io[1] === 1 && io[2] === 1 && io[3] === 'отказ' && fs.existsSync(svgFile) && fs.existsSync(pngFile), io);

	// --- сайт: блокировщик, история, скачивание
	const site = await c.open(base + '/', 1500);
	check('сайт открывается', site.title === 'Сайт', site);
	const ads = await c.ev(site.id, '[window.adLoaded || 0, window.okLoaded || 0]');
	check('своё правило блокировщика режет скрипт, остальное грузится', ads[0] === 0 && ads[1] === 1, ads);
	const visits = await c.ev(s.id, 'api.visits()');
	check('посещение попало в историю', visits.some((v) => v.url === base + '/' && v.title === 'Сайт'), visits.slice(0, 3));
	await c.ev(site.id, `location.href = ${JSON.stringify(base + '/plain.bin')}`);
	await sleep(1500);
	check('файл с обычным именем скачивается под своим именем', fs.existsSync(path.join(dl, 'plain.bin')), fs.readdirSync(dl));
	await c.ev(site.id, `location.href = ${JSON.stringify(base + '/file.bin')}`);
	let got = null;
	for (let i = 0; i < 40 && !got; i++) {
		await sleep(250);
		got = fs.readdirSync(dl).find((f) => f !== 'plain.bin' && !/\.crdownload$/.test(f)) || null;
	}
	check('файл скачивается в выбранную папку', !!got && fs.statSync(path.join(dl, got)).size === 4096, { got, dir: fs.readdirSync(dl) });
	check('имя файла с кириллицей сохранено', got === 'загрузка.bin', got);
	const dls = await c.ev(s.id, 'api.downloads()');
	check('загрузка есть в списке', dls.some((d) => d.state === 'done' && d.total === 4096), dls);
	const nf = await c.open(base + '/нет', 800);
	check('страница с ошибкой 404 показывается', (await c.text(nf.id)).includes('нет'), nf);
	const dead = await c.open('http://127.0.0.1:9/', 1200);
	check('недоступный сайт даёт страницу ошибки', /Не удалось открыть страницу/.test(await c.text(dead.id)), dead);

	// --- пароли
	const pw = await c.open('problet://passwords/');
	const v = await c.ev(pw.id, `(async () => { await api.pwCreate('мастер-пароль-1'); await api.pwAdd({ origin: 'example.com', username: 'я', password: 'секрет' }); const l1 = await api.pwList(); const p = await api.pwReveal(l1[0].id); await api.pwLock(); const locked = await api.pwList().then(() => 'открыто', () => 'закрыто'); const wrong = await api.pwUnlock('не тот пароль').then(() => 'принято', () => 'отказ'); await api.pwUnlock('мастер-пароль-1'); const l2 = await api.pwList(); return [l1.length, l1[0].origin, p, locked, wrong, l2.length]; })()`);
	check('хранилище паролей: создать, добавить, запереть, открыть', v[0] === 1 && v[1] === 'https://example.com' && v[2] === 'секрет' && v[3] === 'закрыто' && v[4] === 'отказ' && v[5] === 1, v);
	const vf = JSON.parse(fs.readFileSync(path.join(profile, 'vault.json'), 'utf8'));
	check('файл хранилища зашифрован', vf.v === 1 && !JSON.stringify(vf).includes('секрет') && !JSON.stringify(vf).includes('example.com'));

	// --- пространства
	const sp = await c.open('problet://spaces/');
	const spaces = await c.ev(sp.id, `(async () => { const id = await api.spacesAdd('Работа'); const a = await api.spaces(); await api.spacesSwitch('main'); await api.spacesRemove(id); const b = await api.spaces(); return [a.spaces.length, a.current === id, b.spaces.length, b.current]; })()`);
	check('пространства: добавить, переключить, удалить', spaces[0] === 2 && spaces[1] === true && spaces[2] === 1 && spaces[3] === 'main', spaces);

	// --- остальные внутренние страницы просто открываются без ошибок
	for (const name of ['history', 'downloads', 'version', 'chars', 'blocklist', 'newtab']) {
		const p = await c.open('problet://' + name + '/', 500);
		check('страница ' + name, p.loaded && p.url.startsWith('problet://' + name), p);
	}
	const miss = await c.open('problet://netu/', 400);
	check('неизвестная внутренняя страница — 404', /404|не найден/i.test(await c.text(miss.id)), miss.title);
	const errors = (await c.console()).filter((m) => /problet:\/\//.test(m.source || '') && String(m.level) !== 'warning' && String(m.level) !== '2');
	check('во внутренних страницах нет ошибок в консоли', errors.length === 0, errors.slice(0, 5));

	// вкладки для проверки восстановления сессии
	await c.open(base + '/');
	await sleep(1500);
	await c.quit();
	await Promise.race([exited, sleep(15000)]);
	const data = JSON.parse(fs.readFileSync(path.join(profile, 'data.json'), 'utf8'));
	check('данные записаны на диск при выходе', data.bookmarks.length === 2 && data.settings.adblock === true && data.session.tabs.length > 3, { b: data.bookmarks.length, t: data.session.tabs.length });
}

async function second(base) {
	const b = launch();
	const c = client(await b.ready);
	const exited = new Promise((r) => b.child.on('exit', r));
	await sleep(1500);
	const tabs = await c.tabs();
	check('вкладки прошлого запуска вернулись', tabs.length > 3 && tabs.some((t) => t.url === base + '/' || t.url === ''), tabs.map((t) => t.url));
	const s = await c.open('problet://settings/');
	const st = await c.ev(s.id, 'api.getSettings().then(r => [r.settings.adblock, r.settings.customButtons.length, r.settings.hotkeys["cb:smoke001"]])');
	check('настройки пережили перезапуск', st[0] === true && st[1] === 1 && st[2] === 'Ctrl+Alt+J', st);
	const pw = await c.ev(s.id, `api.pwStatus().then(r => [r.exists, r.unlocked])`);
	check('хранилище паролей после перезапуска закрыто', pw[0] === true && pw[1] === false, pw);
	await c.quit();
	await Promise.race([exited, sleep(15000)]);
}

(async () => {
	await new Promise((r) => server.listen(0, '127.0.0.1', r));
	const base = 'http://127.0.0.1:' + server.address().port;
	try {
		await first(base);
		await second(base);
	} catch (e) {
		check('проверка дошла до конца', false, String((e && e.stack) || e));
	}
	server.close();
	try {
		fs.rmSync(work, { recursive: true, force: true });
	} catch (e) { /* на Windows файлы профиля могут быть ещё заняты */ }
	console.log(failed ? 'ПРОВАЛЕНО: ' + failed : 'ВСЁ ЗЕЛЁНОЕ (' + results.length + ')' , process.platform, process.arch);
	process.exit(failed ? 1 : 0);
})();
