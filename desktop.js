const fs = require('fs');
const path = require('path');

// Ярлык для AppImage: в меню приложений он сам не появляется, а без ярлыка система не может назначить браузер по умолчанию
function writeLauncher(appImage, iconSource, home) {
	const apps = path.join(home, '.local', 'share', 'applications');
	const icons = path.join(home, '.local', 'share', 'icons');
	fs.mkdirSync(apps, { recursive: true });
	fs.mkdirSync(icons, { recursive: true });
	const icon = path.join(icons, 'problet.png');
	fs.copyFileSync(iconSource, icon);
	const exec = '"' + appImage.replace(/(["`$\\])/g, '\\$1') + '"';
	const file = path.join(apps, 'problet.desktop');
	fs.writeFileSync(file, [
		'[Desktop Entry]', 'Type=Application', 'Name=Problet', 'GenericName=Веб-браузер', 'Comment=Браузер Problet',
		'Exec=' + exec + ' %U', 'Icon=' + icon, 'Terminal=false', 'Categories=Network;WebBrowser;',
		'MimeType=text/html;application/xhtml+xml;x-scheme-handler/http;x-scheme-handler/https;', 'StartupWMClass=Problet', '',
	].join('\n'));
	fs.chmodSync(file, 0o755);
	return { apps, file };
}

module.exports = { writeLauncher };
