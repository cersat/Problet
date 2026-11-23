// Хранение родительского контроля так, чтобы его нельзя было тихо удалить или поправить руками.
// - Основной файл и две копии в разных местах (на Windows вторая копия — в реестре). Копии хранят настройки без статистики.
// - Всё подписано HMAC: правка вручную ломает подпись.
// - По желанию — запись в системную папку, куда без прав администратора не записать (/etc, ProgramData, /Library).
// Если включённый контроль где-то не сходится (файла нет, подпись не та, копии разных версий), браузер запирается до ввода пароля
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, execFile } = require('child_process');

const KEY = crypto.createHash('sha256').update('problet-parental-v1|' + os.hostname()).digest();
const sign = (obj) => crypto.createHmac('sha256', KEY).update(JSON.stringify(obj)).digest('hex');
const userName = () => String(os.userInfo().username || 'user').replace(/[^\w.-]/g, '_');

function pack(obj) {
	return JSON.stringify({ d: obj, s: sign(obj) });
}
// null — нет; 'bad' — есть, но испорчено; иначе — содержимое
function unpack(text) {
	if (text === null || text === undefined) return null;
	try {
		const raw = JSON.parse(text);
		if (!raw || typeof raw.d !== 'object' || typeof raw.s !== 'string') return 'bad';
		const a = Buffer.from(sign(raw.d), 'hex');
		const b = Buffer.from(raw.s, 'hex');
		return a.length === b.length && crypto.timingSafeEqual(a, b) ? raw.d : 'bad';
	} catch (e) {
		return 'bad';
	}
}

const readFile = (f) => {
	try {
		return fs.readFileSync(f, 'utf8');
	} catch (e) {
		return null;
	}
};
function writeFile(f, text) {
	fs.mkdirSync(path.dirname(f), { recursive: true });
	fs.writeFileSync(f + '.tmp', text, 'utf8');
	fs.renameSync(f + '.tmp', f);
}

// ---------- Места ----------
let mainFile = '';
function copyPlaces() {
	const home = os.homedir();
	if (process.platform === 'win32') {
		const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
		return [fileCopy(path.join(local, 'Problet', 'pc.dat')), regCopy()];
	}
	if (process.platform === 'darwin') {
		return [fileCopy(path.join(home, 'Library', 'Preferences', 'com.cersat.problet.pc')), fileCopy(path.join(home, 'Library', 'Application Support', '.problet-pc'))];
	}
	const state = process.env.XDG_STATE_HOME || path.join(home, '.local', 'state');
	const share = process.env.XDG_DATA_HOME || path.join(home, '.local', 'share');
	return [fileCopy(path.join(state, 'problet', 'pc.dat')), fileCopy(path.join(share, 'problet', '.pc'))];
}
const fileCopy = (f) => ({ read: () => readFile(f), write: (t) => writeFile(f, t), name: f });
// Реестр Windows: HKCU\Software\Problet, значение pc (текст в base64, чтобы не мучиться с кавычками)
function regCopy() {
	const keyPath = 'HKCU\\Software\\Problet';
	return {
		name: keyPath,
		read: () => {
			try {
				const out = execFileSync('reg', ['query', keyPath, '/v', 'pc'], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
				const m = /pc\s+REG_SZ\s+(\S+)/.exec(out);
				return m ? Buffer.from(m[1], 'base64').toString('utf8') : null;
			} catch (e) {
				return null;
			}
		},
		write: (t) => {
			execFileSync('reg', ['add', keyPath, '/v', 'pc', '/t', 'REG_SZ', '/d', Buffer.from(t, 'utf8').toString('base64'), '/f'], { windowsHide: true, stdio: 'ignore' });
		},
	};
}

// Системная папка: читать может любой, писать — только администратор
function adminFile() {
	const n = userName() + '.json';
	if (process.platform === 'win32') return path.join(process.env.ProgramData || 'C:\\ProgramData', 'Problet', n);
	if (process.platform === 'darwin') return path.join('/Library', 'Application Support', 'Problet', n);
	return path.join('/etc', 'problet', n);
}

function init(appData, name) {
	mainFile = path.join(appData, name, 'parental.json');
}

// Прочитать всё: основной файл, копии, системную запись
function readAll() {
	const main = unpack(readFile(mainFile));
	const copies = copyPlaces().map((p) => unpack(p.read()));
	const admin = unpack(readFile(adminFile()));
	return { main, copies, admin };
}

function saveMain(full) {
	writeFile(mainFile, pack(full));
}
function saveCopies(record) {
	const text = pack(record);
	for (const p of copyPlaces()) {
		try {
			p.write(text);
		} catch (e) {
			console.error('Родительский контроль: не удалось записать копию', p.name, e.message);
		}
	}
}

// ---------- Права администратора ----------
function run(cmd, args) {
	return new Promise((resolve, reject) => {
		execFile(cmd, args, { windowsHide: true }, (err, stdout, stderr) => {
			if (!err) return resolve();
			if (err.code === 'ENOENT') return reject(new Error('Нет программы для запроса прав администратора: ' + cmd));
			reject(new Error('Права администратора не получены'));
		});
	});
}
const ps = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const bat = (s) => '"' + String(s).replace(/"/g, '') + '"';
const sh = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";

// Записать (text) или удалить (text === null) системную запись, спросив права администратора
async function writeAdmin(text) {
	const dest = adminFile();
	const dir = path.dirname(dest);
	const tmp = path.join(os.tmpdir(), 'problet-pc-' + process.pid + '-' + Date.now());
	if (text !== null) fs.writeFileSync(tmp, text, { mode: 0o644 });
	try {
		if (process.platform === 'win32') {
			// Папка: администраторы и система — всё, пользователи — только чтение (SID, чтобы не зависеть от языка системы)
			const script = tmp + '.cmd';
			const lines = text !== null
				? ['@echo off', 'mkdir ' + bat(dir) + ' 2>nul', 'copy /y ' + bat(tmp) + ' ' + bat(dest) + ' >nul || exit /b 1',
					'icacls ' + bat(dir) + ' /inheritance:r /grant:r *S-1-5-32-544:(OI)(CI)F *S-1-5-18:(OI)(CI)F *S-1-5-32-545:(OI)(CI)RX >nul || exit /b 1']
				: ['@echo off', 'del /f /q ' + bat(dest) + ' 2>nul', 'if exist ' + bat(dest) + ' exit /b 1'];
			fs.writeFileSync(script, lines.join('\r\n') + '\r\n');
			try {
				await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
					'$p = Start-Process -FilePath ' + ps(script) + ' -Verb RunAs -WindowStyle Hidden -Wait -PassThru; exit $p.ExitCode']);
			} finally {
				fs.rmSync(script, { force: true });
			}
		} else if (process.platform === 'darwin') {
			const cmd = text !== null
				? 'mkdir -p ' + sh(dir) + ' && cp ' + sh(tmp) + ' ' + sh(dest) + ' && chown root:wheel ' + sh(dest) + ' && chmod 644 ' + sh(dest)
				: 'rm -f ' + sh(dest);
			await run('osascript', ['-e', 'do shell script ' + JSON.stringify(cmd) + ' with administrator privileges']);
		} else {
			const cmd = text !== null
				? 'mkdir -p "$1" && install -m 644 -o root -g root "$2" "$3"'
				: 'rm -f "$3"';
			await run('pkexec', ['/bin/sh', '-c', cmd, 'sh', dir, tmp, dest]);
		}
	} finally {
		fs.rmSync(tmp, { force: true });
	}
	// Проверяем, что получилось на самом деле
	const now = readFile(dest);
	if (text !== null ? now !== text : now !== null) throw new Error('Не удалось получить права администратора');
}

module.exports = { init, readAll, saveMain, saveCopies, writeAdmin, pack, unpack, adminFile };
