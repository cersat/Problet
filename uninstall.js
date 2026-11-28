// Удаление Problet с компьютера. Что именно удаляется, зависит от того, как программа установлена:
// Windows с установщиком — запускается его деинсталлятор; Windows из zip (портативная) — папка программы стирается скриптом после выхода;
// Linux AppImage — стирается сам файл и ярлык меню; macOS — приложение уходит в корзину. Остальное (пакеты системы) удаляется их менеджером.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { app, shell } = require('electron');

// Что можно сделать в этой установке: { kind, target } или null, если программа не из тех, что умеем удалять сами
function plan() {
	if (!app.isPackaged) return null;
	if (process.platform === 'linux') {
		const f = process.env.APPIMAGE;
		return f && /\.AppImage$/i.test(f) && fs.existsSync(f) ? { kind: 'appimage', target: f } : null;
	}
	if (process.platform === 'win32') {
		const dir = path.dirname(process.execPath);
		let un = null;
		try {
			un = fs.readdirSync(dir).find((f) => /^Uninstall .*\.exe$/i.test(f));
		} catch (e) { /* папку не прочитать */ }
		if (un) return { kind: 'setup', target: path.join(dir, un) };
		// Портативная: из установщика (метка portable.txt) или распакованный zip в папке с «problet» в названии; чужие папки (Program Files целиком, корень диска) не трогаем
		return require('./portable').appDir(process.execPath) || /problet/i.test(path.basename(dir)) ? { kind: 'portable', target: dir } : null;
	}
	if (process.platform === 'darwin') {
		const m = /^(.*\.app)\//.exec(process.execPath);
		return m ? { kind: 'mac', target: m[1] } : null;
	}
	return null;
}

function dataDirs() {
	const dirs = [app.getPath('userData')];
	if (process.platform === 'linux') {
		dirs.push(path.join(os.homedir(), '.local', 'share', 'problet'));
	}
	return dirs;
}

// Удаляет программу и по желанию данные. Возвращает после того, как всё запущено или сделано; браузер потом закрывается
async function run(withData) {
	const p = plan();
	if (!p) throw new Error('Эту установку Problet нельзя удалить из самой программы. Удали её так же, как ставил (менеджер пакетов или папка с программой)');
	if (p.kind === 'appimage') {
		fs.rmSync(p.target, { force: true });
		const home = os.homedir();
		for (const f of [path.join(home, '.local', 'share', 'applications', 'problet.desktop'), path.join(home, '.local', 'share', 'icons', 'problet.png')]) fs.rmSync(f, { force: true });
		if (withData) for (const d of dataDirs()) fs.rmSync(d, { recursive: true, force: true });
		return;
	}
	if (p.kind === 'mac') {
		await shell.trashItem(p.target);
		if (withData) for (const d of dataDirs()) await shell.trashItem(d).catch(() => {});
		return;
	}
	if (p.kind === 'setup') {
		// Деинсталлятор NSIS сам закрывает программу и спрашивает про данные; данные стираем после него отдельно
		if (withData) writeCleanup(dataDirs(), process.pid, null);
		spawn(p.target, [], { detached: true, stdio: 'ignore' }).unref();
		return;
	}
	// Портативная: после выхода стираем папку программы (запущенные файлы стереть нельзя, поэтому скриптом)
	// Данные портативной установки лежат внутри её папки: без галочки про данные стираем всё, кроме папки data
	const inside = !withData && fs.existsSync(path.join(p.target, 'data')) && require('./portable').appDir(process.execPath);
	const items = inside ? fs.readdirSync(p.target).filter((n) => n !== 'data').map((n) => path.join(p.target, n)) : [p.target];
	writeCleanup([...items, ...(withData ? dataDirs() : [])], process.pid, p.target);
}

// Скрипт Windows: ждёт выхода Problet и удаляет папки, потом себя
function writeCleanup(dirs, pid, _program) {
	const bat = path.join(os.tmpdir(), 'problet-uninstall.bat');
	const q = (t) => '"' + String(t).replace(/%/g, '%%') + '"';
	const lines = [
		'@echo off',
		':wait',
		'tasklist /FI "PID eq ' + Number(pid) + '" 2>nul | find "' + Number(pid) + '" >nul && (ping -n 2 127.0.0.1 >nul & goto wait)',
		...dirs.map((d) => 'rmdir /s /q ' + q(d) + ' 2>nul & del /f /q ' + q(d) + ' 2>nul'),
		'(goto) 2>nul & del "%~f0"',
		'',
	];
	fs.writeFileSync(bat, lines.join('\r\n'), 'utf8');
	spawn('cmd.exe', ['/c', bat], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}

module.exports = { plan, run };
