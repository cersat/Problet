// «Маскироваться под браузер», «Скрывать метаданные системы» и Do Not Track.
// Меняем: заголовок User-Agent, заголовки Sec-CH-UA*, а для страниц ещё navigator.userAgentData и несколько полей navigator (см. preload-page.js).
// Маскировка отвечает только за то, каким браузером представляться; система и железо — отдельная настройка hide

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
// plain: для сайтов-определителей браузера — в строке только Problet (без Chrome и движка).
// hide: «Скрывать метаданные системы» — ни системы, ни железа ни в строке, ни в заголовках, ни в navigator
function build(kind, appVersion, plain, hide) {
	const appMajor = String(appVersion || '0').split('.')[0];
	const sys = hide ? '' : '(' + platform.ua + ') ';
	const platformName = hide ? '' : platform.name;
	const chromeUa = 'Mozilla/5.0 ' + sys + 'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/' + chromeMajor + '.0.0.0 Safari/537.36';
	if (kind === 'firefox') {
		const ff = FIREFOX;
		const os = process.platform === 'darwin' ? 'Macintosh; Intel Mac OS X 10.15' : platform.ua;
		return {
			kind,
			userAgent: 'Mozilla/5.0 (' + (hide ? '' : os + '; ') + 'rv:' + ff + ') Gecko/20100101 Firefox/' + ff,
			brands: null, // у Firefox нет Client Hints
			fullBrands: null,
			platform: platformName,
			full: ff,
			hide: !!hide,
		};
	}
	if (kind === 'chrome') {
		return {
			kind,
			userAgent: chromeUa,
			brands: [GREASE, { brand: 'Chromium', version: chromeMajor }, { brand: 'Google Chrome', version: chromeMajor }],
			fullBrands: [{ brand: GREASE.brand, version: '99.0.0.0' }, { brand: 'Chromium', version: chromeFull }, { brand: 'Google Chrome', version: chromeFull }],
			platform: platformName,
			full: chromeFull,
			hide: !!hide,
		};
	}
	if (plain) {
		return {
			kind: 'problet',
			userAgent: 'Problet/' + (appVersion || '0'),
			brands: [{ brand: 'Problet', version: appMajor }],
			fullBrands: [{ brand: 'Problet', version: appVersion || '0' }],
			platform: platformName,
			full: appVersion || '0',
			plain: true,
			hide: !!hide,
		};
	}
	return {
		kind: 'problet',
		userAgent: chromeUa + ' Problet/' + (appVersion || '0'),
		brands: [GREASE, { brand: 'Chromium', version: chromeMajor }, { brand: 'Problet', version: appMajor }],
		fullBrands: [{ brand: GREASE.brand, version: '99.0.0.0' }, { brand: 'Chromium', version: chromeFull }, { brand: 'Problet', version: appVersion || '0' }],
		platform: platformName,
		full: chromeFull,
		hide: !!hide,
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
			else if (profile.hide && !['sec-ch-ua', 'sec-ch-ua-full-version-list', 'sec-ch-ua-full-version'].includes(l)) delete headers[key]; // система, архитектура, модель, разрядность, «мобильный»
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
	return { kind: profile.kind, brands: profile.brands, fullBrands: profile.fullBrands, platform: profile.platform, full: profile.full, dnt: !!dnt, userAgent: profile.plain || profile.hide ? profile.userAgent : null, hide: !!profile.hide };
}

module.exports = { PROFILES, build, applyHeaders, pagePayload, fmt };
