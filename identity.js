// «Маскироваться под браузер» и Do Not Track.
// Меняем: заголовок User-Agent, заголовки Sec-CH-UA*, а для страниц ещё navigator.userAgentData и несколько полей navigator (см. preload-page.js)

const PROFILES = ['chrome', 'problet', 'firefox'];

const platform = {
	linux: { ua: 'X11; Linux x86_64', name: 'Linux' },
	win32: { ua: 'Windows NT 10.0; Win64; x64', name: 'Windows' },
	darwin: { ua: 'Macintosh; Intel Mac OS X 10_15_7', name: 'macOS' },
}[process.platform] || { ua: 'X11; Linux x86_64', name: 'Linux' };

// Chrome: версия настоящего движка (Chromium из Electron), поэтому заявленное совпадает с реальным.
// Firefox: актуальная стабильная версия, движок при этом всё равно Chromium
const CHROME_FULL = /^\d+\.\d+\.\d+\.\d+$/.test(process.versions.chrome || '') ? process.versions.chrome : '156.0.0.0';
const FIREFOX = '159.0';
const chromeFull = CHROME_FULL;
const chromeMajor = chromeFull.split('.')[0];
const GREASE = { brand: 'Not?A_Brand', version: '99' };

const fmt = (list) => list.map((b) => '"' + b.brand + '";v="' + b.version + '"').join(', ');

// appVersion передаём снаружи, чтобы не тянуть electron в тесты
// plain: для сайтов-определителей браузера из UA убираем Chrome, остаётся только Problet
function build(kind, appVersion, plain) {
	const appMajor = String(appVersion || '0').split('.')[0];
	const chromeUa = 'Mozilla/5.0 (' + platform.ua + ') AppleWebKit/537.36 (KHTML, like Gecko) Chrome/' + chromeMajor + '.0.0.0 Safari/537.36';
	if (kind === 'firefox') {
		const ff = FIREFOX;
		const os = process.platform === 'darwin' ? 'Macintosh; Intel Mac OS X 10.15' : platform.ua;
		return {
			kind,
			userAgent: 'Mozilla/5.0 (' + os + '; rv:' + ff + ') Gecko/20100101 Firefox/' + ff,
			brands: null, // у Firefox нет Client Hints
			fullBrands: null,
			platform: platform.name,
			full: ff,
		};
	}
	if (kind === 'chrome') {
		return {
			kind,
			userAgent: chromeUa,
			brands: [GREASE, { brand: 'Chromium', version: chromeMajor }, { brand: 'Google Chrome', version: chromeMajor }],
			fullBrands: [{ brand: GREASE.brand, version: '99.0.0.0' }, { brand: 'Chromium', version: chromeFull }, { brand: 'Google Chrome', version: chromeFull }],
			platform: platform.name,
			full: chromeFull,
		};
	}
	if (plain) {
		return {
			kind: 'problet',
			userAgent: 'Mozilla/5.0 (' + platform.ua + ') AppleWebKit/537.36 (KHTML, like Gecko) Problet/' + (appVersion || '0') + ' Safari/537.36',
			brands: [GREASE, { brand: 'Problet', version: appMajor }],
			fullBrands: [{ brand: GREASE.brand, version: '99.0.0.0' }, { brand: 'Problet', version: appVersion || '0' }],
			platform: platform.name,
			full: appVersion || '0',
			plain: true,
		};
	}
	return {
		kind: 'problet',
		userAgent: chromeUa + ' Problet/' + (appVersion || '0'),
		brands: [GREASE, { brand: 'Chromium', version: chromeMajor }, { brand: 'Problet', version: appMajor }],
		fullBrands: [{ brand: GREASE.brand, version: '99.0.0.0' }, { brand: 'Chromium', version: chromeFull }, { brand: 'Problet', version: appVersion || '0' }],
		platform: platform.name,
		full: chromeFull,
	};
}

// Подменяет заголовки запроса (headers изменяется на месте)
function applyHeaders(headers, profile, dnt) {
	for (const key of Object.keys(headers)) {
		const l = key.toLowerCase();
		if (l === 'user-agent') {
			headers[key] = profile.userAgent;
		} else if (l.startsWith('sec-ch-ua')) {
			if (!profile.brands) delete headers[key];
			else if (l === 'sec-ch-ua') headers[key] = fmt(profile.brands);
			else if (l === 'sec-ch-ua-full-version-list') headers[key] = fmt(profile.fullBrands);
			else if (l === 'sec-ch-ua-full-version') headers[key] = '"' + profile.full + '"';
		}
	}
	if (dnt) headers.DNT = '1';
	return headers;
}

// Что страница увидит в navigator (preload подставляет это в основной мир)
function pagePayload(profile, dnt) {
	return { kind: profile.kind, brands: profile.brands, fullBrands: profile.fullBrands, platform: profile.platform, full: profile.full, dnt: !!dnt, userAgent: profile.plain ? profile.userAgent : null };
}

module.exports = { PROFILES, build, applyHeaders, pagePayload, fmt };
