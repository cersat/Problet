// Окно ошибки Problet (вместо стандартного окна Electron): текст ошибки, кнопки «Скопировать», «Безопасный режим», «Закрыть».
// Подключается самым первым (boot.js), поэтому показывает и ошибки, случившиеся ещё при загрузке main.js
const { app, BrowserWindow, ipcMain, clipboard } = require('electron');
const path = require('path');

const windows = new Map(); // id окна -> { title, text }
let last = { text: '', at: 0 };
const pending = [];

// Безопасный режим: main.js подставляет включение без перезапуска; пока браузер не загрузился — перезапуск с --safe-mode
let safe = {
	state: () => process.argv.includes('--safe-mode'),
	enable: () => {
		app.relaunch({ args: process.argv.slice(1).filter((a) => a !== '--safe-mode').concat('--safe-mode') });
		app.exit(0);
		return true;
	},
};
let lang = () => (/^ru/i.test(app.getLocale() || '') ? 'ru' : 'en');
let title = (t) => t;

// fatal — браузер не запустился (окно сообщает об этом, а не «браузер продолжает работать»)
function show(heading, text, fatal) {
	if (!app.isReady()) {
		pending.push([heading, text, fatal]);
		return;
	}
	try {
		if (text === last.text && Date.now() - last.at < 10000) return; // одна и та же ошибка подряд — одно окно
		last = { text, at: Date.now() };
		if (windows.size >= 3) return;
		const w = new BrowserWindow({
			width: 620,
			height: 420,
			minWidth: 380,
			minHeight: 260,
			backgroundColor: '#1f1f23',
			title: title('Ошибка Problet'),
			autoHideMenuBar: true,
			icon: path.join(__dirname, 'icon.png'),
			webPreferences: { preload: path.join(__dirname, 'preload-error.js'), contextIsolation: true, sandbox: true },
		});
		w.removeMenu();
		const id = w.webContents.id;
		windows.set(id, { title: heading, text, fatal: !!fatal });
		w.on('closed', () => windows.delete(id));
		w.loadFile('error.html');
	} catch (e) { /* показать ошибку не вышло — она всё равно в журнале */ }
}
app.whenReady().then(() => {
	for (const p of pending.splice(0)) show(...p);
});

const textOf = (err) => (err instanceof Error ? err.stack || String(err) : String(err));
const isErrorWindow = (wc) => windows.has(wc.id);

ipcMain.on('error:lang', (e) => {
	e.returnValue = isErrorWindow(e.sender) ? lang() : 'ru';
});
ipcMain.handle('error:get', (e) => windows.get(e.sender.id) || { title: 'Ошибка', text: '' });
ipcMain.handle('error:copy', (e) => {
	const info = windows.get(e.sender.id);
	if (info) clipboard.writeText(info.title + '\n' + info.text + '\n\nProblet ' + app.getVersion() + ', ' + process.platform + ' ' + process.arch + ', Electron ' + process.versions.electron);
});
ipcMain.on('error:close', (e) => {
	if (isErrorWindow(e.sender)) BrowserWindow.fromWebContents(e.sender)?.close();
});
ipcMain.handle('error:safe', (e) => {
	if (!isErrorWindow(e.sender)) throw new Error('Доступ запрещён');
	return safe.enable();
});
ipcMain.handle('error:safe-state', () => safe.state());

// main.js сообщает, как включать безопасный режим без перезапуска, на каком языке писать и как переводить заголовок
function setup(o) {
	if (o.safe) safe = o.safe;
	if (o.lang) lang = o.lang;
	if (o.title) title = o.title;
}

module.exports = { show, setup, textOf };
