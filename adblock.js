// Блокировщик рекламы и трекеров: запрос отменяется, если его хост (или любой родительский домен) есть в blocklist.txt.
// Сам адрес страницы (переход по ссылке) не блокируется, только то, что страница подгружает: скрипты, картинки, фреймы, запросы.

const fs = require('fs');
const path = require('path');

const URLS = ['http://*/*', 'https://*/*'];

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
const BLOCKED = {
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

function start(session, store) {
	if (!domains.size) load();
	session.webRequest.onBeforeRequest({ urls: URLS }, (details, callback) => {
		if (store.getSettings().adblock && isBlocked(details)) {
			blocked++;
			store.addBlocked();
			const url = replacement(details.resourceType);
			callback(url ? { redirectURL: url } : { cancel: true });
		} else {
			callback({});
		}
	});
}

// Что пролезло мимо запретов по адресам, прячем на странице: блоки Google AdSense, рекламные места Ad Manager и рекламу в выдаче Google
const COSMETIC_CSS = [
	'ins.adsbygoogle', '.adsbygoogle', 'iframe[id^="google_ads_iframe"]', 'iframe[src*="googlesyndication.com"]', 'iframe[src*="doubleclick.net"]',
	'div[id^="div-gpt-ad"]', 'div[id^="google_ads_"]', 'amp-ad', 'amp-embed[type="adsense"]',
	'#tads', '#tadsb', '#bottomads', '#taw[data-text-ad]', 'div[data-text-ad]', 'div[data-ad-slot]',
].join(',\n') + ' { display: none !important; }';

const blockedCount = () => blocked;

module.exports = { COSMETIC_CSS, blockedResponse, start, load, isBlocked, isBlockedHost, blockedCount };
