// Импорт закладок из других браузеров, установленных на этом компьютере.
// Chrome, Chromium, Edge, Brave, Vivaldi, Opera: файл Bookmarks (JSON). Firefox: свежая копия закладок bookmarkbackups/*.jsonlz4.
// Пароли и историю не трогаем: они зашифрованы ключом самого браузера или лежат в базе SQLite.

const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_SIZE = 50 * 1024 * 1024;

function bases() {
	const home = os.homedir();
	if (process.platform === 'win32') {
		const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
		const roaming = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
		return {
			chromium: [
				['Google Chrome', path.join(local, 'Google', 'Chrome', 'User Data')],
				['Chromium', path.join(local, 'Chromium', 'User Data')],
				['Microsoft Edge', path.join(local, 'Microsoft', 'Edge', 'User Data')],
				['Brave', path.join(local, 'BraveSoftware', 'Brave-Browser', 'User Data')],
				['Vivaldi', path.join(local, 'Vivaldi', 'User Data')],
				['Opera', path.join(roaming, 'Opera Software', 'Opera Stable')],
			],
			firefox: path.join(roaming, 'Mozilla', 'Firefox', 'Profiles'),
		};
	}
	if (process.platform === 'darwin') {
		const sup = path.join(home, 'Library', 'Application Support');
		return {
			chromium: [
				['Google Chrome', path.join(sup, 'Google', 'Chrome')],
				['Chromium', path.join(sup, 'Chromium')],
				['Microsoft Edge', path.join(sup, 'Microsoft Edge')],
				['Brave', path.join(sup, 'BraveSoftware', 'Brave-Browser')],
				['Vivaldi', path.join(sup, 'Vivaldi')],
				['Opera', path.join(sup, 'com.operasoftware.Opera')],
			],
			firefox: path.join(sup, 'Firefox', 'Profiles'),
		};
	}
	const cfg = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
	return {
		chromium: [
			['Google Chrome', path.join(cfg, 'google-chrome')],
			['Chromium', path.join(cfg, 'chromium')],
			['Microsoft Edge', path.join(cfg, 'microsoft-edge')],
			['Brave', path.join(cfg, 'BraveSoftware', 'Brave-Browser')],
			['Vivaldi', path.join(cfg, 'vivaldi')],
			['Opera', path.join(cfg, 'opera')],
		],
		firefox: path.join(home, '.mozilla', 'firefox'),
	};
}

function subdirs(dir) {
	try {
		return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => path.join(dir, d.name));
	} catch (e) {
		return [];
	}
}

function size(file) {
	try {
		const st = fs.statSync(file);
		return st.isFile() ? st.size : -1;
	} catch (e) {
		return -1;
	}
}

// Список найденных источников: { id, name, files: [путь, ...] }
function detect() {
	const b = bases();
	const found = [];
	for (const [name, dir] of b.chromium) {
		const files = [];
		for (const profile of [dir, ...subdirs(dir)]) {
			const f = path.join(profile, 'Bookmarks');
			if (size(f) > 0) files.push(f);
		}
		if (files.length) found.push({ id: 'chromium:' + name, name, files });
	}
	const ff = [];
	for (const profile of subdirs(b.firefox)) {
		const backups = path.join(profile, 'bookmarkbackups');
		let latest = null;
		try {
			for (const n of fs.readdirSync(backups)) {
				if (!/\.jsonlz4$/.test(n)) continue;
				const f = path.join(backups, n);
				const mtime = fs.statSync(f).mtimeMs;
				if (!latest || mtime > latest.mtime) latest = { f, mtime };
			}
		} catch (e) { /* нет копий закладок */ }
		if (latest) ff.push(latest.f);
	}
	if (ff.length) found.push({ id: 'firefox:Firefox', name: 'Firefox', files: ff });
	return found;
}

// ---------- Chrome и родственные ----------

function walkChrome(node, folder, out, depth) {
	if (!node || depth > 40) return;
	if (node.type === 'url') {
		out.push({ title: String(node.name || ''), url: String(node.url || ''), folder });
	} else if (Array.isArray(node.children)) {
		const name = depth === 0 ? '' : String(node.name || '');
		for (const c of node.children) walkChrome(c, name || folder, out, depth + 1);
	}
}

function parseChrome(text) {
	const roots = JSON.parse(text).roots || {};
	const out = [];
	for (const key of Object.keys(roots)) {
		if (roots[key] && typeof roots[key] === 'object') walkChrome(roots[key], '', out, 0);
	}
	return out;
}

// ---------- Firefox ----------

// Блок LZ4 (без обрамления), как его пишет Firefox
function lz4Block(src, outSize) {
	const out = Buffer.alloc(outSize);
	let i = 0;
	let o = 0;
	while (i < src.length) {
		const token = src[i++];
		let lit = token >> 4;
		if (lit === 15) {
			let b;
			do {
				b = src[i++];
				lit += b;
			} while (b === 255 && i < src.length);
		}
		if (o + lit > outSize || i + lit > src.length) throw new Error('Повреждённый файл закладок');
		src.copy(out, o, i, i + lit);
		i += lit;
		o += lit;
		if (i >= src.length) break;
		const offset = src[i] | (src[i + 1] << 8);
		i += 2;
		if (!offset || offset > o) throw new Error('Повреждённый файл закладок');
		let len = token & 15;
		if (len === 15) {
			let b;
			do {
				b = src[i++];
				len += b;
			} while (b === 255 && i < src.length);
		}
		len += 4;
		if (o + len > outSize) throw new Error('Повреждённый файл закладок');
		for (let k = 0; k < len; k++) {
			out[o] = out[o - offset];
			o++;
		}
	}
	return out.subarray(0, o);
}

function unpackMozLz4(buf) {
	if (buf.length < 12 || buf.toString('latin1', 0, 8) !== 'mozLz40\0') throw new Error('Это не файл закладок Firefox');
	const outSize = buf.readUInt32LE(8);
	if (outSize > MAX_SIZE) throw new Error('Файл слишком большой');
	return lz4Block(buf.subarray(12), outSize);
}

function walkFirefox(node, folder, out, depth) {
	if (!node || depth > 40) return;
	if (node.type === 'text/x-moz-place') {
		const url = String(node.uri || '');
		if (/^(https?|ftp|file):/i.test(url)) out.push({ title: String(node.title || ''), url, folder });
	} else if (Array.isArray(node.children)) {
		const name = node.root || depth === 0 ? '' : String(node.title || '');
		for (const c of node.children) walkFirefox(c, name || folder, out, depth + 1);
	}
}

function parseFirefox(buf) {
	const out = [];
	walkFirefox(JSON.parse(unpackMozLz4(buf).toString('utf8')), '', out, 0);
	return out;
}

// ---------- Чтение ----------

function read(id) {
	const src = detect().find((s) => s.id === id);
	if (!src) throw new Error('Источник не найден');
	const items = [];
	for (const f of src.files) {
		if (size(f) > MAX_SIZE) continue;
		const raw = fs.readFileSync(f);
		items.push(...(id.startsWith('firefox:') ? parseFirefox(raw) : parseChrome(raw.toString('utf8'))));
	}
	return items.filter((it) => /^(https?|ftp|file):/i.test(it.url));
}

module.exports = { detect, read, parseChrome, parseFirefox, unpackMozLz4, lz4Block };
