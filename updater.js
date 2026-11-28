// Автообновление: смотрим релиз «latest» в GitHub, сравниваем версию из имён файлов с текущей.
// Linux (AppImage): скачиваем новый файл и подменяем им запущенный, после перезапуска работает новая версия.
// Windows: скачиваем установщик и запускаем его тихо поверх текущей версии (если программа из zip, распаковываем новый zip поверх неё). macOS: скачиваем .dmg в «Загрузки» и открываем его (приложение не подписано, заменить себя оно не может, перетащить в «Программы» нужно самому).
// Остальные сборки: открываем страницу релиза.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { app, net, shell } = require('electron');

const REPO = 'cersat/Problet';
const API = process.env.PROBLET_UPDATE_URL || 'https://api.github.com/repos/' + REPO + '/releases/tags/latest';

const ARCH = { x64: ['x64', 'x86_64'], arm64: ['arm64', 'aarch64'] }[process.arch] || [process.arch];
const OS = { linux: 'linux', win32: 'win', darwin: 'mac' }[process.platform];

let setupInstall = null; // установлен ли Problet установщиком (Windows); объявлено до state: mode() читает его сразу
// state: idle | checking | uptodate | available | downloading | ready | error
let state = { status: 'idle', version: '', progress: 0, message: '', changelog: '', mode: mode(), beta: false, channel: 'stable', stableVersion: '', betaVersion: '' };
let listeners = [];
let asset = null;
let page = '';
let timer = null;
let busy = false;
let channel = 'stable'; // stable или beta: задаётся из настроек (setChannel)
let stableSeries = [9, 4]; // серия (a.b), которая сейчас считается stable; уточняется при каждой проверке
const FIRST_STABLE = [9, 4]; // с 9.4.0 начинается деление на stable и beta

function mode() {
	if (!app.isPackaged) return 'dev';
	if (process.platform === 'linux') return process.env.APPIMAGE ? 'appimage' : 'page';
	if (process.platform === 'win32') return installedWithSetup() ? 'installer' : 'zip';
	if (process.platform === 'darwin') return 'dmg';
	return 'page';
}

function set(patch) {
	state = { ...state, ...patch, mode: mode(), beta: isBeta(), channel };
	for (const cb of listeners) cb(state);
}

function onChange(cb) {
	listeners.push(cb);
}

// Сведения о релизах берём без кеша HTTP: иначе старый ответ (raw.githubusercontent держит файл около 5 минут) скрывает свежую сборку
const fresh = (url, opts = {}) => net.fetch(url, { cache: 'no-store', ...opts });

function getState() {
	return state;
}

function parseVersion(v) {
	return String(v).split('.').map((n) => parseInt(n, 10) || 0);
}

const seriesOf = (v) => parseVersion(v).slice(0, 2);
const cmpSeries = (a, b) => (a[0] - b[0]) || (a[1] - b[1]);

// Какая серия считается stable, если самая новая — latest: серия на одну ниже, но не ниже первой stable.
// available — серии (a.b), для которых есть релиз вида s9.4. Если подходящей нет, остаётся null
function stableFor(latest, available) {
	if (cmpSeries(latest, FIRST_STABLE) <= 0) return latest;
	const below = available.filter((x) => cmpSeries(x, latest) < 0 && cmpSeries(x, FIRST_STABLE) >= 0).sort(cmpSeries);
	return below.length ? below[below.length - 1] : null;
}

// Версия сборки новее, чем stable: значит, это beta
function isBeta() {
	return cmpSeries(seriesOf(app.getVersion()), stableSeries) > 0;
}

function setChannel(c) {
	channel = c === 'beta' ? 'beta' : 'stable';
	set({});
}

function isNewer(a, b) {
	const x = parseVersion(a);
	const y = parseVersion(b);
	for (let i = 0; i < 3; i++) {
		if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
	}
	return false;
}

// Самая новая версия среди файлов релиза, для любой системы
function pickAnyVersion(assets) {
	let best = '';
	for (const a of assets) {
		const m = /^Problet-(\d+\.\d+\.\d+)-/i.exec(a.name);
		if (m && (!best || isNewer(m[1], best))) best = m[1];
	}
	return best;
}

// Подходящий файл релиза для этой системы
function pickAsset(assets) {
	const want = { appimage: /\.AppImage$/i, installer: /\.exe$/i, zip: /\.zip$/i, dmg: /\.dmg$/i, page: /\.tar\.gz$/i }[mode()];
	let best = null;
	for (const a of assets) {
		const m = /^Problet-(\d+\.\d+\.\d+)-([a-z]+)-([\w]+)\./i.exec(a.name);
		if (!m || m[2] !== OS || !ARCH.includes(m[3])) continue;
		if (want && !want.test(a.name)) continue;
		// В релизе по пути могут лежать файлы разных версий (пока собираются остальные системы): берём самый новый
		if (!best || isNewer(m[1], best.version)) best = { name: a.name, url: a.browser_download_url, size: a.size, version: m[1] };
	}
	return best;
}

// Лимит API GitHub без авторизации — 60 запросов в час на адрес, а одна проверка делает два (раньше — при частых проверках, пока идёт сборка).
// Когда API отвечает отказом, те же сведения берём со страниц сайта: список файлов релиза и ленту коммитов
const SITE = 'https://github.com/' + REPO;
const decodeHtml = (t) => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

async function releaseFromSite(tag = 'latest') {
	const res = await fresh(SITE + '/releases/expanded_assets/' + tag);
	if (!res.ok) return null;
	const html = await res.text();
	const assets = [...html.matchAll(new RegExp('href="([^"]*/releases/download/' + tag + '/([^"/]+))"', 'g'))].map((m) => ({ name: decodeURIComponent(m[2]), browser_download_url: 'https://github.com' + m[1], size: 0 }));
	return assets.length ? { html_url: SITE + '/releases/tag/' + tag, assets } : null;
}

// Серии, для которых есть релиз s<a>.<b>. API даёт список целиком, а когда он отказывает, берём их со страницы релизов
async function seriesList() {
	const found = new Set();
	try {
		const res = await fresh('https://api.github.com/repos/' + REPO + '/releases?per_page=100', { headers: { Accept: 'application/vnd.github+json' } });
		if (res.ok) {
			for (const r of await res.json()) found.add(r.tag_name);
		} else if (res.status === 403 || res.status === 429) {
			const html = await (await fresh(SITE + '/releases')).text();
			for (const m of html.matchAll(/\/releases\/tag\/(s\d+\.\d+)"/g)) found.add(m[1]);
		}
	} catch (e) { /* без списка stable не выбрать, останемся на текущей версии */ }
	return [...found].map((t) => /^s(\d+)\.(\d+)$/.exec(t)).filter(Boolean).map((m) => [Number(m[1]), Number(m[2])]);
}

async function releaseByTag(tag) {
	if (process.env.PROBLET_UPDATE_URL) return null;
	const res = await fresh('https://api.github.com/repos/' + REPO + '/releases/tags/' + tag, { headers: { Accept: 'application/vnd.github+json' } });
	if (res.ok) return res.json();
	if (res.status === 403 || res.status === 429) return releaseFromSite(tag);
	return null;
}

async function headFromSite() {
	const res = await fresh(SITE + '/commits/main.atom');
	if (!res.ok) return null;
	const m = /<entry>[\s\S]*?<title>\s*([\s\S]*?)\s*<\/title>/.exec(await res.text());
	return m ? decodeHtml(m[1]).split('\n')[0].trim().slice(0, 300) : null;
}

// Последний коммит ветки main: его название служит списком изменений, а версия в package.json показывает, что скоро выйдет
async function headInfo() {
	if (process.env.PROBLET_UPDATE_URL) return null;
	try {
		const res = await fresh('https://api.github.com/repos/' + REPO + '/commits/main', { headers: { Accept: 'application/vnd.github+json' } });
		let ref = 'main';
		let title;
		if (res.ok) {
			const data = await res.json();
			ref = data.sha;
			title = String((data.commit && data.commit.message) || '').split('\n')[0].trim().slice(0, 300);
		} else if (res.status === 403 || res.status === 429) {
			title = await headFromSite();
			if (title === null) return null;
		} else {
			return null;
		}
		const info = { title, version: '' };
		try {
			const pkg = await fresh('https://raw.githubusercontent.com/' + REPO + '/' + ref + '/package.json');
			if (pkg.ok) info.version = String((await pkg.json()).version || '');
		} catch (e) { /* без версии определим по названию релиза */ }
		return info;
	} catch (e) {
		return null;
	}
}

// Список изменений запоминаем на диске, чтобы он был виден сразу после запуска
const cacheFile = () => path.join(app.getPath('userData'), 'update-cache.json');

function loadCache() {
	try {
		const c = JSON.parse(fs.readFileSync(cacheFile(), 'utf8'));
		if (Array.isArray(c.stableSeries) && c.stableSeries.length === 2 && c.stableSeries.every(Number.isInteger)) stableSeries = c.stableSeries;
		// Кеш, записанный другой версией браузера, устарел: список изменений и версии потоков узнаем заново при проверке
		if (c.appVersion !== app.getVersion()) return set({});
		if (typeof c.stableVersion === 'string') state.stableVersion = c.stableVersion;
		if (typeof c.betaVersion === 'string') state.betaVersion = c.betaVersion;
		if (typeof c.changelog === 'string') set({ changelog: c.changelog });
		else set({});
	} catch (e) { /* кеша ещё нет */ }
}

function saveCache() {
	try {
		fs.writeFileSync(cacheFile(), JSON.stringify({ appVersion: app.getVersion(), changelog: state.changelog, stableSeries, stableVersion: state.stableVersion, betaVersion: state.betaVersion }));
	} catch (e) { /* не страшно */ }
}

async function check(force) {
	if (busy || state.status === 'ready') return state; // скачанное обновление ждёт перезапуска: новая проверка его не сбрасывает
	busy = true;
	set({ status: 'checking', message: '' });
	try {
		const res = await fresh(API, { headers: { Accept: 'application/vnd.github+json' } });
		if (res.status === 404) throw new Error('Релиз пока не опубликован');
		let release = res.ok ? await res.json() : null;
		if (!release && (res.status === 403 || res.status === 429)) release = await releaseFromSite();
		if (!release) throw new Error('GitHub ответил ' + res.status);
		const newest = pickAnyVersion(release.assets || []); // версия самой свежей сборки (latest)
		// Поток stable не обновляет до бета-версий: цель — релиз серии на одну ниже последней
		let target = release;
		if (newest && !process.env.PROBLET_UPDATE_URL) {
			const latestSeries = seriesOf(newest);
			const stable = stableFor(latestSeries, await seriesList());
			if (stable) {
				stableSeries = stable;
				saveCache();
			}
			// Последние версии потоков показываются в переключателе настроек
			let stableRelease = null;
			if (stable && cmpSeries(stable, latestSeries) < 0) stableRelease = await releaseByTag('s' + stable[0] + '.' + stable[1]);
			state.betaVersion = newest;
			state.stableVersion = stable ? (stableRelease ? pickAnyVersion(stableRelease.assets || []) || '' : cmpSeries(stable, latestSeries) === 0 ? newest : '') : '';
			saveCache();
			if (channel === 'stable' && stable && cmpSeries(stable, latestSeries) < 0) {
				target = stableRelease;
				if (!target) throw new Error('Не удалось получить stable-версию');
			} else if (channel === 'stable' && !stable) {
				target = { html_url: release.html_url, assets: [] }; // stable-серии ещё нет: обновляться некуда
			}
		}
		page = target.html_url || 'https://github.com/' + REPO + '/releases';
		asset = pickAsset(target.assets || []);
		// Название последнего коммита и версию из него показываем только в потоке beta: в stable это чужие, ещё не вышедшие изменения
		const head = channel === 'beta' ? await headInfo() : null;
		if (head) {
			set({ changelog: head.title });
			saveCache();
		}
		const ready = asset && (force || isNewer(asset.version, app.getVersion()));
		if (ready) set({ status: 'available', version: asset.version });
		else if (head && head.version && isNewer(head.version, app.getVersion())) set({ status: 'building', version: head.version }); // коммит уже есть, сборка ещё идёт
		else if (!asset && channel === 'beta') throw new Error('Для этой системы в релизе нет подходящего файла');
		else set({ status: 'uptodate', version: app.getVersion() });
	} catch (e) {
		set({ status: 'error', message: String((e && e.message) || e) });
	} finally {
		busy = false;
	}
	return state;
}

// У AppImage в начале файла ELF, а в байтах 8–10 метка «AI\x02» (тип 2)
function looksLikeAppImage(file) {
	const fd = fs.openSync(file, 'r');
	try {
		const head = Buffer.alloc(11);
		fs.readSync(fd, head, 0, 11, 0);
		return head.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) && head[8] === 0x41 && head[9] === 0x49 && head[10] === 0x02;
	} finally {
		fs.closeSync(fd);
	}
}

async function download(url, dest) {
	const res = await fresh(url);
	if (!res.ok || !res.body) throw new Error('Не удалось скачать: ' + res.status);
	const total = Number(res.headers.get('content-length')) || (asset && asset.size) || 0;
	let got = 0;
	const out = fs.createWriteStream(dest);
	// Ошибка записи (например, кончилось место) без обработчика уронила бы весь браузер
	let failure = null;
	out.on('error', (e) => { failure = e; });
	try {
		for await (const chunk of res.body) {
			if (failure) throw failure;
			got += chunk.length;
			if (!out.write(chunk)) await new Promise((r) => { out.once('drain', r); out.once('error', r); });
			if (failure) throw failure;
			if (total) set({ progress: Math.min(99, Math.round((got / total) * 100)) });
		}
		await new Promise((resolve, reject) => {
			if (failure) return reject(failure);
			out.once('error', reject);
			out.end(resolve);
		});
		if (total && got !== total) throw new Error('Файл скачался не полностью (' + got + ' из ' + total + ' байт)');
	} catch (e) {
		out.destroy();
		fs.rmSync(dest, { force: true });
		throw e;
	}
}

// Скачиваем новую версию. После этого состояние ready: осталось перезапустить
async function prepare() {
	if (state.status !== 'available' || !asset) return state;
	if (mode() === 'page' || mode() === 'dev') return state;
	busy = true;
	set({ status: 'downloading', progress: 0 });
	try {
		if (mode() === 'appimage') {
			const target = process.env.APPIMAGE;
			const tmp = target + '.new';
			await download(asset.url, tmp);
			if (!looksLikeAppImage(tmp)) {
				fs.rmSync(tmp, { force: true });
				throw new Error('Скачанный файл не похож на AppImage, обновление отменено');
			}
			fs.chmodSync(tmp, 0o755);
			fs.renameSync(tmp, target); // запущенный файл можно подменить: старый процесс продолжает работать с прежним inode
			set({ status: 'ready', progress: 100 });
		} else {
			const file = path.join(mode() === 'dmg' ? app.getPath('downloads') : os.tmpdir(), asset.name);
			await download(asset.url, file);
			state.file = file;
			set({ status: 'ready', progress: 100 });
		}
	} catch (e) {
		set({ status: 'error', message: String((e && e.message) || e) });
	} finally {
		busy = false;
	}
	return state;
}

// Запускаем новый AppImage в чистом окружении. Если отдать ему переменные текущего (LD_LIBRARY_PATH, APPDIR и т.п.),
// системный fusermount подхватывает библиотеки из старого образа и выдаёт «Cannot mount AppImage, please check your FUSE setup».
// Секунда ожидания нужна, чтобы старый процесс успел выйти и отдать блокировку единственного экземпляра.
function restartAppImage() {
	const env = { ...process.env };
	for (const k of Object.keys(env)) {
		if (/^(APPDIR|APPIMAGE|ARGV0|OWD|LD_LIBRARY_PATH|LD_PRELOAD|GIO_EXTRA_MODULES|GSETTINGS_SCHEMA_DIR|PERLLIB|PYTHONHOME|PYTHONPATH|QT_PLUGIN_PATH|CHROME_DESKTOP|CHROME_WRAPPER|ELECTRON_.*)$/.test(k)) delete env[k];
	}
	// Перезапускаемся без FUSE: образ сам распаковывается во временную папку. Так перезапуск не зависит от того, как настроен FUSE в системе
	env.APPIMAGE_EXTRACT_AND_RUN = '1';
	const child = spawn('/bin/sh', ['-c', 'sleep 1; exec "$0" "$@"', process.env.APPIMAGE, ...process.argv.slice(1)], { detached: true, stdio: 'ignore', env });
	child.unref();
	app.exit(0);
}

// Windows: программа поставлена установщиком (рядом лежит деинсталлятор), а не распакована из zip
function installedWithSetup() {
	if (setupInstall === null) {
		try {
			setupInstall = fs.readdirSync(path.dirname(process.execPath)).some((f) => /^Uninstall .*\.exe$/i.test(f));
		} catch (e) {
			setupInstall = false;
		}
	}
	return setupInstall;
}

// Программа из zip не может заменить себя сама: скрипт ждёт, пока она закроется, распаковывает архив поверх папки и запускает её снова.
// Паузы сделаны через ping: timeout в скрытом окне без консоли ввода не ждёт, а сразу завершается
function zipScript({ pid, zip, dir, exe }) {
	const bat = (t) => String(t).replace(/%/g, '%%');
	const ps = (t) => bat(t).replace(/'/g, "''");
	return [
		'@echo off',
		'chcp 65001 >nul',
		':wait',
		'tasklist /FI "PID eq ' + Number(pid) + '" 2>nul | find "' + Number(pid) + '" >nul && (ping -n 2 127.0.0.1 >nul & goto wait)',
		'set n=0',
		':extract',
		'set /a n+=1',
		'where tar >nul 2>&1 && tar -xf "' + bat(zip) + '" -C "' + bat(dir) + '" || powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -LiteralPath \'' + ps(zip) + '\' -DestinationPath \'' + ps(dir) + '\' -Force"',
		'if errorlevel 1 if %n% lss 5 (ping -n 3 127.0.0.1 >nul & goto extract)',
		'start "" "' + bat(exe) + '"',
		'del "' + bat(zip) + '" 2>nul',
		'(goto) 2>nul & del "%~f0"',
		'',
	].join('\r\n');
}

// Применить: перезапуск в новую версию (Linux), установщик (Windows) или страница релиза (остальные)
async function apply() {
	if (mode() === 'page' || mode() === 'dev') {
		if (page) await shell.openExternal(page);
		return;
	}
	if (state.status === 'available') await prepare();
	if (state.status !== 'ready') return;
	if (hooks.beforeRestart) hooks.beforeRestart();
	if (mode() === 'appimage') {
		restartAppImage();
	} else if (mode() === 'installer') {
		// Тихая установка поверх текущей: без мастера, папка и данные те же, после установки Problet запускается сам.
		// Файл скачан самим браузером, поэтому SmartScreen его не проверяет
		spawn(state.file, ['--updated', '/S', '--force-run'], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
		app.quit();
	} else if (mode() === 'zip') {
		const bat = path.join(os.tmpdir(), 'problet-update.bat');
		fs.writeFileSync(bat, zipScript({ pid: process.pid, zip: state.file, dir: path.dirname(process.execPath), exe: process.execPath }), 'utf8');
		spawn('cmd.exe', ['/c', bat], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
		app.quit();
	} else {
		await shell.openPath(state.file);
		app.quit(); // запущенное приложение нельзя заменить, поэтому выходим: в открывшемся окне перетащи Problet в «Программы»
	}
}

// Проверка при запуске (через несколько секунд) и дальше по периоду из настроек (раз в минуту смотрим, не пора ли).
// opts() -> { enabled, every: минут, restart, faster, off }
// faster: пока релиз ещё собирается (status building), проверяем каждые 2 минуты
const BUILDING_EVERY = 2;
function schedule(opts) {
	if (timer) clearInterval(timer);
	loadCache();
	let last = 0;
	const run = async (startup) => {
		if (busy || state.status === 'ready') return;
		const o = opts();
		if (o.off) return; // безопасный режим: сам не проверяет, обновиться можно только кнопкой
		if (!startup) {
			if (!o.enabled) return;
			let every = Number(o.every);
			if (state.status === 'building' && o.faster) every = Math.min(every, BUILDING_EVERY);
			if (Date.now() - last < every * 60 * 1000) return;
		}
		last = Date.now();
		await check();
		if (!opts().enabled) return;
		if (state.status === 'available' && (mode() === 'appimage' || mode() === 'installer' || mode() === 'zip' || mode() === 'dmg')) await prepare();
		if (state.status === 'ready' && mode() !== 'dmg' && opts().restart) await apply(); // на macOS установщик сам не открываем: нужно перетащить приложение вручную
	};
	setTimeout(() => run(true), 4000);
	if (mode() !== 'dev') timer = setInterval(run, 60 * 1000);
}

const hooks = {}; // beforeRestart: главный процесс сохраняет окно и сессию перед перезапуском в новую версию

module.exports = { hooks, setChannel, stableFor, isBeta, seriesOf, looksLikeAppImage, restartAppImage, check, prepare, apply, getState, onChange, schedule, isNewer, pickAsset };
