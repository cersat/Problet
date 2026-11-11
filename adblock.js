// Блокировщик рекламы и трекеров: запрос отменяется, если его хост (или любой родительский домен) есть в blocklist.txt.
// Сам адрес страницы (переход по ссылке) не блокируется, только то, что страница подгружает: скрипты, картинки, фреймы, запросы.

const fs = require('fs');
const { fileURLToPath } = require('url');
const path = require('path');

const URLS = ['http://*/*', 'https://*/*', 'file:///*'];

let blocked = 0;
let domains = new Set();
let pathRules = []; // { host, part }
let allowed = new Set(); // домены-исключения: их не блокируем, даже если они есть в списках

function load(dir = __dirname) {
	domains = new Set();
	for (const line of fs.readFileSync(path.join(dir, 'blocklist.txt'), 'utf8').split('\n')) {
		const d = line.trim().toLowerCase();
		if (d && !d.startsWith('#')) domains.add(d);
	}
	allowed = new Set();
	for (const line of fs.readFileSync(path.join(dir, 'allowlist.txt'), 'utf8').split('\n')) {
		const d = line.trim().toLowerCase();
		if (d && !d.startsWith('#')) allowed.add(d);
	}
	pathRules = [];
	for (const line of fs.readFileSync(path.join(dir, 'blocklist-paths.txt'), 'utf8').split('\n')) {
		const [host, part] = line.trim().split('|');
		if (host && part && !host.startsWith('#')) pathRules.push({ host: host.toLowerCase(), part });
	}
	return domains.size + pathRules.length;
}

function isAllowedHost(host) {
	let h = String(host).toLowerCase().replace(/\.$/, '');
	for (;;) {
		if (allowed.has(h)) return true;
		const dot = h.indexOf('.');
		if (dot < 0) return false;
		h = h.slice(dot + 1);
	}
}

function isBlockedHost(host) {
	if (isAllowedHost(host)) return false;
	let h = String(host).toLowerCase().replace(/\.$/, '');
	if (/^adservice\.google\.[a-z.]+$/.test(h)) return true; // adservice.google.<любая страна>
	for (;;) {
		if (domains.has(h)) return true;
		const dot = h.indexOf('.');
		if (dot < 0) return false;
		h = h.slice(dot + 1);
		if (!h.includes('.')) return false; // голые TLD не проверяем
	}
}

// Адреса YouTube: на них реклама блокируется только при включённом переключателе
const isYoutubeHost = (h) => /(^|\.)(youtube\.com|youtube-nocookie\.com|youtu\.be|googlevideo\.com|ytimg\.com)$/.test(String(h).toLowerCase());

// Запрос идёт со страницы YouTube (или к самому YouTube)
function fromYoutube(details) {
	try {
		if (isYoutubeHost(new URL(details.url).hostname)) return true;
		if (details.referrer && isYoutubeHost(new URL(details.referrer).hostname)) return true;
		const wc = details.webContents;
		if (wc && !wc.isDestroyed() && isYoutubeHost(new URL(wc.getURL()).hostname)) return true;
	} catch (e) { /* адрес не разобрался — считаем обычным запросом */ }
	return false;
}

function isBlocked(details) {
	if (details.resourceType === 'mainFrame') return false;
	try {
		const u = new URL(details.url);
		if (isAllowedHost(u.hostname)) return false;
		if (isBlockedHost(u.hostname)) return true;
		const host = u.hostname.toLowerCase();
		const rest = u.pathname + u.search;
		return pathRules.some((r) => (host === r.host || host.endsWith('.' + r.host)) && (r.part.startsWith('~') ? rest.includes(r.part.slice(1)) : rest.startsWith(r.part)));
	} catch (e) {
		return false;
	}
}

// Вместо пустоты отдаём заглушку «Реклама заблокирована»: картинку для картинок, страницу для рамок, пустышки для скриптов и стилей.
// Редирект на data: Chromium запрещает, поэтому отдаём их по своему адресу problet://blocked/ (его обрабатывает main.js через blockedResponse)
const TEXT = 'Реклама заблокирована';
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="100" viewBox="0 0 300 100">'
	+ '<rect width="300" height="100" fill="#ececf2" stroke="#c9c9d6" stroke-width="2"/>'
	+ '<text x="150" y="56" text-anchor="middle" font-family="sans-serif" font-size="18" fill="#6b6b7b">' + TEXT + '</text></svg>';
const FRAME = '<!doctype html><meta charset="utf-8"><body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;'
	+ 'background:#ececf2;color:#6b6b7b;font:14px sans-serif;overflow:hidden">' + TEXT;
// Загрузчик антиблокировщика Ad-Shield (html-load.com): настоящий возвращает рекламу, а без ответа сайт показывает окно «отключите блокировщик».
// Подставляем скрипт, который только отвечает на проверку страницы («..._as_req» → «..._as_res»), и больше ничего не делает.
const ADSHIELD_JS = "addEventListener('message',function(e){var d=e.data;if(typeof d==='string'&&d.slice(-7)==='_as_req')postMessage(d.slice(0,-7)+'_as_res','*')});";
const isAdShieldHost = (h) => /(^|\.)html-load\.(com|cc)$/.test(String(h).toLowerCase());

const BLOCKED = {
	'adshield.js': ['text/javascript', ADSHIELD_JS],
	'image.svg': ['image/svg+xml', SVG],
	'frame.html': ['text/html; charset=utf-8', FRAME],
	'empty.js': ['text/javascript', ''],
	'empty.css': ['text/css', ''],
};

function blockedResponse(name) {
	const entry = BLOCKED[name];
	return entry ? new Response(entry[1], { headers: { 'Content-Type': entry[0] } }) : null;
}

function replacement(type) {
	if (type === 'image') return 'problet://blocked/image.svg';
	if (type === 'subFrame') return 'problet://blocked/frame.html';
	if (type === 'script') return 'problet://blocked/empty.js';
	if (type === 'stylesheet') return 'problet://blocked/empty.css';
	return null;
}

// Свои правила пользователя (настройка customBlock): домен блокирует и поддомены, адрес с путём — всё, что с него начинается
let customText = null;
let customDomains = new Set();
let customPaths = [];

function parseCustom(text) {
	customText = text;
	customDomains = new Set();
	customPaths = [];
	for (const raw of String(text).split('\n')) {
		let line = raw.trim().toLowerCase();
		if (!line || line.startsWith('#')) continue;
		line = line.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/^\*\./, '').replace(/[?#].*$/, '');
		const slash = line.indexOf('/');
		const host = (slash < 0 ? line : line.slice(0, slash)).replace(/:\d+$/, '').replace(/\.$/, '');
		const rest = slash < 0 ? '' : line.slice(slash);
		if (!host) continue;
		if (rest.length > 1) customPaths.push({ host, part: rest });
		else customDomains.add(host);
	}
}

function isCustomBlocked(url, text) {
	if (text !== customText) parseCustom(text);
	if (!customDomains.size && !customPaths.length) return false;
	try {
		const u = new URL(url);
		const host = u.hostname.toLowerCase().replace(/\.$/, '');
		const under = (rule) => host === rule || host.endsWith('.' + rule);
		for (const d of customDomains) if (under(d)) return true;
		const rest = u.pathname + u.search;
		return customPaths.some((r) => under(r.host) && rest.startsWith(r.part));
	} catch (e) {
		return false;
	}
}

// Предупреждение о http://: локальные адреса и частные сети не трогаем. Разрешённые вручную сайты запоминаются до закрытия программы
const insecureOk = new Set();
const allowInsecure = (host) => { insecureOk.add(String(host).toLowerCase()); };

function isLocalHost(h) {
	h = String(h).toLowerCase().replace(/^\[|\]$/g, '');
	if (!h.includes('.') && !h.includes(':')) return true; // localhost и имена без точки
	if (h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.lan') || h.endsWith('.internal')) return true;
	if (h.includes(':')) return h === '::1' || /^f[cd]/.test(h) || /^fe80/.test(h);
	const m = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(h);
	if (!m) return false;
	const a = Number(m[1]);
	const b = Number(m[2]);
	return a === 10 || a === 127 || a === 0 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
}

function insecureRedirect(details) {
	try {
		const u = new URL(details.url);
		if (u.protocol !== 'http:' || isLocalHost(u.hostname) || insecureOk.has(u.hostname.toLowerCase())) return null;
		return 'problet://insecure/?u=' + encodeURIComponent(u.href);
	} catch (e) {
		return null;
	}
}

// Локальные файлы: папка открывается проводником, svg — редактором (адрес с ?view показывает файл как есть)
function localRedirect(details) {
	try {
		const u = new URL(details.url);
		if (u.protocol !== 'file:') return null;
		const file = fileURLToPath(u);
		if (fs.statSync(file).isDirectory()) return 'problet://files/?p=' + encodeURIComponent(file);
		if (/\.svg$/i.test(file) && !u.searchParams.has('view')) return 'problet://svgedit/?p=' + encodeURIComponent(file);
	} catch (e) { /* нет такого файла: пусть покажет обычную ошибку */ }
	return null;
}

let observer = null;
const observe = (fn) => { observer = fn; }; // сообщает о каждом запросе и о том, заблокирован ли он (режим без окна)

function start(session, store) {
	if (!domains.size) load();
	session.webRequest.onBeforeRequest({ urls: URLS }, (details, callback) => {
		const s = store.getSettings();
		if (details.resourceType === 'mainFrame') {
			const to = localRedirect(details);
			if (to) {
				callback({ redirectURL: to });
				return;
			}
		}
		if (s.warnInsecure && details.resourceType === 'mainFrame') {
			const to = insecureRedirect(details);
			if (to) {
				callback({ redirectURL: to });
				return;
			}
		}
		const block = s.adblock && details.resourceType !== 'mainFrame' && ((isBlocked(details) && (s.adblockYoutube || !fromYoutube(details))) || isCustomBlocked(details.url, s.customBlock));
		let host = '';
		try {
			host = new URL(details.url).hostname;
		} catch (e) { /* адрес не разобрался */ }
		if (s.adblock && isAdShieldHost(host)) {
			if (observer) observer({ host, type: details.resourceType, blocked: true });
			blocked++;
			store.addBlocked();
			const url = details.resourceType === 'script' ? 'problet://blocked/adshield.js' : replacement(details.resourceType);
			callback(url ? { redirectURL: url } : { cancel: true });
			return;
		}
		if (observer) {
			try {
				observer({ host: new URL(details.url).hostname, type: details.resourceType, blocked: !!block });
			} catch (e) { /* адрес не разобрался */ }
		}
		if (block) {
			blocked++;
			store.addBlocked();
			const url = replacement(details.resourceType);
			callback(url && s.adblockStub ? { redirectURL: url } : { cancel: true });
		} else {
			callback({});
		}
	});
}

// Что пролезло мимо запретов по адресам, прячем на странице: блоки Google AdSense, рекламные места Ad Manager, рекламу в выдаче Google и блоки с типовыми рекламными именами
const COSMETIC_CSS = [
	'ins.adsbygoogle', '.adsbygoogle', 'iframe[id^="google_ads_iframe"]', 'iframe[src*="googlesyndication.com"]', 'iframe[src*="doubleclick.net"]',
	'div[id^="div-gpt-ad"]', 'div[id^="google_ads_"]', 'amp-ad', 'amp-embed[type="adsense"]',
	// Типовые имена рекламных блоков (как в общих списках EasyList); «ad» и «ads» только у div, чтобы не задеть ссылки и подписи
	'div.ad', 'div.ads', '.adsbox', '.ad-banner', '.banner_ad', '.ad-container', '.ad-placeholder', '.advert', '.advertisement', '.sponsored-ad', '.google-ad',
	'#ad_300x250', '#banner-ad', '.top-ad-slot', '.pub_300x250', '.pub_300x250m', '.pub_728x90', '.text-ad', '.textAd', '.text_ad', '.text_ads', '.text-ads', '.text-ad-links',
	'#tads', '#tadsb', '#bottomads', '#taw[data-text-ad]', 'div[data-text-ad]', 'div[data-ad-slot]',
].join(',\n') + ' { display: none !important; }';

const blockedCount = () => blocked;

module.exports = { localRedirect, allowInsecure, isCustomBlocked, insecureRedirect, observe, isYoutubeHost, COSMETIC_CSS, blockedResponse, start, load, isBlocked, isBlockedHost, blockedCount };
