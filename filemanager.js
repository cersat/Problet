// Проводник Problet (страница problet://files): список папки, боковая панель, операции с файлами
// и назначение Problet стандартным проводником системы
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { pathToFileURL } = require('url');
const { app, shell, clipboard, nativeImage } = require('electron');

const DRIVES = '::drives'; // Windows: список дисков над корнями
const LIMIT = 5000;
let dataDir = '';
let log = () => {};
let clip = { mode: '', paths: [] }; // «буфер» проводника: copy или cut и полные пути

function init(userData, logFn) {
	dataDir = userData;
	if (logFn) log = logFn;
}

const run = (cmd, args) => new Promise((resolve) => execFile(cmd, args, { timeout: 8000, windowsHide: true }, (err, out) => resolve(err ? null : String(out).trim())));

// ---------- Список папки ----------

function driveList() {
	const out = [];
	for (let c = 67; c <= 90; c++) { // C…Z: дисководы A и B не опрашиваем, они могут надолго задуматься
		const root = String.fromCharCode(c) + ':\\';
		try {
			if (fs.existsSync(root)) out.push(entryOf(root, root.slice(0, 2)));
		} catch (e) { /* диск не отвечает */ }
	}
	return out;
}

function entryOf(full, name) {
	let st;
	try {
		st = fs.statSync(full);
	} catch (e) {
		try {
			st = fs.lstatSync(full); // битая ссылка
		} catch (e2) {
			return null;
		}
	}
	const n = name || path.basename(full);
	return { name: n, dir: st.isDirectory(), size: st.isDirectory() ? 0 : st.size, mtime: st.mtimeMs, hidden: n.startsWith('.') || (process.platform === 'win32' && /^(desktop\.ini|thumbs\.db|\$recycle\.bin|system volume information)$/i.test(n)), path: full, url: pathToFileURL(full).href };
}

function list(dir) {
	const onWin = process.platform === 'win32';
	if (onWin && dir === DRIVES) return { path: 'Этот компьютер', virtual: true, parent: '', root: '', home: os.homedir(), truncated: false, entries: driveList() };
	dir = path.resolve(String(dir || os.homedir()));
	const up = path.dirname(dir);
	const parent = up === dir ? (onWin ? DRIVES : '') : up;
	const root = onWin ? DRIVES : '';
	let names;
	try {
		names = fs.readdirSync(dir);
	} catch (e) {
		return { path: dir, parent, root, home: os.homedir(), truncated: false, entries: [], error: e.code === 'EACCES' || e.code === 'EPERM' ? 'Нет доступа к папке' : e.code === 'ENOENT' ? 'Такой папки нет' : e.code === 'ENOTDIR' ? 'Это файл, а не папка' : 'Не удалось открыть папку: ' + e.message };
	}
	const entries = [];
	for (const name of names.slice(0, LIMIT)) {
		const e = entryOf(path.join(dir, name), name);
		if (e) entries.push(e);
	}
	return { path: dir, parent, root, home: os.homedir(), truncated: names.length > LIMIT, entries, writable: canWrite(dir) };
}

function canWrite(dir) {
	try {
		fs.accessSync(dir, fs.constants.W_OK);
		return true;
	} catch (e) {
		return false;
	}
}

// ---------- Боковая панель: стандартные папки, диски, закреплённые ----------

const PLACES = [['home', 'Домашняя папка', 'home'], ['desktop', 'Рабочий стол', 'grid'], ['documents', 'Документы', 'document'], ['downloads', 'Загрузки', 'downloads'], ['pictures', 'Изображения', 'image'], ['music', 'Музыка', 'music'], ['videos', 'Видео', 'video']];

function places() {
	const out = [];
	for (const [key, name, icon] of PLACES) {
		let p = '';
		try {
			p = app.getPath(key);
		} catch (e) { /* такой папки у системы нет */ }
		if (p && (key === 'home' || p !== os.homedir()) && isDir(p)) out.push({ name, path: p, icon });
	}
	const drives = [];
	if (process.platform === 'win32') {
		for (const d of driveList()) drives.push({ name: d.name, path: d.path, icon: 'drive' });
	} else {
		drives.push({ name: process.platform === 'darwin' ? 'Macintosh HD' : 'Корень (/)', path: '/', icon: 'drive' });
		const user = os.userInfo().username;
		const mounts = process.platform === 'darwin' ? ['/Volumes'] : ['/media/' + user, '/run/media/' + user, '/mnt'];
		for (const m of mounts) {
			let names = [];
			try {
				names = fs.readdirSync(m);
			} catch (e) { continue; }
			for (const n of names) {
				const p = path.join(m, n);
				if (isDir(p) && !(process.platform === 'darwin' && n === 'Macintosh HD')) drives.push({ name: n, path: p, icon: 'drive' });
			}
		}
	}
	return { places: out, drives, pins: pins().filter((p) => isDir(p.path)), trash: process.platform !== 'darwin' };
}

const isDir = (p) => {
	try {
		return fs.statSync(p).isDirectory();
	} catch (e) {
		return false;
	}
};

const pinsFile = () => path.join(dataDir, 'files-pins.json');
function pins() {
	try {
		const raw = JSON.parse(fs.readFileSync(pinsFile(), 'utf8'));
		return Array.isArray(raw) ? raw.filter((p) => p && typeof p.path === 'string').slice(0, 50) : [];
	} catch (e) {
		return [];
	}
}
function setPin(dir, on) {
	dir = path.resolve(String(dir));
	const list = pins().filter((p) => p.path !== dir);
	if (on) list.push({ name: path.basename(dir) || dir, path: dir });
	fs.writeFileSync(pinsFile(), JSON.stringify(list));
	return places();
}

// ---------- Операции ----------

const BAD_NAME = /[\\/]|^\.\.?$|[\u0000-\u001f]/; // eslint-disable-line no-control-regex
function cleanName(name) {
	name = String(name || '').trim();
	if (!name || name.length > 255 || BAD_NAME.test(name) || (process.platform === 'win32' && /[<>:"|?*]|[. ]$/.test(name))) throw new Error('Недопустимое имя');
	return name;
}

// Свободное имя в папке: «файл.txt», «файл (2).txt», «файл (3).txt»…
function freeName(dir, name) {
	if (!fs.existsSync(path.join(dir, name))) return name;
	const dot = name.lastIndexOf('.');
	const base = dot > 0 ? name.slice(0, dot) : name;
	const ext = dot > 0 ? name.slice(dot) : '';
	for (let i = 2; i < 10000; i++) {
		const n = base + ' (' + i + ')' + ext;
		if (!fs.existsSync(path.join(dir, n))) return n;
	}
	throw new Error('Не удалось подобрать имя');
}

const inside = (child, parent) => {
	const rel = path.relative(parent, child);
	return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

function move(src, dir) {
	const dest = path.join(dir, freeName(dir, path.basename(src)));
	if (inside(dir, src)) throw new Error('Нельзя переместить папку в саму себя');
	try {
		fs.renameSync(src, dest);
	} catch (e) {
		if (e.code !== 'EXDEV') throw e;
		fs.cpSync(src, dest, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true }); // другой диск: копия и удаление
		fs.rmSync(src, { recursive: true, force: true });
	}
	return dest;
}

function copy(src, dir) {
	if (inside(dir, src)) throw new Error('Нельзя скопировать папку в саму себя');
	const dest = path.join(dir, freeName(dir, path.basename(src)));
	fs.cpSync(src, dest, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true });
	return dest;
}

function errText(e) {
	if (!e) return 'Ошибка';
	if (e.code === 'EACCES' || e.code === 'EPERM') return 'Нет доступа';
	if (e.code === 'ENOENT') return 'Файл не найден';
	if (e.code === 'ENOSPC') return 'На диске нет места';
	if (e.code === 'EBUSY') return 'Файл занят другой программой';
	return e.message || String(e);
}

// Одна операция над файлами; возвращает { ok, done, errors, select }
async function op(kind, args) {
	const a = args || {};
	const paths = Array.isArray(a.paths) ? a.paths.map((p) => path.resolve(String(p))) : [];
	const dir = a.dir ? path.resolve(String(a.dir)) : '';
	const errors = [];
	const select = [];
	switch (kind) {
		case 'mkdir':
		case 'newfile': {
			const name = freeName(dir, cleanName(a.name || (kind === 'mkdir' ? 'Новая папка' : 'Новый файл.txt')));
			const p = path.join(dir, name);
			if (kind === 'mkdir') fs.mkdirSync(p);
			else fs.writeFileSync(p, '', { flag: 'wx' });
			return { ok: true, select: [p] };
		}
		case 'rename': {
			const src = paths[0];
			const name = cleanName(a.name);
			const dest = path.join(path.dirname(src), name);
			if (dest === src) return { ok: true, select: [src] };
			if (fs.existsSync(dest) && dest.toLowerCase() !== src.toLowerCase()) throw new Error('Файл с таким именем уже есть');
			fs.renameSync(src, dest);
			return { ok: true, select: [dest] };
		}
		case 'trash':
			for (const p of paths) {
				try {
					await shell.trashItem(p);
				} catch (e) {
					errors.push(path.basename(p) + ': ' + errText(e));
				}
			}
			break;
		case 'delete':
			for (const p of paths) {
				try {
					fs.rmSync(p, { recursive: true, force: false });
				} catch (e) {
					errors.push(path.basename(p) + ': ' + errText(e));
				}
			}
			break;
		case 'copy':
		case 'move':
			for (const p of paths) {
				try {
					if (kind === 'move' && path.dirname(p) === dir) continue; // уже здесь
					select.push(kind === 'move' ? move(p, dir) : copy(p, dir));
				} catch (e) {
					errors.push(path.basename(p) + ': ' + errText(e));
				}
			}
			break;
		case 'paste': {
			if (!clip.paths.length) throw new Error('Буфер пуст');
			const r = await op(clip.mode === 'cut' ? 'move' : 'copy', { paths: clip.paths, dir });
			if (clip.mode === 'cut') clip = { mode: '', paths: [] };
			return r;
		}
		case 'open-system':
			for (const p of paths) {
				const err = await shell.openPath(p);
				if (err) errors.push(path.basename(p) + ': ' + err);
			}
			break;
		case 'copy-path':
			clipboard.writeText(paths.join('\n'));
			break;
		case 'terminal':
			openTerminal(dir || paths[0]);
			break;
		default:
			throw new Error('Неизвестная операция');
	}
	if (errors.length) log('проводник', kind, errors.join('; '));
	return { ok: !errors.length, errors, select };
}

// Превью картинки для плиток: маленькие файлы как есть, большие png/jpg уменьшаются
const THUMB_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', ico: 'image/x-icon', svg: 'image/svg+xml', avif: 'image/avif' };
function thumb(p) {
	p = path.resolve(String(p));
	const ext = path.extname(p).slice(1).toLowerCase();
	const mime = THUMB_MIME[ext];
	if (!mime) return '';
	let size;
	try {
		size = fs.statSync(p).size;
	} catch (e) {
		return '';
	}
	if (size <= 2 * 1024 * 1024) return 'data:' + mime + ';base64,' + fs.readFileSync(p).toString('base64');
	if ((ext === 'png' || ext === 'jpg' || ext === 'jpeg') && size <= 60 * 1024 * 1024) {
		const img = nativeImage.createFromPath(p);
		if (img.isEmpty()) return '';
		const { width, height } = img.getSize();
		const k = 192 / Math.max(width, height, 1);
		return (k < 1 ? img.resize({ width: Math.round(width * k), height: Math.round(height * k), quality: 'good' }) : img).toDataURL();
	}
	return '';
}

function setClip(mode, paths) {
	clip = mode === 'copy' || mode === 'cut' ? { mode, paths: (Array.isArray(paths) ? paths : []).map((p) => path.resolve(String(p))).slice(0, LIMIT) } : { mode: '', paths: [] };
	return getClip();
}
const getClip = () => ({ mode: clip.mode, count: clip.paths.length, paths: clip.paths });

// Терминал в папке: первый, что найдётся в системе
function openTerminal(dir) {
	const opts = { cwd: dir, detached: true, stdio: 'ignore' };
	const { spawn } = require('child_process');
	if (process.platform === 'win32') {
		spawn('cmd.exe', ['/c', 'start', 'cmd.exe'], { ...opts, windowsHide: false }).unref();
		return;
	}
	if (process.platform === 'darwin') {
		spawn('open', ['-a', 'Terminal', dir], opts).unref();
		return;
	}
	const list = [process.env.TERMINAL, 'x-terminal-emulator', 'gnome-terminal', 'konsole', 'xfce4-terminal', 'mate-terminal', 'tilix', 'alacritty', 'kitty', 'ghostty', 'xterm'].filter(Boolean);
	for (const t of list) {
		const found = (process.env.PATH || '').split(':').some((d) => d && fs.existsSync(path.join(d, t)));
		if (!found) continue;
		spawn(t, [], opts).unref();
		return;
	}
	throw new Error('Терминал не найден');
}

// ---------- Стандартный проводник ----------

const stateFile = () => path.join(dataDir, 'files-default.json');
const readState = () => {
	try {
		return JSON.parse(fs.readFileSync(stateFile(), 'utf8')) || {};
	} catch (e) {
		return {};
	}
};
const writeState = (s) => fs.writeFileSync(stateFile(), JSON.stringify(s));

// Ярлык Linux для папок: запускает тот же AppImage (через скрипт-посредник) или сам исполняемый файл
function linuxDesktopFile(launcher, iconSource) {
	const apps = path.join(os.homedir(), '.local', 'share', 'applications');
	fs.mkdirSync(apps, { recursive: true });
	const icons = path.join(os.homedir(), '.local', 'share', 'icons');
	const icon = path.join(icons, 'problet.png');
	try {
		if (!fs.existsSync(icon) && iconSource) {
			fs.mkdirSync(icons, { recursive: true });
			fs.copyFileSync(iconSource, icon);
		}
	} catch (e) { /* без значка */ }
	const file = path.join(apps, 'problet-files.desktop');
	const exec = '"' + launcher.replace(/(["`$\\])/g, '\\$1') + '"';
	fs.writeFileSync(file, [
		'[Desktop Entry]', 'Type=Application', 'Name=Problet: проводник', 'Name[en]=Problet Files', 'Comment=Проводник браузера Problet',
		'Exec=' + exec + ' %U', 'Icon=' + icon, 'Terminal=false', 'NoDisplay=true',
		'Categories=System;FileManager;', 'MimeType=inode/directory;', 'StartupWMClass=Problet', '',
	].join('\n'));
	fs.chmodSync(file, 0o755);
	return { apps, file };
}

async function isDefault() {
	if (process.platform === 'linux') return (await run('xdg-mime', ['query', 'default', 'inode/directory'])) === 'problet-files.desktop';
	if (process.platform === 'win32') {
		const out = await run('reg', ['query', 'HKCU\\Software\\Classes\\Directory\\shell', '/ve']);
		return !!out && /problet/i.test(out);
	}
	return false;
}

// launcher: команда, которой система откроет папку (AppImage — скрипт-посредник, иначе путь к программе)
async function setDefault(launcher, iconSource) {
	if (!app.isPackaged) return { ok: false, message: 'Работает только в установленной версии Problet' };
	if (process.platform === 'darwin') return { ok: false, message: 'В macOS Finder нельзя заменить другим проводником. Папки можно открывать в Problet через адресную строку или команду problet' };
	if (process.platform === 'linux') {
		const prev = await run('xdg-mime', ['query', 'default', 'inode/directory']);
		const st = readState();
		if (prev && prev !== 'problet-files.desktop') st.linuxPrev = prev;
		writeState(st);
		const { apps } = linuxDesktopFile(launcher, iconSource);
		await run('update-desktop-database', [apps]);
		await run('xdg-mime', ['default', 'problet-files.desktop', 'inode/directory']);
	} else if (process.platform === 'win32') {
		// Пункт «Открыть в Problet» у папок и дисков и он же — действие по умолчанию (двойной щелчок)
		const cmd = '"' + process.execPath + '" "%1"';
		for (const cls of ['Directory', 'Drive']) {
			const base = 'HKCU\\Software\\Classes\\' + cls + '\\shell';
			await run('reg', ['add', base + '\\problet', '/ve', '/d', 'Открыть в Problet', '/f']);
			await run('reg', ['add', base + '\\problet', '/v', 'Icon', '/d', process.execPath, '/f']);
			await run('reg', ['add', base + '\\problet\\command', '/ve', '/d', cmd, '/f']);
			await run('reg', ['add', base, '/ve', '/d', 'problet', '/f']);
		}
	}
	const ok = await isDefault();
	log('стандартный проводник', ok ? 'назначен' : 'не удалось');
	return { ok, message: ok ? 'Problet теперь открывает папки' : 'Система не применила изменение' };
}

async function restoreDefault() {
	if (process.platform === 'linux') {
		const st = readState();
		const prev = st.linuxPrev || '';
		if (prev) await run('xdg-mime', ['default', prev, 'inode/directory']);
		try {
			fs.rmSync(path.join(os.homedir(), '.local', 'share', 'applications', 'problet-files.desktop'), { force: true });
		} catch (e) { /* ярлыка нет */ }
		await run('update-desktop-database', [path.join(os.homedir(), '.local', 'share', 'applications')]);
		delete st.linuxPrev;
		writeState(st);
	} else if (process.platform === 'win32') {
		for (const cls of ['Directory', 'Drive']) {
			const base = 'HKCU\\Software\\Classes\\' + cls + '\\shell';
			await run('reg', ['delete', base + '\\problet', '/f']);
			await run('reg', ['delete', base, '/ve', '/f']);
		}
	} else {
		return { ok: false, message: 'В macOS проводник не менялся' };
	}
	const ok = !(await isDefault());
	return { ok, message: ok ? 'Папки снова открывает системный проводник' : 'Не удалось вернуть системный проводник' };
}

module.exports = { DRIVES, init, thumb, list, places, setPin, op, setClip, getClip, isDefault, setDefault, restoreDefault, freeName, cleanName };
