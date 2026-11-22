const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// AppImage монтирует себя через FUSE 2. Если библиотеки нет (в новых Ubuntu и Mint её по умолчанию нет), образ не запустится: «Cannot mount AppImage»
function hasFuse() {
	if (!fs.existsSync('/dev/fuse')) return false;
	for (const bin of ['ldconfig', '/sbin/ldconfig', '/usr/sbin/ldconfig']) {
		try {
			return /libfuse\.so\.2/.test(execFileSync(bin, ['-p'], { encoding: 'utf8', timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'] }));
		} catch (e) { /* пробуем следующий путь */ }
	}
	return false;
}

// Где работающий Problet принимает ссылки из системы: файл с его номером процесса и папка, в которую кладут адреса
function inboxPaths(userData) {
	return { pidFile: path.join(userData, 'running.pid'), inbox: path.join(userData, 'inbox') };
}

const sq = (t) => "'" + String(t).replace(/'/g, "'\\''") + "'";

// Ярлык запускает этот скрипт, а не AppImage: если Problet уже запущен, адрес просто передаётся ему (образ при этом не трогается),
// если нет — запускается образ, при необходимости без FUSE
function launcherScript(appImage, userData) {
	const { pidFile, inbox } = inboxPaths(userData);
	return [
		'#!/bin/sh',
		'# Создан Problet: передаёт ссылку запущенному браузеру или запускает его',
		'pid=$(cat ' + sq(pidFile) + ' 2>/dev/null)',
		'if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && tr \'\\0\' \' \' < "/proc/$pid/cmdline" 2>/dev/null | grep -qi problet; then',
		'	f=' + sq(inbox) + '/$(date +%s%N)-$$',
		'	printf \'%s\\n\' "$1" > "$f.tmp" && mv "$f.tmp" "$f" && exit 0',
		'fi',
		(hasFuse() ? '' : 'APPIMAGE_EXTRACT_AND_RUN=1 ; export APPIMAGE_EXTRACT_AND_RUN\n') + 'exec ' + sq(appImage) + ' "$@"',
		'',
	].join('\n');
}

// Ярлык для AppImage: в меню приложений он сам не появляется, а без ярлыка система не может назначить браузер по умолчанию
function writeLauncher(appImage, iconSource, home, userData) {
	const apps = path.join(home, '.local', 'share', 'applications');
	const icons = path.join(home, '.local', 'share', 'icons');
	const bin = path.join(home, '.local', 'share', 'problet');
	fs.mkdirSync(apps, { recursive: true });
	fs.mkdirSync(icons, { recursive: true });
	fs.mkdirSync(bin, { recursive: true });
	const icon = path.join(icons, 'problet.png');
	fs.copyFileSync(iconSource, icon);
	const script = path.join(bin, 'open.sh');
	fs.writeFileSync(script, launcherScript(appImage, userData));
	fs.chmodSync(script, 0o755);
	const exec = '"' + script.replace(/(["`$\\])/g, '\\$1') + '"';
	const file = path.join(apps, 'problet.desktop');
	fs.writeFileSync(file, [
		'[Desktop Entry]', 'Type=Application', 'Name=Problet', 'GenericName=Веб-браузер', 'Comment=Браузер Problet',
		'Exec=' + exec + ' %U', 'Icon=' + icon, 'Terminal=false', 'Categories=Network;WebBrowser;',
		'MimeType=text/html;application/xhtml+xml;x-scheme-handler/http;x-scheme-handler/https;', 'StartupWMClass=Problet', '',
	].join('\n'));
	fs.chmodSync(file, 0o755);
	return { apps, file };
}

// Работающий Problet: записывает свой номер процесса и забирает адреса, которые кладёт в папку ярлык
function startInbox(userData, onUrl) {
	const { pidFile, inbox } = inboxPaths(userData);
	fs.mkdirSync(inbox, { recursive: true });
	for (const f of fs.readdirSync(inbox)) fs.rmSync(path.join(inbox, f), { force: true });
	fs.writeFileSync(pidFile, String(process.pid));
	const drain = () => {
		let files;
		try { files = fs.readdirSync(inbox).filter((f) => !f.endsWith('.tmp')).sort(); } catch (e) { return; }
		for (const f of files) {
			const p = path.join(inbox, f);
			let text;
			try { text = fs.readFileSync(p, 'utf8'); fs.rmSync(p, { force: true }); } catch (e) { continue; }
			onUrl(text.trim());
		}
	};
	try { fs.watch(inbox, drain); } catch (e) { /* без наблюдения ссылки не придут, но браузер работает */ }
	process.on('exit', () => {
		try { if (fs.readFileSync(pidFile, 'utf8') === String(process.pid)) fs.rmSync(pidFile, { force: true }); } catch (e) { /* уже убран */ }
	});
	drain();
}

// Команда problet в терминале: запускает этот же Problet и передаёт ей все аргументы без изменений, как прямой вызов программы,
// и ждёт, пока браузер закроется. problet --detach — запустить в фоне и сразу вернуться, ничего не печатая (это делает boot.js).
// Linux: скрипт ~/.local/bin/problet; Windows: problet.cmd в папке, которая добавляется в PATH пользователя
function installCommand(exePath, home, platform = process.platform, env = process.env) {
	if (platform === 'linux') {
		const dir = path.join(home, '.local', 'bin');
		const file = path.join(dir, 'problet');
		const text = [
			'#!/bin/sh',
			'# Создан Problet: запускает браузер со всеми переданными аргументами',
			(hasFuse() || !env.APPIMAGE ? '' : 'APPIMAGE_EXTRACT_AND_RUN=1 ; export APPIMAGE_EXTRACT_AND_RUN\n') + 'exec ' + sq(exePath) + ' "$@"',
			'',
		].join('\n');
		let same = false;
		try { same = fs.readFileSync(file, 'utf8') === text; } catch (e) { /* ещё не создан */ }
		if (!same) {
			fs.mkdirSync(dir, { recursive: true });
			fs.writeFileSync(file, text);
		}
		fs.chmodSync(file, 0o755);
		return { file, dir };
	}
	if (platform === 'win32') {
		const dir = path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Problet', 'bin');
		const file = path.join(dir, 'problet.cmd');
		// start /wait: команда ждёт, пока браузер закроется (с --detach Problet сам уходит в фон и выходит сразу)
		const text = '@echo off\r\nstart "" /wait "' + exePath + '" %*\r\n';
		let same = false;
		try { same = fs.readFileSync(file, 'utf8') === text; } catch (e) { /* ещё не создан */ }
		if (!same) {
			fs.mkdirSync(dir, { recursive: true });
			fs.writeFileSync(file, text);
		}
		// PATH пользователя: дописываем папку один раз, остальное в нём не трогаем
		const script = "$d='" + dir.replace(/'/g, "''") + "';$p=[Environment]::GetEnvironmentVariable('Path','User');if(-not $p){$p=''};if(($p -split ';') -notcontains $d){[Environment]::SetEnvironmentVariable('Path',($p.TrimEnd(';')+';'+$d).TrimStart(';'),'User')}";
		try { execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 15000, stdio: 'ignore', windowsHide: true }); } catch (e) { /* команда останется доступна по полному пути */ }
		return { file, dir };
	}
	return null;
}

module.exports = { writeLauncher, startInbox, hasFuse, installCommand };
