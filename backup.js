// Экспорт и импорт браузера целиком: один файл со всем, что Problet хранит в папке данных, и (по желанию) входом в аккаунт.
// Формат: gzip( 'PROBLETBK1\n' + длина заголовка (4 байта) + заголовок JSON + содержимое файлов подряд ).
// В заголовке: версия, дата, список файлов { path, size }, данные хранилища (data) и, если задан пароль файла, зашифрованный вход в аккаунт.
// В файл не попадают куки и кеш сайтов (их держит Chromium), а также родительский контроль: он лежит отдельно и привязан к пользователю системы.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const MAGIC = 'PROBLETBK1\n';
const LIMIT = 500 * 1024 * 1024; // больше в один файл не собираем
const FILES = ['vault.json', 'notepad.pmd', 'extensions.json'];
const DIRS = ['extensions', 'addons', 'addon-data', 'offline', 'bookmark-backups'];
const ALLOWED = (p) => FILES.includes(p) || DIRS.some((d) => p.startsWith(d + '/'));

function walk(base, rel, out) {
	let list = [];
	try {
		list = fs.readdirSync(path.join(base, rel), { withFileTypes: true });
	} catch (e) {
		return;
	}
	for (const e of list) {
		const r = rel + '/' + e.name;
		if (e.isDirectory()) walk(base, r, out);
		else if (e.isFile()) out.push(r);
	}
}

// Вход в аккаунт в файле шифруется паролем файла: в нём ключ шифрования данных аккаунта и токен
function seal(account, password) {
	const salt = crypto.randomBytes(16);
	const iv = crypto.randomBytes(12);
	const key = crypto.scryptSync(String(password), salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
	const c = crypto.createCipheriv('aes-256-gcm', key, iv);
	const data = Buffer.concat([c.update(JSON.stringify(account), 'utf8'), c.final()]);
	return { salt: salt.toString('base64'), iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') };
}

function unseal(o, password) {
	try {
		const key = crypto.scryptSync(String(password), Buffer.from(o.salt, 'base64'), 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
		const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(o.iv, 'base64'));
		d.setAuthTag(Buffer.from(o.tag, 'base64'));
		return JSON.parse(Buffer.concat([d.update(Buffer.from(o.data, 'base64')), d.final()]).toString('utf8'));
	} catch (e) {
		return null;
	}
}

// opts: { userData, data (объект хранилища), account (или null), password, version }
function create(opts) {
	const names = [];
	for (const f of FILES) if (fs.existsSync(path.join(opts.userData, f))) names.push(f);
	for (const d of DIRS) walk(opts.userData, d, names);
	const list = [];
	const blobs = [];
	let total = 0;
	let skipped = 0;
	for (const rel of names) {
		const buf = fs.readFileSync(path.join(opts.userData, rel));
		if (total + buf.length > LIMIT) {
			skipped++;
			continue;
		}
		total += buf.length;
		list.push({ path: rel, size: buf.length });
		blobs.push(buf);
	}
	const header = {
		format: 'problet-export',
		v: 1,
		exported: new Date().toISOString(),
		appVersion: opts.version || '',
		data: opts.data,
		files: list,
		account: opts.account && opts.password ? seal(opts.account, opts.password) : null,
	};
	const head = Buffer.from(JSON.stringify(header), 'utf8');
	const len = Buffer.alloc(4);
	len.writeUInt32BE(head.length);
	return { buffer: zlib.gzipSync(Buffer.concat([Buffer.from(MAGIC), len, head, ...blobs])), files: list.length, skipped, hasAccount: !!header.account };
}

function parse(buffer) {
	let raw;
	try {
		raw = zlib.gunzipSync(buffer, { maxOutputLength: LIMIT + 64 * 1024 * 1024 });
	} catch (e) {
		throw new Error('Это не файл экспорта Problet');
	}
	if (raw.subarray(0, MAGIC.length).toString() !== MAGIC) throw new Error('Это не файл экспорта Problet');
	const n = raw.readUInt32BE(MAGIC.length);
	let header;
	try {
		header = JSON.parse(raw.subarray(MAGIC.length + 4, MAGIC.length + 4 + n).toString('utf8'));
	} catch (e) {
		throw new Error('Файл экспорта повреждён');
	}
	if (!header || header.format !== 'problet-export' || header.v !== 1 || !Array.isArray(header.files)) throw new Error('Файл экспорта повреждён или из другой версии');
	return { header, body: raw.subarray(MAGIC.length + 4 + n) };
}

// Что лежит в файле, без распаковки на диск
function inspect(buffer) {
	const { header } = parse(buffer);
	return { exported: header.exported, appVersion: header.appVersion, hasAccount: !!header.account, files: header.files.length };
}

// Раскладывает файл по папке данных. Старый data.json остаётся рядом как data.json.before-import.
// Возвращает { data, account }: account — вход в аккаунт или null; needPassword — в файле есть вход, но пароль не подошёл
function restore(buffer, userData, password) {
	const { header, body } = parse(buffer);
	let account = null;
	let needPassword = false;
	if (header.account) {
		account = password ? unseal(header.account, password) : null;
		if (!account) needPassword = true;
	}
	const items = [];
	let offset = 0;
	for (const f of header.files) {
		if (typeof f.path !== 'string' || !Number.isInteger(f.size) || f.size < 0 || !ALLOWED(f.path) || f.path.split('/').includes('..') || f.path.includes('\\') || offset + f.size > body.length) throw new Error('Файл экспорта повреждён');
		items.push({ path: f.path, buf: body.subarray(offset, offset + f.size) });
		offset += f.size;
	}
	const dataFile = path.join(userData, 'data.json');
	try {
		if (fs.existsSync(dataFile)) fs.copyFileSync(dataFile, dataFile + '.before-import');
	} catch (e) { /* копию сделать не вышло: продолжаем */ }
	for (const d of DIRS) if (items.some((i) => i.path.startsWith(d + '/'))) fs.rmSync(path.join(userData, d), { recursive: true, force: true });
	for (const i of items) {
		const target = path.join(userData, i.path);
		fs.mkdirSync(path.dirname(target), { recursive: true });
		fs.writeFileSync(target, i.buf);
	}
	fs.writeFileSync(dataFile + '.tmp', JSON.stringify(header.data && typeof header.data === 'object' ? header.data : {}), 'utf8');
	fs.renameSync(dataFile + '.tmp', dataFile);
	return { files: items.length, account, needPassword, hadAccount: !!header.account };
}

module.exports = { create, restore, inspect, LIMIT };
