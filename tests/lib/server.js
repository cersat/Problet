// Локальный сайт для тестов: страницы, формы входа и регистрации, «реклама», скачивания, аддон
const http = require('http');

const page = (title, body) => '<!doctype html><html><head><meta charset="utf-8"><title>' + title + '</title></head><body>' + body + '</body></html>';
const ROUTES = {
	'/': () => page('Сайт', '<h1 id="h">сайт</h1><a id="link" href="/b">дальше</a><script src="/ads/banner.js"></script><script src="/ok.js"></script>'),
	'/a': () => page('A', '<p id="p">страница A</p>'),
	'/cached': () => page('Кеш', '<img src="/pic.svg">'),
	'/pic.svg': (res) => {
		res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'max-age=3600' });
		res.end('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>');
	},
	'/b': () => page('B', '<p id="p">страница B</p>'),
	'/long': () => page('Длинная', '<div style="height:5000px">' + 'слово '.repeat(2000) + '</div><p id="needle">иголка</p>'),
	'/find': () => page('Поиск', '<p>кот и ещё один кот, и третий кот</p>'),
	'/login': () => page('Вход', '<form id="f"><input name="login" id="l"><input type="password" id="pw"><button>Войти</button></form>'),
	'/signup': () => page('Регистрация', '<form><input id="fn" name="firstName"><input id="em" type="email" name="email"><input id="pw" type="password" name="password"><button>OK</button></form>'),
	'/signup2': () => page('Регистрация 2', '<form><input id="em" type="email" name="email"><input id="fn" name="name"><input id="pw" type="password" name="password"><button>OK</button></form>'),
	'/dark': () => page('Тёмная', '<style>html,body{background:#111;color:#eee}</style><p>тёмный сайт</p>'),
	'/light': () => page('Светлая', '<style>html,body{background:#fff;color:#111}</style><p>светлый сайт</p>'),
	'/sound': () => page('Звук', '<p>тишина</p>'),
	'/headers': () => null, // ответ собирается из самого запроса (см. ниже)
	'/ok.js': () => ['text/javascript', 'window.okLoaded = 1;'],
	'/ads/banner.js': () => ['text/javascript', 'window.adLoaded = 1;'],
	'/file.bin': (res) => {
		res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': "attachment; filename*=UTF-8''" + encodeURIComponent('загрузка.bin') });
		res.end(Buffer.alloc(4096, 7));
	},
};

function start() {
	const hits = [];
	const heads = []; // запросы с заголовками: { url, headers }
	const server = http.createServer((req, res) => {
		hits.push(req.url);
		heads.push({ url: req.url, headers: req.headers });
		if (req.url.split('?')[0] === '/slow.bin') {
			// медленное скачивание: 6 кусков по полсекунды
			res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': 6 * 65536, 'content-disposition': 'attachment; filename="slow.bin"' });
			let n = 0;
			const t = setInterval(() => {
				res.write(Buffer.alloc(65536, 1));
				if (++n === 6) {
					clearInterval(t);
					res.end();
				}
			}, 500);
			return;
		}
		const path = req.url.split('?')[0];
		const r = ROUTES[path];
		if (!r) {
			res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
			return res.end(page('Нет', 'нет такой страницы'));
		}
		if (path === '/headers') {
			res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
			return res.end(page('Заголовки', '<pre id="h">' + JSON.stringify(req.headers).replace(/</g, '&lt;') + '</pre>'));
		}
		const out = r(res);
		if (out === undefined) return;
		const [type, body] = Array.isArray(out) ? out : ['text/html; charset=utf-8', out];
		res.writeHead(200, { 'content-type': type });
		res.end(body);
	});
	return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
		const base = 'http://127.0.0.1:' + server.address().port;
		resolve({ base, hits, heads, close: () => server.close() });
	}));
}

module.exports = { start };
