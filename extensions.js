// Расширения Chrome: папки с распакованным расширением (где лежит manifest.json).
// Electron поддерживает не все API расширений (в основном content scripts, страницы, часть chrome.* вроде storage и tabs),
// поэтому сложные расширения могут работать не полностью.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

let ses = null;
let file = '';
let entries = []; // { path, id, name, version, error }

function save() {
	try {
		fs.writeFileSync(file, JSON.stringify(entries.map((e) => e.path)), 'utf8');
	} catch (e) { /* не страшно: список восстановится при следующем добавлении */ }
}

function readManifest(dir) {
	let m;
	try {
		m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
	} catch (e) {
		throw new Error('В папке нет корректного manifest.json. Нужна распакованная папка расширения');
	}
	if (!m || typeof m !== 'object') throw new Error('Некорректный manifest.json');
	return m;
}

// Фоновому процессу расширения из магазина добавляем заглушки недостающих chrome.* (см. ext-shim.js).
// Подмена делается в нашей копии расширения: оригинальный фоновый файл переименован, а manifest указывает на обёртку
function patchBackground(dir) {
	const mf = path.join(dir, 'manifest.json');
	const m = readManifest(dir);
	const bg = m.background && m.background.service_worker;
	if (!bg || bg === 'problet-sw.js') return;
	fs.copyFileSync(path.join(__dirname, 'ext-shim.js'), path.join(dir, 'problet-shim.js'));
	const quote = (s) => JSON.stringify(s);
	const code = m.background.type === 'module'
		? 'import ' + quote('./problet-shim.js') + ';\nimport ' + quote('./' + bg) + ';\n'
		: 'importScripts(' + quote('problet-shim.js') + ', ' + quote(bg) + ');\n';
	fs.writeFileSync(path.join(dir, 'problet-sw.js'), code);
	m.background.service_worker = 'problet-sw.js';
	fs.writeFileSync(mf, JSON.stringify(m, null, '\t'));
}

async function loadOne(dir) {
	const entry = { path: dir, id: '', name: path.basename(dir), version: '', error: '' };
	try {
		readManifest(dir);
		if (dir.startsWith(path.join(path.dirname(file), 'extensions') + path.sep)) patchBackground(dir);
		const ext = await ses.extensions.loadExtension(dir, { allowFileAccess: false });
		entry.id = ext.id;
		entry.name = ext.name || entry.name;
		entry.version = ext.version || '';
	} catch (e) {
		entry.error = String((e && e.message) || e);
	}
	return entry;
}

async function init(session, userData) {
	ses = session;
	file = path.join(userData, 'extensions.json');
	let paths = [];
	try {
		const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
		if (Array.isArray(raw)) paths = raw.filter((p) => typeof p === 'string');
	} catch (e) { /* списка ещё нет */ }
	entries = [];
	for (const p of paths) entries.push(await loadOne(p));
}

function list() {
	return entries.map((e) => ({ path: e.path, id: e.id, name: e.name, version: e.version, error: e.error }));
}

async function add(dir) {
	if (typeof dir !== 'string' || !dir) throw new Error('Папка не выбрана');
	dir = path.resolve(dir);
	if (entries.some((e) => e.path === dir)) throw new Error('Это расширение уже добавлено');
	readManifest(dir);
	const entry = await loadOne(dir);
	if (entry.error) throw new Error(entry.error);
	entries.push(entry);
	save();
	return entry;
}

async function remove(dir) {
	const i = entries.findIndex((e) => e.path === dir);
	if (i < 0) return;
	const [e] = entries.splice(i, 1);
	if (e.id) {
		try {
			await ses.extensions.removeExtension(e.id);
		} catch (err) { /* уже выгружено */ }
	}
	save();
	// Расширения, скачанные из магазина, лежат в нашей папке — убираем и файлы
	if (dir.startsWith(path.join(path.dirname(file), 'extensions') + path.sep)) fs.rmSync(dir, { recursive: true, force: true });
}

// ---------- Кнопки расширений на панели ----------

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp' };

// Значок кнопки: из action.default_icon или общих icons манифеста, самый крупный до 64 пикселей
function iconData(dir, m, act) {
	let src = act.default_icon || m.icons || null;
	if (typeof src === 'string') src = { 16: src };
	if (!src || typeof src !== 'object') return '';
	const sizes = Object.keys(src).map(Number).filter((n) => n > 0).sort((a, b) => a - b);
	const pick = [...sizes].reverse().find((n) => n <= 64) || sizes[0];
	const rel = pick && src[pick];
	const mime = rel && MIME[path.extname(String(rel)).toLowerCase()];
	if (!mime) return '';
	try {
		const p = path.resolve(dir, String(rel).replace(/^\/+/, ''));
		if (!p.startsWith(path.resolve(dir) + path.sep)) return '';
		return 'data:' + mime + ';base64,' + fs.readFileSync(p).toString('base64');
	} catch (e) {
		return '';
	}
}

function manifestOf(e) {
	try {
		return readManifest(e.path);
	} catch (err) {
		return null;
	}
}

// Расширения с кнопкой на панели инструментов (action в манифесте)
function actions() {
	const out = [];
	for (const e of entries) {
		if (!e.id || e.error) continue;
		const m = manifestOf(e);
		const act = m && (m.action || m.browser_action);
		if (!act || typeof act !== 'object') continue;
		out.push({ id: e.id, name: e.name, title: typeof act.default_title === 'string' && !act.default_title.startsWith('__MSG_') ? act.default_title : e.name, icon: iconData(e.path, m, act), popup: !!act.default_popup });
	}
	return out;
}

// Адрес окошка кнопки, а если окошка нет — страницы настроек расширения
function pageUrl(id, kind) {
	const e = entries.find((x) => x.id === id);
	const m = e && manifestOf(e);
	if (!m) return '';
	const act = m.action || m.browser_action || {};
	const rel = kind === 'popup' ? act.default_popup : (m.options_ui && m.options_ui.page) || m.options_page;
	return typeof rel === 'string' && rel ? 'chrome-extension://' + id + '/' + rel.replace(/^\/+/, '') : '';
}

// ---------- Установка из Chrome Web Store ----------

// Из ссылки магазина или просто из идентификатора (32 буквы a–p) достаём идентификатор расширения
function storeId(input) {
	const m = String(input || '').match(/(?:^|[/=?&#])([a-p]{32})(?:$|[/?&#])/i) || String(input || '').trim().match(/^([a-p]{32})$/i);
	if (!m) throw new Error('Нужна ссылка на расширение в Chrome Web Store или его идентификатор (32 буквы)');
	return m[1].toLowerCase();
}

// CRX = заголовок + обычный ZIP. Версия 2: ключ и подпись, версия 3: protobuf-заголовок
function crxToZip(buf) {
	if (buf.length < 16 || buf.toString('latin1', 0, 4) !== 'Cr24') throw new Error('Магазин вернул не файл расширения');
	const version = buf.readUInt32LE(4);
	let start;
	if (version === 2) start = 16 + buf.readUInt32LE(8) + buf.readUInt32LE(12);
	else if (version === 3) start = 12 + buf.readUInt32LE(8);
	else throw new Error('Неизвестная версия формата CRX: ' + version);
	if (start >= buf.length) throw new Error('Повреждённый файл расширения');
	return buf.subarray(start);
}

// Минимальная распаковка ZIP (хранение и deflate) без внешних библиотек
function unzip(zip, dest) {
	let eocd = -1;
	for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) {
		if (zip.readUInt32LE(i) === 0x06054b50) {
			eocd = i;
			break;
		}
	}
	if (eocd < 0) throw new Error('Повреждённый архив расширения');
	const count = zip.readUInt16LE(eocd + 10);
	let p = zip.readUInt32LE(eocd + 16);
	const root = path.resolve(dest);
	let total = 0;
	for (let n = 0; n < count; n++) {
		if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error('Повреждённый архив расширения');
		const method = zip.readUInt16LE(p + 10);
		const csize = zip.readUInt32LE(p + 20);
		const nameLen = zip.readUInt16LE(p + 28);
		const extraLen = zip.readUInt16LE(p + 30);
		const commentLen = zip.readUInt16LE(p + 32);
		const local = zip.readUInt32LE(p + 42);
		const name = zip.toString('utf8', p + 46, p + 46 + nameLen);
		p += 46 + nameLen + extraLen + commentLen;
		const target = path.resolve(root, name);
		if (target !== root && !target.startsWith(root + path.sep)) throw new Error('Архив пытается выйти за пределы папки');
		if (name.endsWith('/')) {
			fs.mkdirSync(target, { recursive: true });
			continue;
		}
		const dataStart = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
		const raw = zip.subarray(dataStart, dataStart + csize);
		const data = method === 0 ? raw : method === 8 ? zlib.inflateRawSync(raw) : null;
		if (!data) throw new Error('Неподдерживаемый способ сжатия в архиве');
		total += data.length;
		if (total > 200 * 1024 * 1024) throw new Error('Расширение слишком большое');
		fs.mkdirSync(path.dirname(target), { recursive: true });
		fs.writeFileSync(target, data);
	}
}

async function installFromStore(input, chromeVersion) {
	const id = storeId(input);
	const dir = path.join(path.dirname(file), 'extensions', id);
	if (entries.some((e) => e.path === dir)) throw new Error('Это расширение уже установлено');
	const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
	const os = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';
	const url = 'https://clients2.google.com/service/update2/crx?response=redirect&os=' + os + '&arch=' + arch + '&os_arch=' + arch
		+ '&prod=chromecrx&prodchannel=stable&prodversion=' + encodeURIComponent(chromeVersion || '156.0.0.0')
		+ '&acceptformat=crx2,crx3&x=' + encodeURIComponent('id=' + id + '&installsource=ondemand&uc');
	const res = await fetch(url, { redirect: 'follow' });
	if (res.status === 204 || res.status === 404) throw new Error('Магазин не отдаёт это расширение (его нет или оно недоступно для этой версии браузера)');
	if (!res.ok) throw new Error('Магазин ответил кодом ' + res.status);
	const buf = Buffer.from(await res.arrayBuffer());
	if (buf.length > 150 * 1024 * 1024) throw new Error('Расширение слишком большое');
	const tmp = dir + '.tmp';
	fs.rmSync(tmp, { recursive: true, force: true });
	fs.mkdirSync(tmp, { recursive: true });
	try {
		unzip(crxToZip(buf), tmp);
		readManifest(tmp);
		fs.rmSync(dir, { recursive: true, force: true });
		fs.renameSync(tmp, dir);
	} catch (e) {
		fs.rmSync(tmp, { recursive: true, force: true });
		throw e;
	}
	try {
		return await add(dir);
	} catch (e) {
		fs.rmSync(dir, { recursive: true, force: true });
		throw e;
	}
}

module.exports = { init, list, add, remove, actions, pageUrl, installFromStore, storeId, crxToZip, unzip };
