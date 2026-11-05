// Автообновление: смотрим релиз «latest» в GitHub, сравниваем версию из имён файлов с текущей.
// Linux (AppImage): скачиваем новый файл и подменяем им запущенный, после перезапуска работает новая версия.
// Windows: скачиваем установщик и запускаем его. macOS и остальные сборки: открываем страницу релиза (приложение не подписано, обновить себя оно не может).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { app, net, shell } = require('electron');

const REPO = 'cersat/Problet';
const API = process.env.PROBLET_UPDATE_URL || 'https://api.github.com/repos/' + REPO + '/releases/tags/latest';
const CHECK_EVERY = 6 * 60 * 60 * 1000;

const ARCH = { x64: ['x64', 'x86_64'], arm64: ['arm64', 'aarch64'] }[process.arch] || [process.arch];
const OS = { linux: 'linux', win32: 'win', darwin: 'mac' }[process.platform];

// state: idle | checking | uptodate | available | downloading | ready | error
let state = { status: 'idle', version: '', progress: 0, message: '', mode: mode() };
let listeners = [];
let asset = null;
let page = '';
let timer = null;
let busy = false;

function mode() {
	if (!app.isPackaged) return 'dev';
	if (process.platform === 'linux') return process.env.APPIMAGE ? 'appimage' : 'page';
	if (process.platform === 'win32') return 'installer';
	return 'page';
}

function set(patch) {
	state = { ...state, ...patch, mode: mode() };
	for (const cb of listeners) cb(state);
}

function onChange(cb) {
	listeners.push(cb);
}

function getState() {
	return state;
}

function parseVersion(v) {
	return String(v).split('.').map((n) => parseInt(n, 10) || 0);
}

function isNewer(a, b) {
	const x = parseVersion(a);
	const y = parseVersion(b);
	for (let i = 0; i < 3; i++) {
		if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
	}
	return false;
}

// Подходящий файл релиза для этой системы
function pickAsset(assets) {
	const want = { appimage: /\.AppImage$/i, installer: /\.exe$/i, page: process.platform === 'darwin' ? /\.dmg$/i : /\.tar\.gz$/i }[mode()];
	for (const a of assets) {
		const m = /^Problet-(\d+\.\d+\.\d+)-([a-z]+)-([\w]+)\./i.exec(a.name);
		if (!m || m[2] !== OS || !ARCH.includes(m[3])) continue;
		if (want && !want.test(a.name)) continue;
		return { name: a.name, url: a.browser_download_url, size: a.size, version: m[1] };
	}
	return null;
}

async function check() {
	if (busy) return state;
	busy = true;
	set({ status: 'checking', message: '' });
	try {
		const res = await net.fetch(API, { headers: { Accept: 'application/vnd.github+json' } });
		if (res.status === 404) throw new Error('Релиз пока не опубликован');
		if (!res.ok) throw new Error('GitHub ответил ' + res.status);
		const release = await res.json();
		page = release.html_url || 'https://github.com/' + REPO + '/releases';
		asset = pickAsset(release.assets || []);
		if (!asset) throw new Error('Для этой системы в релизе нет подходящего файла');
		if (isNewer(asset.version, app.getVersion())) set({ status: 'available', version: asset.version });
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
	const res = await net.fetch(url);
	if (!res.ok || !res.body) throw new Error('Не удалось скачать: ' + res.status);
	const total = Number(res.headers.get('content-length')) || (asset && asset.size) || 0;
	let got = 0;
	const out = fs.createWriteStream(dest);
	try {
		for await (const chunk of res.body) {
			got += chunk.length;
			if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
			if (total) set({ progress: Math.min(99, Math.round((got / total) * 100)) });
		}
		await new Promise((resolve, reject) => {
			out.on('error', reject);
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
			const file = path.join(os.tmpdir(), asset.name);
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

// Применить: перезапуск в новую версию (Linux), установщик (Windows) или страница релиза (остальные)
async function apply() {
	if (mode() === 'page' || mode() === 'dev') {
		if (page) await shell.openExternal(page);
		return;
	}
	if (state.status === 'available') await prepare();
	if (state.status !== 'ready') return;
	if (mode() === 'appimage') {
		restartAppImage();
	} else {
		await shell.openPath(state.file);
		app.quit();
	}
}

// Автопроверка: через минуту после запуска и дальше раз в несколько часов; найденное обновление качается само
function schedule(enabled, restartWhenReady) {
	if (timer) clearInterval(timer);
	if (mode() === 'dev') return;
	const run = async () => {
		if (!enabled() || busy || state.status === 'ready') return;
		await check();
		if (state.status === 'available' && (mode() === 'appimage' || mode() === 'installer')) await prepare();
		if (state.status === 'ready' && restartWhenReady && restartWhenReady()) await apply();
	};
	setTimeout(run, 60 * 1000);
	timer = setInterval(run, CHECK_EVERY);
}

module.exports = { looksLikeAppImage, restartAppImage, check, prepare, apply, getState, onChange, schedule, isNewer, pickAsset };
