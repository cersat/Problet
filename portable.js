// Портативная установка: установщик Windows кладёт рядом с программой файл portable.txt.
// Тогда все данные хранятся в папке data рядом, а не в профиле пользователя: папку можно перенести на другой компьютер или флешку.
const fs = require('fs');
const path = require('path');

const MARK = 'portable.txt';

// Папка программы, если это портативная установка, иначе ''
function appDir(execPath) {
	const dir = path.dirname(execPath);
	return fs.existsSync(path.join(dir, MARK)) ? dir : '';
}

// Папка данных для портативной установки или '' (профиль задан явно, установка не портативная)
function dataDir(execPath, argv) {
	if (argv.some((a) => a.startsWith('--user-data-dir='))) return '';
	const dir = appDir(execPath);
	return dir ? path.join(dir, 'data') : '';
}

module.exports = { MARK, appDir, dataDir };
