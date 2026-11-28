// Сервер аккаунтов для тестов: тот же договор, что у сервера Problet (регистрация, вход, снимки данных с номером версии), только в памяти
const http = require('http');

function start() {
	const accounts = new Map(); // ник в нижнем регистре -> { nick, auth, tokens: Set }
	const store = new Map(); // ник/вид -> { rev, time, data }
	const calls = [];
	const server = http.createServer((req, res) => {
		const chunks = [];
		req.on('data', (c) => chunks.push(c));
		req.on('end', () => {
			const send = (code, body) => {
				res.writeHead(code, { 'content-type': 'application/json' });
				res.end(JSON.stringify(body));
			};
			let body = {};
			try {
				body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
			} catch (e) { /* пустое тело */ }
			const url = new URL(req.url, 'http://x');
			calls.push(req.method + ' ' + url.pathname);
			const m = /^\/api\/account\/(register|login|logout)$/.exec(url.pathname);
			if (m && m[1] === 'register') {
				if (accounts.has(String(body.nick).toLowerCase())) return send(409, { error: 'Такой никнейм уже занят' });
				const a = { nick: body.nick, auth: body.auth, tokens: new Set() };
				const token = 'tok' + 'x'.repeat(20) + accounts.size;
				a.tokens.add(token);
				accounts.set(body.nick.toLowerCase(), a);
				return send(201, { token, nick: a.nick });
			}
			if (m && m[1] === 'login') {
				const a = accounts.get(String(body.nick).toLowerCase());
				if (!a || a.auth !== body.auth) return send(401, { error: 'Неверный никнейм или пароль' });
				const token = 'tok' + 'y'.repeat(20) + a.tokens.size;
				a.tokens.add(token);
				return send(200, { token, nick: a.nick });
			}
			const a = accounts.get(String(req.headers['x-nick'] || '').toLowerCase());
			const token = String(req.headers.authorization || '').replace(/^Bearer /, '');
			if (!a || !a.tokens.has(token)) return send(401, { error: 'Нужно войти' });
			if (m && m[1] === 'logout') {
				a.tokens.delete(token);
				return send(200, { ok: true });
			}
			const s = /^\/api\/sync\/(bookmarks|spaces|settings|passwords)$/.exec(url.pathname);
			if (!s) return send(404, { error: 'Нет такого адреса' });
			const key = a.nick.toLowerCase() + '/' + s[1];
			const cur = store.get(key) || { rev: 0 };
			if (req.method === 'GET') return send(200, cur);
			if (cur.rev !== body.baseRev) return send(409, { error: 'Данные уже изменились на другом устройстве', rev: cur.rev });
			const next = { rev: cur.rev + 1, time: Date.now(), data: body.data };
			store.set(key, next);
			return send(200, { rev: next.rev, time: next.time });
		});
	});
	return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
		url: 'http://127.0.0.1:' + server.address().port + '/',
		calls,
		stored: (nick, kind) => store.get(nick.toLowerCase() + '/' + kind),
		close: () => server.close(),
	})));
}

module.exports = { start };
