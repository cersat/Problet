// Пароли в CSV (столбцы как у Chrome: name,url,username,password,note). Читает и выгрузки других браузеров и менеджеров.

const HEAD = ['name', 'url', 'username', 'password', 'note'];

const cell = (s) => '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"';

function toCsv(entries) {
	const lines = [HEAD.join(',')];
	for (const e of entries) {
		let name = e.origin;
		try {
			name = new URL(e.origin).hostname;
		} catch (err) { /* оставляем адрес как есть */ }
		lines.push([name, e.origin, e.username, e.password, ''].map(cell).join(','));
	}
	return lines.join('\r\n') + '\r\n';
}

// Разбор CSV с кавычками, запятыми и переводами строк внутри ячеек
function parseRows(text) {
	const rows = [];
	let row = [];
	let cur = '';
	let quoted = false;
	const s = text.replace(/^\uFEFF/, '');
	for (let i = 0; i < s.length; i++) {
		const c = s[i];
		if (quoted) {
			if (c === '"' && s[i + 1] === '"') {
				cur += '"';
				i++;
			} else if (c === '"') {
				quoted = false;
			} else {
				cur += c;
			}
		} else if (c === '"') {
			quoted = true;
		} else if (c === ',') {
			row.push(cur);
			cur = '';
		} else if (c === '\n' || c === '\r') {
			if (c === '\r' && s[i + 1] === '\n') i++;
			row.push(cur);
			cur = '';
			if (row.some((x) => x !== '')) rows.push(row);
			row = [];
		} else {
			cur += c;
		}
	}
	row.push(cur);
	if (row.some((x) => x !== '')) rows.push(row);
	return rows;
}

const ALIASES = {
	url: ['url', 'login_uri', 'origin', 'website', 'site'],
	username: ['username', 'login_username', 'user', 'login', 'email'],
	password: ['password', 'login_password', 'pass'],
};

// Возвращает [{ url, username, password }]; бросает ошибку, если это не файл с паролями
function parse(text) {
	const rows = parseRows(String(text));
	if (!rows.length) throw new Error('Файл пустой');
	const head = rows[0].map((h) => h.trim().toLowerCase());
	const col = {};
	for (const [key, names] of Object.entries(ALIASES)) col[key] = head.findIndex((h) => names.includes(h));
	if (col.url < 0 || col.password < 0) throw new Error('Не похоже на файл с паролями: нужны столбцы url и password');
	return rows.slice(1).map((r) => ({
		url: (r[col.url] || '').trim(),
		username: col.username >= 0 ? r[col.username] || '' : '',
		password: r[col.password] || '',
	}));
}

module.exports = { toCsv, parse };
