// Родительский контроль: пароль, ограничение времени, ограничение сайтов, статистика.
// Живёт отдельно от профиля (см. parental-store.js): его не сбрасывают ни --user-data-dir, ни сброс настроек, ни импорт
const crypto = require('crypto');
const pstore = require('./parental-store');

const UNIT_MS = { min: 60000, h: 3600000, d: 86400000, w: 604800000 };
const LIMIT_UNITS = ['min', 'h'];
const PERIOD_UNITS = ['h', 'd', 'w'];
const MIN_PASS = 4;
const UNLOCK_MS = 10 * 60000; // после ввода пароля настройки открыты 10 минут с последнего действия
const HOSTS_LIMIT = 1000;
const ATTEMPTS_LIMIT = 500;

let data = null;
let lockdown = false; // настройки не сходятся (удалены или поправлены вне браузера): всё закрыто до ввода пароля
let timer = null;
let unlockedUntil = 0;
// Что открыли паролем: ключ сайта -> { time, site } — до какого времени действует разрешение для каждой причины.
// Открытый запрещённый сайт не обходит лимит времени, и наоборот
const grants = new Map();

function defaults() {
	return {
		on: false,
		pass: null, // { salt, hash }
		time: { on: false, limit: { n: 2, unit: 'h' }, period: { n: 1, unit: 'd' } },
		sites: { on: false, white: false, list: [] },
		usage: { start: 0, used: 0 },
		stats: { hosts: {}, attempts: [] },
	};
}

const num = (v, d, max) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.min(max, Math.round(Number(v))) : d);
function cleanSpan(raw, units, d) {
	const r = raw && typeof raw === 'object' ? raw : {};
	return { n: num(r.n, d.n, 9999), unit: units.includes(r.unit) ? r.unit : d.unit };
}
function cleanList(raw) {
	const out = [];
	for (const x of Array.isArray(raw) ? raw : []) {
		const s = String(x || '').trim().slice(0, 300);
		if (s && !out.includes(s)) out.push(s);
		if (out.length >= 2000) break;
	}
	return out;
}

function sanitize(raw) {
	const d = defaults();
	const r = raw && typeof raw === 'object' ? raw : {};
	const t = r.time && typeof r.time === 'object' ? r.time : {};
	const s = r.sites && typeof r.sites === 'object' ? r.sites : {};
	const pass = r.pass && typeof r.pass.salt === 'string' && typeof r.pass.hash === 'string' ? { salt: r.pass.salt, hash: r.pass.hash } : null;
	const st = r.stats && typeof r.stats === 'object' ? r.stats : {};
	const hosts = {};
	for (const [h, v] of Object.entries(st.hosts && typeof st.hosts === 'object' ? st.hosts : {}).slice(0, HOSTS_LIMIT)) {
		if (v && Number.isFinite(v.ms)) hosts[String(h).slice(0, 300)] = { ms: Math.max(0, v.ms), last: Number(v.last) || 0 };
	}
	const attempts = (Array.isArray(st.attempts) ? st.attempts : []).filter((a) => a && typeof a.url === 'string').slice(-ATTEMPTS_LIMIT)
		.map((a) => ({ t: Number(a.t) || 0, url: a.url.slice(0, 2000), reason: ['time', 'locked'].includes(a.reason) ? a.reason : 'site' }));
	return {
		rev: Number.isSafeInteger(r.rev) && r.rev > 0 ? r.rev : 0,
		on: r.on === true && !!pass,
		admin: r.admin === true,
		pass,
		time: { on: t.on === true, limit: cleanSpan(t.limit, LIMIT_UNITS, d.time.limit), period: cleanSpan(t.period, PERIOD_UNITS, d.time.period) },
		sites: { on: s.on === true, white: s.white === true, list: cleanList(s.list) },
		usage: { start: Number(r.usage && r.usage.start) || 0, used: Math.max(0, Number(r.usage && r.usage.used) || 0) },
		stats: { hosts, attempts },
	};
}

// Настройки без статистики: то, что лежит в копиях и в системной записи
const record = () => ({ rev: data.rev, on: data.on, admin: data.admin, pass: data.pass, time: data.time, sites: data.sites });
const isObj = (x) => !!x && typeof x === 'object';

// appData — общая папка программ пользователя; --user-data-dir её не меняет
function init(appData, name) {
	pstore.init(appData, name);
	let all = { main: null, copies: [], admin: null };
	try {
		all = pstore.readAll();
	} catch (e) { /* читать нечего */ }
	const main = isObj(all.main) ? sanitize(all.main) : null;
	const copies = all.copies.map((c) => (isObj(c) ? sanitize(c) : c));
	const admin = isObj(all.admin) ? sanitize(all.admin) : null;
	// Самая свежая подписанная запись — ей и верим
	const valid = [main, ...copies, admin].filter(isObj);
	const newest = valid.sort((a, b) => b.rev - a.rev)[0];
	if (!newest) {
		data = sanitize(null);
		return;
	}
	data = sanitize({ ...newest, usage: main ? main.usage : null, stats: main ? main.stats : null });
	if (main && main.rev === newest.rev) data = main;
	const same = (r) => isObj(r) && r.rev === newest.rev && r.on === newest.on;
	const samePass = (r) => isObj(r) && r.pass && newest.pass && r.pass.hash === newest.pass.hash;
	if (newest.on) {
		// Включённый контроль обязан быть одинаковым везде
		if (!same(main) || !copies.every(same)) lockdown = true;
		if (newest.admin && !(admin && admin.on && samePass(admin))) lockdown = true;
	}
	if (admin && admin.on && !(newest.on && samePass(admin))) lockdown = true; // системная запись говорит «включено», а в файлах иначе
	if (lockdown) data.on = true;
}

function save() {
	clearTimeout(timer);
	timer = null;
	try {
		pstore.saveMain(data);
	} catch (e) {
		console.error('Не удалось сохранить родительский контроль:', e.message);
	}
}
// Поменялись сами настройки: новая версия везде — в основном файле и в копиях
function saveAll() {
	data.rev++;
	save();
	pstore.saveCopies(record());
}
function scheduleSave(delay = 2000) {
	if (!timer) timer = setTimeout(save, delay);
}
function flush() {
	if (timer) save();
}

const isOn = () => !!(data && (data.on || lockdown));
const isLocked = () => lockdown;

// ---------- Пароль ----------
const hashOf = (pw, salt) => crypto.scryptSync(String(pw), Buffer.from(salt, 'hex'), 32).toString('hex');
function checkPass(pw) {
	if (!data.pass || typeof pw !== 'string') return false;
	const a = Buffer.from(hashOf(pw, data.pass.salt), 'hex');
	const b = Buffer.from(data.pass.hash, 'hex');
	return a.length === b.length && crypto.timingSafeEqual(a, b);
}
let lastWrong = 0;
function verify(pw) {
	if (Date.now() - lastWrong < 1000) throw new Error('Подожди секунду');
	if (!checkPass(pw)) {
		lastWrong = Date.now();
		throw new Error('Неверный пароль');
	}
}
function createPass(pw) {
	if (data.pass) throw new Error('Пароль уже есть');
	if (typeof pw !== 'string' || pw.length < MIN_PASS) throw new Error('Пароль слишком короткий');
	const salt = crypto.randomBytes(16).toString('hex');
	data.pass = { salt, hash: hashOf(pw, salt) };
}
// Пароль после запирания: переписываем все копии из самой свежей подписанной записи и открываем браузер
function recover(pw) {
	verify(pw);
	if (data.admin && !isObj(pstore.unpack(readAdmin()))) data.admin = false; // системной записи нет — защита снята, включить её можно заново
	lockdown = false;
	saveAll();
	unlockedUntil = Date.now() + UNLOCK_MS;
}
function readAdmin() {
	try {
		return require('fs').readFileSync(pstore.adminFile(), 'utf8');
	} catch (e) {
		return null;
	}
}
function unlock(pw) {
	if (lockdown) return recover(pw);
	verify(pw);
	unlockedUntil = Date.now() + UNLOCK_MS;
}
function isUnlocked() {
	if (lockdown) return false;
	if (!data.pass) return true; // пароля ещё нет — закрывать нечего
	if (Date.now() > unlockedUntil) return false;
	unlockedUntil = Date.now() + UNLOCK_MS;
	return true;
}
function requireUnlocked() {
	if (!isUnlocked()) throw new Error('Нужен пароль родительского контроля');
}

// Включение и выключение: первый раз пароль создаётся, потом его надо ввести.
// Выключение под защитой администратора сначала убирает системную запись (спросит права)
async function setOn(on, pw) {
	if (lockdown) throw new Error('Нужен пароль родительского контроля');
	if (!data.pass) {
		if (!on) return;
		createPass(pw);
	} else verify(pw);
	if (!on && data.admin) {
		await pstore.writeAdmin(null);
		data.admin = false;
	}
	data.on = !!on;
	unlockedUntil = Date.now() + UNLOCK_MS;
	if (!on) grants.clear();
	saveAll();
}

// Защита правами администратора: системная запись, которую без прав не удалить и не изменить
async function setAdmin(on) {
	requireUnlocked();
	if (!data.on) throw new Error('Сначала включи родительский контроль');
	if (!!on === data.admin) return;
	if (on) {
		const next = { ...record(), rev: data.rev + 1, admin: true };
		await pstore.writeAdmin(pstore.pack(next));
		data.admin = true;
	} else {
		await pstore.writeAdmin(null);
		data.admin = false;
	}
	saveAll();
}

function publicConfig() {
	return { on: data.on, admin: data.admin, time: data.time, sites: data.sites };
}
function setConfig(patch) {
	requireUnlocked();
	const p = patch && typeof patch === 'object' ? patch : {};
	const next = sanitize({ ...data, time: { ...data.time, ...(p.time || {}) }, sites: { ...data.sites, ...(p.sites || {}) } });
	data.time = next.time;
	data.sites = next.sites;
	saveAll();
}

// ---------- Время ----------
// Промежутки отсчитываются по местным часам: дни с полуночи, недели с понедельника, часы от полуночи
function periodStart(now = Date.now()) {
	const len = data.time.period.n * UNIT_MS[data.time.period.unit];
	const off = new Date(now).getTimezoneOffset() * 60000;
	const shift = data.time.period.unit === 'w' ? 4 * 86400000 : 0; // 1 января 1970 — четверг
	const local = now - off + shift;
	return local - (local % len) - shift + off;
}
const limitMs = () => data.time.limit.n * UNIT_MS[data.time.limit.unit];
function usedNow() {
	const start = periodStart();
	if (data.usage.start !== start) {
		data.usage = { start, used: 0 };
		for (const g of grants.values()) g.time = 0; // открытое на этот промежуток больше не действует
	}
	return data.usage.used;
}
const timeOver = () => data.on && data.time.on && usedNow() >= limitMs();

// Прошло ms активного пользования (окно в фокусе или играет звук) на сайте key. Возвращает true, если лимит только что исчерпан
function tick(ms, key) {
	if (!data.on) return false;
	const before = timeOver();
	usedNow();
	data.usage.used += ms;
	if (key) {
		const h = data.stats.hosts[key] || (data.stats.hosts[key] = { ms: 0, last: 0 });
		h.ms += ms;
		h.last = Date.now();
		const keys = Object.keys(data.stats.hosts);
		if (keys.length > HOSTS_LIMIT) {
			keys.sort((a, b) => data.stats.hosts[a].last - data.stats.hosts[b].last);
			for (const k of keys.slice(0, keys.length - HOSTS_LIMIT)) delete data.stats.hosts[k];
		}
	}
	scheduleSave(10000);
	return !before && timeOver();
}

// ---------- Сайты ----------
// Ключ сайта: хост для http(s), problet://имя для страниц браузера, file:// для файлов
function keyOf(url) {
	try {
		const u = new URL(String(url));
		if (u.protocol === 'http:' || u.protocol === 'https:') return u.hostname.toLowerCase().replace(/^www\./, '');
		if (u.protocol === 'problet:') return 'problet://' + u.host.toLowerCase();
		if (u.protocol === 'file:') return 'file://';
	} catch (e) { /* не адрес */ }
	return '';
}
// Что вообще подлежит проверке: сайты, файлы и страницы Problet, кроме самой страницы блокировки и служебных
const EXEMPT = new Set(['problet://parental', 'problet://ui', 'problet://blocked', 'problet://pwfill', 'problet://pwsave', 'problet://bmstar', 'problet://folder']);
function checkable(url) {
	const k = keyOf(url);
	return k && !EXEMPT.has(k) ? k : '';
}

// Строка списка: «youtube.com» (с поддоменами), «youtube.com/shorts» (адреса с этого пути), «problet://settings», «file://»
function matchEntry(entry, url) {
	const e = String(entry).trim().toLowerCase();
	if (!e) return false;
	let u;
	try {
		u = new URL(String(url));
	} catch (err) {
		return false;
	}
	if (e.startsWith('problet://')) return u.protocol === 'problet:' && u.host.toLowerCase() === e.slice(10).replace(/\/.*$/, '');
	if (e.startsWith('file://')) return u.protocol === 'file:';
	if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
	const m = /^(?:https?:\/\/)?(?:www\.)?([^/?#]+)(\/[^?#]*)?/.exec(e);
	if (!m) return false;
	const host = u.hostname.toLowerCase();
	const okHost = host === m[1] || host.endsWith('.' + m[1]);
	return okHost && (!m[2] || u.pathname.toLowerCase().startsWith(m[2]));
}

function siteBlocked(url) {
	if (!data.on || !data.sites.on) return false;
	const listed = data.sites.list.some((e) => matchEntry(e, url));
	if (!data.sites.white) return listed;
	if (keyOf(url).startsWith('problet://')) return false; // белый список страницы Problet не трогает
	return !listed;
}

// Почему адрес нельзя открыть: 'time', 'site' или null
function check(url) {
	if (!data || !data.on) return null;
	const k = checkable(url);
	if (!k) return null;
	if (lockdown) return 'locked';
	const g = grants.get(k) || { time: 0, site: 0 };
	const now = Date.now();
	if (timeOver() && g.time <= now) return 'time';
	if (siteBlocked(url) && g.site <= now) return 'site';
	return null;
}

function recordAttempt(url, reason) {
	const list = data.stats.attempts;
	const last = list[list.length - 1];
	if (last && last.url === url && Date.now() - last.t < 5000) return; // одна попытка, а не каждое обновление
	list.push({ t: Date.now(), url: String(url).slice(0, 2000), reason });
	if (list.length > ATTEMPTS_LIMIT) list.splice(0, list.length - ATTEMPTS_LIMIT);
	scheduleSave();
}

// Кнопка «Войти» на странице блокировки: сайт открывается, лимит не сбрасывается.
// Открытое при исчерпанном времени действует до конца промежутка, открытый запрещённый сайт — до закрытия браузера
function enter(url, pw, reason) {
	if (lockdown) return recover(pw);
	verify(pw);
	const k = checkable(url);
	if (!k) return;
	const g = grants.get(k) || { time: 0, site: 0 };
	if (reason === 'time') g.time = periodStart() + data.time.period.n * UNIT_MS[data.time.period.unit];
	else g.site = Infinity;
	grants.set(k, g);
}

function status() {
	return { on: data.on || lockdown, locked: lockdown, hasPass: !!data.pass, unlocked: !lockdown && (data.pass ? Date.now() <= unlockedUntil : true), minPass: MIN_PASS, adminPath: pstore.adminFile() };
}
function info() {
	return { used: data.time.on ? usedNow() : 0, limit: limitMs(), timeOn: data.on && data.time.on, periodEnd: periodStart() + data.time.period.n * UNIT_MS[data.time.period.unit] };
}
function stats() {
	requireUnlocked();
	const hosts = Object.entries(data.stats.hosts).map(([key, v]) => ({ key, ms: v.ms, last: v.last })).sort((a, b) => b.ms - a.ms);
	return { ...info(), hosts, attempts: data.stats.attempts.slice().reverse() };
}

// Аргументы командной строки, которыми можно обойти контроль: управление браузером снаружи, отладчик главного процесса, режим без окна
const BLOCKED_SWITCHES = ['remote-debugging-port', 'remote-debugging-pipe', 'remote-debugging-address', 'remote-allow-origins', 'inspect', 'inspect-brk', 'inspect-port', 'inspect-publish-uid', 'debug', 'debug-brk', 'headless', 'eval', 'fetch'];
function badArgs(argv) {
	return argv.filter((a) => {
		const m = /^--?([\w-]+)/.exec(a);
		return m && BLOCKED_SWITCHES.includes(m[1].toLowerCase());
	});
}

module.exports = { init, flush, isOn, isLocked, status, setOn, setAdmin, unlock, isUnlocked, publicConfig, setConfig, tick, check, keyOf, checkable, recordAttempt, enter, info, stats, badArgs, BLOCKED_SWITCHES, MIN_PASS };
