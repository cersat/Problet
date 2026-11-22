// Точка входа Problet: сначала окно ошибки и перехватчик, потом сам браузер (main.js).
// Так даже ошибка при загрузке main.js показывается окном Problet с кнопкой «Скопировать», а не стандартным окном Electron

// problet --detach …: запускаем себя отдельным процессом без консоли и сразу выходим — команда в терминале
// не ждёт браузер и ничего не пишет. Без флага команда ждёт, пока браузер закроется
if (process.argv.includes('--detach')) {
	const { spawn } = require('child_process');
	// AppImage: исполняемый файл внутри AppImage исчезнет вместе с нашим процессом, запускать надо сам AppImage
	const exe = process.env.APPIMAGE || process.execPath;
	const args = process.argv.slice(1).filter((a) => a !== '--detach');
	const env = { ...process.env, ELECTRON_NO_ATTACH_CONSOLE: '1' };
	delete env.APPIMAGE;
	delete env.APPDIR;
	let started = false;
	try {
		spawn(exe, args, { detached: true, stdio: 'ignore', windowsHide: false, env }).unref();
		started = true;
	} catch (e) { /* не вышло — запустимся здесь же, как без флага */ }
	if (started) process.exit(0);
	process.argv = process.argv.filter((a) => a !== '--detach');
}

const errorwin = require('./errorwin');

process.on('uncaughtException', (err) => errorwin.show('Ошибка в главном процессе', errorwin.textOf(err)));

try {
	require('./main');
} catch (err) {
	errorwin.show('Problet не смог запуститься', errorwin.textOf(err), true);
}
