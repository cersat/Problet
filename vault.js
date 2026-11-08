// Хранилище паролей. Всё содержимое шифруется AES-256-GCM, ключ получается из мастер-пароля через scrypt.
// Файл vault.json лежит рядом с данными браузера; без мастер-пароля прочитать пароли нельзя.
// Мастер-пароль нигде не хранится: правильность проверяется тем, что расшифровка проходит проверку подлинности GCM.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const KDF = { N: 32768, r: 8, p: 1 };
const MIN_MASTER = 8;
const LIMIT = 5000;

let file = null;
let key = null; // ключ в памяти, пока хранилище открыто
let kdf = null;
let salt = null;
let items = [];
let lockMs = 0;
let lockTimer = null;
let onLock = () => {};

function init(dataDir, opts = {}) {
	file = path.join(dataDir, 'vault.json');
	onLock = opts.onLock || (() => {});
	lock();
}

function deriveKey(master, saltBuf, params) {
	return crypto.scryptSync(String(master), saltBuf, 32, { N: params.N, r: params.r, p: params.p, maxmem: 128 * 1024 * 1024 });
}

function readFile() {
	try {
		const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
		if (raw && raw.v === 1 && raw.salt && raw.iv && raw.tag && typeof raw.data === 'string' && raw.kdf) return raw;
	} catch (e) { /* файла нет или он повреждён */ }
	return null;
}

function exists() {
	return !!readFile();
}

function isUnlocked() {
	return !!key;
}

function save() {
	const iv = crypto.randomBytes(12);
	const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
	const data = Buffer.concat([cipher.update(JSON.stringify(items), 'utf8'), cipher.final()]);
	const out = { v: 1, kdf, salt: salt.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
	const tmp = file + '.tmp';
	fs.writeFileSync(tmp, JSON.stringify(out), { mode: 0o600 });
	fs.renameSync(tmp, file);
}

function touch() {
	if (lockTimer) clearTimeout(lockTimer);
	lockTimer = null;
	if (key && lockMs > 0) lockTimer = setTimeout(lock, lockMs);
}

// minutes: 0 — не запирать само
function setAutoLock(minutes) {
	lockMs = Math.max(0, Number(minutes) || 0) * 60 * 1000;
	touch();
}

function lock() {
	const was = !!key;
	if (key) key.fill(0);
	key = null;
	items = [];
	if (lockTimer) clearTimeout(lockTimer);
	lockTimer = null;
	if (was) onLock();
}

function checkMaster(master) {
	if (typeof master !== 'string' || master.length < MIN_MASTER) throw new Error('Мастер-пароль должен быть не короче ' + MIN_MASTER + ' символов');
}

function create(master) {
	if (exists()) throw new Error('Хранилище уже создано');
	checkMaster(master);
	kdf = { ...KDF };
	salt = crypto.randomBytes(16);
	key = deriveKey(master, salt, kdf);
	items = [];
	save();
	touch();
}

function unlock(master) {
	const raw = readFile();
	if (!raw) throw new Error('Хранилище не создано');
	if (key) return;
	let k;
	try {
		const params = { N: raw.kdf.N, r: raw.kdf.r, p: raw.kdf.p };
		const s = Buffer.from(raw.salt, 'base64');
		k = deriveKey(master, s, params);
		const d = crypto.createDecipheriv('aes-256-gcm', k, Buffer.from(raw.iv, 'base64'));
		d.setAuthTag(Buffer.from(raw.tag, 'base64'));
		const plain = Buffer.concat([d.update(Buffer.from(raw.data, 'base64')), d.final()]).toString('utf8');
		const list = JSON.parse(plain);
		items = Array.isArray(list) ? list : [];
		kdf = params;
		salt = s;
		key = k;
	} catch (e) {
		if (k) k.fill(0);
		throw new Error('Неверный мастер-пароль');
	}
	touch();
}

// Проверка мастер-пароля при открытом хранилище (например, перед экспортом)
function verify(master) {
	need();
	const raw = readFile();
	const probe = deriveKey(String(master), Buffer.from(raw.salt, 'base64'), raw.kdf);
	const same = crypto.timingSafeEqual(probe, key);
	probe.fill(0);
	if (!same) throw new Error('Неверный мастер-пароль');
}

// Все записи вместе с паролями: только для экспорта
function all() {
	need();
	return items.map((e) => ({ ...e }));
}

function need() {
	if (!key) throw new Error('Хранилище закрыто');
	touch();
}

function changeMaster(oldMaster, newMaster) {
	need();
	const raw = readFile();
	const probe = deriveKey(oldMaster, Buffer.from(raw.salt, 'base64'), raw.kdf);
	const same = crypto.timingSafeEqual(probe, key);
	probe.fill(0);
	if (!same) throw new Error('Неверный мастер-пароль');
	checkMaster(newMaster);
	const nextSalt = crypto.randomBytes(16);
	const nextKey = deriveKey(newMaster, nextSalt, kdf);
	key.fill(0);
	key = nextKey;
	salt = nextSalt;
	save();
}

const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');

// Запись без пароля: список для страницы управления
const view = (e) => ({ id: e.id, origin: e.origin, username: e.username, created: e.created, updated: e.updated });

function list() {
	need();
	return items.map(view).sort((a, b) => a.origin.localeCompare(b.origin) || a.username.localeCompare(b.username));
}

// Одинаковые сайт и логин считаются одной записью: пароль в ней обновляется
function add({ origin, username, password }) {
	need();
	origin = str(origin, 300);
	username = str(username, 300);
	password = str(password, 1000);
	if (!origin || !password) throw new Error('Нужны адрес сайта и пароль');
	const now = Date.now();
	const same = items.find((e) => e.origin === origin && e.username === username);
	if (same) {
		same.password = password;
		same.updated = now;
		save();
		return view(same);
	}
	if (items.length >= LIMIT) throw new Error('Слишком много записей');
	const entry = { id: crypto.randomUUID(), origin, username, password, created: now, updated: now };
	items.push(entry);
	save();
	return view(entry);
}

function update(id, patch) {
	need();
	const e = items.find((x) => x.id === id);
	if (!e) throw new Error('Запись не найдена');
	if (patch.username !== undefined) e.username = str(patch.username, 300);
	if (patch.password !== undefined) {
		if (!patch.password) throw new Error('Пароль не может быть пустым');
		e.password = str(patch.password, 1000);
	}
	if (patch.origin !== undefined && patch.origin) e.origin = str(patch.origin, 300);
	e.updated = Date.now();
	save();
	return view(e);
}

function remove(id) {
	need();
	items = items.filter((x) => x.id !== id);
	save();
}

function reveal(id) {
	need();
	const e = items.find((x) => x.id === id);
	if (!e) throw new Error('Запись не найдена');
	return e.password;
}

// Для подстановки на странице: записи именно этого адреса (схема, хост и порт), с паролями
function forOrigin(origin) {
	if (!key) return [];
	touch();
	const norm = (o) => String(o).replace('//www.', '//'); // www.сайт и сайт считаем одним сайтом
	return items.filter((e) => norm(e.origin) === norm(origin)).sort((a, b) => b.updated - a.updated).map((e) => ({ username: e.username, password: e.password }));
}

// Уже есть такая запись с тем же паролем? Тогда сохранять незачем
function has(origin, username, password) {
	return items.some((e) => e.origin === origin && e.username === username && e.password === password);
}

function hasLogin(origin, username) {
	return items.some((e) => e.origin === origin && e.username === username);
}

module.exports = { verify, all, init, exists, isUnlocked, create, unlock, lock, setAutoLock, changeMaster, list, add, update, remove, reveal, forOrigin, has, hasLogin, MIN_MASTER };
