// Кеш: сколько хранить и что вообще кешировать.
// Chromium сам решает, что класть в кеш, поэтому категории выключаем через заголовки запросов и ответов.

const HOUR = 3600 * 1000;
const PERIODS = { hour: HOUR, day: 24 * HOUR, week: 7 * 24 * HOUR, month: 30 * 24 * HOUR };
const PAGE_TYPES = new Set(['mainFrame', 'subFrame', 'stylesheet', 'script', 'font']);
const URLS = ['http://*/*', 'https://*/*'];
const CHECK_INTERVAL = 60 * 1000;

const iconUrls = new Set(); // адреса значков сайтов, о которых нам сообщили страницы

let ses = null;
let store = null;

function categoryOf(details) {
	if (details.resourceType === 'image') {
		const isIcon = iconUrls.has(details.url) || /\/favicon\.ico(\?|#|$)/i.test(details.url);
		return isIcon ? 'icons' : 'images';
	}
	return PAGE_TYPES.has(details.resourceType) ? 'pages' : null;
}

function isCached(settings, category) {
	if (category === 'icons') return settings.cacheIcons;
	if (category === 'images') return settings.cacheImages;
	return settings.cachePages;
}

function addIcon(url) {
	if (typeof url !== 'string') return;
	if (iconUrls.size > 5000) iconUrls.clear();
	iconUrls.add(url);
}

// Запрос: просим не брать из кеша, если категория выключена (headers изменяется на месте)
function tweakRequest(details, headers) {
	const category = categoryOf(details);
	if (category && !isCached(store.getSettings(), category)) {
		headers['Cache-Control'] = 'no-cache';
		headers.Pragma = 'no-cache';
	}
}

function install() {
	// Ответ: просим не сохранять в кеш (заголовки запроса правит tweakRequest, его вызывает identity-слой в main.js)
	ses.webRequest.onHeadersReceived({ urls: URLS }, (details, callback) => {
		const category = categoryOf(details);
		if (!category || isCached(store.getSettings(), category)) {
			callback({});
			return;
		}
		const headers = {};
		for (const [name, value] of Object.entries(details.responseHeaders || {})) {
			if (!['cache-control', 'expires', 'pragma'].includes(name.toLowerCase())) headers[name] = value;
		}
		headers['Cache-Control'] = ['no-store'];
		callback({ responseHeaders: headers });
	});
}

async function clearNow() {
	await ses.clearCache();
	try {
		await ses.clearCodeCaches({});
	} catch (e) { /* не критично */ }
	store.setCacheClearedAt(Date.now());
}

// Если с последней очистки прошёл выбранный срок, кеш очищается целиком
function checkRetention() {
	const mode = store.getSettings().cacheKeep;
	const period = PERIODS[mode];
	if (!period) return false;
	if (Date.now() - store.getCacheClearedAt() < period) return false;
	clearNow().catch(() => {});
	return true;
}

function start(session, storeApi) {
	ses = session;
	store = storeApi;
	install();
	if (!store.getCacheClearedAt()) store.setCacheClearedAt(Date.now());
	if (store.getSettings().cacheKeep === 'restart') clearNow().catch(() => {});
	else checkRetention();
	setInterval(checkRetention, CHECK_INTERVAL).unref();
}

module.exports = { start, tweakRequest, addIcon, clearNow, checkRetention, categoryOf, PERIODS };
