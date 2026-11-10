const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// AppImage монтирует себя через FUSE 2. Если библиотеки нет (в новых Ubuntu и Mint её по умолчанию нет), образ не запустится: «Cannot mount AppImage»
function hasFuse() {
	for (const bin of ['ldconfig', '/sbin/ldconfig', '/usr/sbin/ldconfig']) {
		try {
			return /libfuse\.so\.2/.test(execFileSync(bin, ['-p'], { encoding: 'utf8', timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'] }));
		} catch (e) { /* пробуем следующий путь */ }
	}
	return false;
}

// Ярлык для AppImage: в меню приложений он сам не появляется, а без ярлыка система не может назначить браузер по умолчанию
function writeLauncher(appImage, iconSource, home) {
	const apps = path.join(home, '.local', 'share', 'applications');
	const icons = path.join(home, '.local', 'share', 'icons');
	fs.mkdirSync(apps, { recursive: true });
	fs.mkdirSync(icons, { recursive: true });
	const icon = path.join(icons, 'problet.png');
	fs.copyFileSync(iconSource, icon);
	// Без FUSE образ распаковывается во временную папку сам и запускается оттуда
	const exec = (hasFuse() ? '' : 'env APPIMAGE_EXTRACT_AND_RUN=1 ') + '"' + appImage.replace(/(["`$\\])/g, '\\$1') + '"';
	const file = path.join(apps, 'problet.desktop');
	fs.writeFileSync(file, [
		'[Desktop Entry]', 'Type=Application', 'Name=Problet', 'GenericName=Веб-браузер', 'Comment=Браузер Problet',
		'Exec=' + exec + ' %U', 'Icon=' + icon, 'Terminal=false', 'Categories=Network;WebBrowser;',
		'MimeType=text/html;application/xhtml+xml;x-scheme-handler/http;x-scheme-handler/https;', 'StartupWMClass=Problet', '',
	].join('\n'));
	fs.chmodSync(file, 0o755);
	return { apps, file };
}

module.exports = { writeLauncher, hasFuse };
