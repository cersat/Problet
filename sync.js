// Аккаунт Problet и синхронизация закладок, настроек и паролей.
// Пароль аккаунта на сервер не уходит: из него (scrypt) получаются два ключа — «auth» для входа и ключ шифрования данных. Данные на сервере
// лежат зашифрованными (AES-256-GCM), сервер их не читает. Токен и ключ шифрования хранятся в sync.json рядом с данными браузера;
// ключ дополнительно защищён средствами системы (safeStorage), если они доступны.
// Закладки и настройки синхронизируются снимками (побеждает более свежее изменение), пароли — слиянием и только пока хранилище открыто.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app, net, safeStorage } = require('electron');

const DEFAULT_URL = 'https://problet.dar-site.uk/';
const EVERY = 5 * 60 * 1000;
const NICK = /^[A-Za-z0-9_.-]{3,32}$/;
const MIN_PASSWORD = 8;
const KINDS = ['bookmarks', 'settings', 'passwords'];
const FLAG = { bookmarks: 'syncBookmarks', settings: 'syncSettings', passwords: 'syncPasswords' };

let deps = null; // { store, vault, settings, off }
let acc = null; // { nick, token, encKey: Buffer, kinds: { вид: { rev, hash, at } } }
let busy = null;
let timer = null;
let soonTimer = null;
const info = { last: 0, error: '', passwords: '' };

const url = (p) => (process.env.PROBLET_SYNC_URL || DEFAULT_URL).replace(/\/?$/, '/') + p.replace(/^\//, '');
const file = () => path.join(app.getPath('userData'), 'sync.json');

// ---------- Хранение ----------

function wrapKey(buf) {
	try {
		if (safeStorage.isEncryptionAvailable()) return { sealed: safeStorage.encryptString(buf.toString('base64')).toString('base64') };
	} catch (e) { /* системного хранилища ключей нет */ }
	return { plain: buf.toString('base64') };
}

function unwrapKey(o) {
	try {
		if (o && o.sealed) return Buffer.from(safeStorage.decryptString(Buffer.from(o.sealed, 'base64')), 'base64');
		if (o && o.plain) return Buffer.from(o.plain, 'base64');
	} catch (e) { /* ключ не расшифровался: нужно войти заново */ }
	return null;
}

function load() {
	try {
		const raw = JSON.parse(fs.readFileSync(file(), 'utf8'));
		const key = unwrapKey(raw.encKey);
		if (raw && NICK.test(raw.nick || '') && raw.token && key) acc = { nick: raw.nick, token: raw.token, encKey: key, kinds: raw.kinds && typeof raw.kinds === 'object' ? raw.kinds : {} };
	} catch (e) { /* аккаунта на этом устройстве нет */ }
}

function persist() {
	if (!acc) {
		try {
			fs.rmSync(file(), { force: true });
		} catch (e) { /* файла нет */ }
		return;
	}
	const out = { nick: acc.nick, token: acc.token, encKey: wrapKey(acc.encKey), kinds: acc.kinds };
	const tmp = file() + '.tmp';
	fs.writeFileSync(tmp, JSON.stringify(out), { mode: 0o600 });
	fs.renameSync(tmp, file());
}

// ---------- Шифрование ----------

function derive(nick, password) {
	const out = crypto.scryptSync(String(password), 'problet-sync-v1:' + nick.toLowerCase(), 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
	return { auth: out.subarray(0, 32).toString('base64'), encKey: Buffer.from(out.subarray(32, 64)) };
}

function encrypt(value) {
	const iv = crypto.randomBytes(12);
	const c = crypto.createCipheriv('aes-256-gcm', acc.encKey, iv);
	const data = Buffer.concat([c.update(JSON.stringify(value), 'utf8'), c.final()]);
	return JSON.stringify({ v: 1, iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') });
}

function decrypt(text) {
	try {
		const o = JSON.parse(text);
		const d = crypto.createDecipheriv('aes-256-gcm', acc.encKey, Buffer.from(o.iv, 'base64'));
		d.setAuthTag(Buffer.from(o.tag, 'base64'));
		return JSON.parse(Buffer.concat([d.update(Buffer.from(o.data, 'base64')), d.final()]).toString('utf8'));
	} catch (e) {
		throw new Error('Данные аккаунта не расшифровываются: возможно, пароль аккаунта сменили или данные повреждены');
	}
}

const hashOf = (v) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');

// ---------- Сервер ----------

async function request(method, p, body, token) {
	const headers = { 'Content-Type': 'application/json' };
	if (token) {
		headers.Authorization = 'Bearer ' + token;
		headers['X-Nick'] = acc.nick;
	}
	let res;
	try {
		res = await net.fetch(url(p), { method, headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
	} catch (e) {
		throw new Error('Сервер Problet недоступен');
	}
	let json = {};
	try {
		json = await res.json();
	} catch (e) { /* пустой ответ */ }
	if (!res.ok) {
		const err = new Error(json.error || 'Сервер ответил ' + res.status);
		err.status = res.status;
		err.rev = json.rev;
		throw err;
	}
	return json;
}

function checkCreds(nick, password) {
	if (!NICK.test(nick || '')) throw new Error('Никнейм: от 3 до 32 символов, латинские буквы, цифры и . _ -');
	if (typeof password !== 'string' || password.length < MIN_PASSWORD) throw new Error('Пароль аккаунта должен быть не короче ' + MIN_PASSWORD + ' символов');
}

async function enter(kind, nick, password) {
	const { auth, encKey } = derive(nick, password);
	const r = await request('POST', '/api/account/' + kind, { nick, auth });
	acc = { nick: r.nick || nick, token: r.token, encKey, kinds: {} };
	persist();
	info.error = '';
	info.last = 0;
	soon(500);
	return status();
}

async function register(nick, password, repeat) {
	checkCreds(nick, password);
	if (password !== repeat) throw new Error('Пароли не совпадают');
	return enter('register', nick, password);
}

async function login(nick, password) {
	checkCreds(nick, password);
	return enter('login', nick, password);
}

async function logout() {
	if (acc) {
		try {
			await request('POST', '/api/account/logout', null, acc.token);
		} catch (e) { /* сервер недоступен: токен на устройстве всё равно удаляется */ }
	}
	acc = null;
	persist();
	info.error = '';
	info.last = 0;
	return status();
}

// ---------- Синхронизация ----------

const local = {
	bookmarks: () => deps.store.syncBookmarksGet(),
	settings: () => deps.store.syncSettingsGet(),
};
const apply = {
	bookmarks: (data, mode) => deps.store.syncBookmarksApply(data, mode),
	settings: (data) => deps.store.syncSettingsApply(data),
};

async function push(kind, data, baseRev) {
	const r = await request('PUT', '/api/sync/' + kind, { baseRev, data: encrypt(data) }, acc.token);
	return r.rev;
}

// Закладки и настройки: снимок целиком
async function syncSnapshot(kind) {
	const st = acc.kinds[kind] || (acc.kinds[kind] = {});
	const remote = await request('GET', '/api/sync/' + kind, null, acc.token);
	const remoteData = remote.rev ? decrypt(remote.data) : null;
	const changed = st.hash !== undefined && hashOf(local[kind]()) !== st.hash;
	if (changed && !st.at) st.at = Date.now();
	if (!st.rev) {
		// Первая синхронизация на этом устройстве
		if (remoteData) {
			apply[kind](remoteData, kind === 'bookmarks' ? 'merge' : 'replace'); // закладки объединяются, настройки берутся из аккаунта
			if (kind === 'bookmarks') st.rev = await push(kind, local[kind](), remote.rev);
			else st.rev = remote.rev;
		} else {
			st.rev = await push(kind, local[kind](), 0);
		}
	} else if (remote.rev !== st.rev) {
		if (changed && remote.time < st.at) st.rev = await push(kind, local[kind](), remote.rev); // свежее изменение здесь
		else {
			apply[kind](remoteData, 'replace');
			st.rev = remote.rev;
		}
	} else if (changed) {
		st.rev = await push(kind, local[kind](), st.rev);
	}
	st.hash = hashOf(local[kind]());
	st.at = 0;
}

const canon = (list) => list.map((e) => ({ origin: e.origin, username: e.username, password: e.password, updated: e.updated })).sort((a, b) => (a.origin + '\n' + a.username).localeCompare(b.origin + '\n' + b.username));

// Пароли: слияние. Пока хранилище закрыто, ничего не делаем
async function syncPasswords() {
	if (!deps.vault.isUnlocked()) {
		info.passwords = 'locked';
		return;
	}
	info.passwords = '';
	const st = acc.kinds.passwords || (acc.kinds.passwords = {});
	const remote = await request('GET', '/api/sync/passwords', null, acc.token);
	const remoteList = remote.rev ? decrypt(remote.data) : [];
	deps.vault.merge(remoteList);
	const merged = canon(deps.vault.snapshot());
	if (!remote.rev || hashOf(merged) !== hashOf(canon(Array.isArray(remoteList) ? remoteList : []))) st.rev = await push('passwords', deps.vault.snapshot(), remote.rev);
	else st.rev = remote.rev;
}

async function run() {
	while (busy) await busy.catch(() => {}); // идущая проверка могла начаться до последних изменений: после неё запускаем свою
	if (!acc || deps.off()) return status();
	busy = (async () => {
		await null; // busy должен успеть получить значение до того, как заработает finally
		try {
			for (const kind of KINDS) {
				if (!deps.settings()[FLAG[kind]]) continue;
				if (kind === 'passwords') await syncPasswords();
				else await syncSnapshot(kind);
			}
			persist();
			info.error = '';
			info.last = Date.now();
		} catch (e) {
			if (e.status === 401) {
				acc = null; // сессия закончилась: нужно войти заново
				persist();
			}
			info.error = String((e && e.message) || e);
		} finally {
			busy = null;
		}
		return status();
	})();
	return busy;
}

function soon(ms = 5000) {
	if (!acc) return;
	clearTimeout(soonTimer);
	soonTimer = setTimeout(() => run().catch(() => {}), ms);
	soonTimer.unref();
}

function status() {
	return { logged: !!acc, nick: acc ? acc.nick : '', last: info.last, error: info.error, busy: !!busy, passwords: info.passwords };
}

// d: { store, vault, settings: () => настройки, off: () => безопасный режим }
function init(d) {
	deps = d;
	load();
	d.store.onChange((kind) => {
		if (kind === 'bookmarks' || kind === 'settings' || kind === 'all') soon();
	});
	timer = setInterval(() => run().catch(() => {}), EVERY);
	timer.unref();
	soon(15000);
}

module.exports = { init, status, register, login, logout, run, soon, derive, hashOf };
