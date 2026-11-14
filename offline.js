// Страницы, сохранённые для чтения без интернета: каждая — один файл .mhtml (страница вместе с картинками и стилями) в папке offline
const fs = require('fs');
const path = require('path');

let dir = '';
let list = null;

const indexFile = () => path.join(dir, 'index.json');

function init(userData) {
	dir = path.join(userData, 'offline');
	list = null;
}

function load() {
	if (list) return list;
	try {
		const raw = JSON.parse(fs.readFileSync(indexFile(), 'utf8'));
		list = Array.isArray(raw) ? raw.filter((e) => e && typeof e.id === 'string' && /^[\w-]{3,40}$/.test(e.id) && typeof e.url === 'string') : [];
	} catch (e) {
		list = [];
	}
	return list;
}

function persist() {
	fs.mkdirSync(dir, { recursive: true });
	const tmp = indexFile() + '.tmp';
	fs.writeFileSync(tmp, JSON.stringify(list));
	fs.renameSync(tmp, indexFile());
}

const fileOf = (id) => path.join(dir, id + '.mhtml');

// Список, свежие сверху; файл, которого уже нет, помечаем
function all() {
	return load().map((e) => ({ id: e.id, url: e.url, title: e.title || e.url, savedAt: e.savedAt || 0, size: e.size || 0, missing: !fs.existsSync(fileOf(e.id)) })).sort((a, b) => b.savedAt - a.savedAt);
}

function newId() {
	return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// Место под новый файл; прежняя копия того же адреса заменяется после успешного сохранения
function reserve() {
	fs.mkdirSync(dir, { recursive: true });
	const id = newId();
	return { id, file: fileOf(id) };
}

function commit(id, meta) {
	const l = load();
	let size = 0;
	try {
		size = fs.statSync(fileOf(id)).size;
	} catch (e) {
		throw new Error('Файл не сохранился');
	}
	for (const old of l.filter((e) => e.url === meta.url)) {
		try {
			fs.rmSync(fileOf(old.id), { force: true });
		} catch (e) { /* не страшно */ }
	}
	list = l.filter((e) => e.url !== meta.url);
	list.push({ id, url: meta.url, title: String(meta.title || '').slice(0, 300), savedAt: Date.now(), size });
	persist();
}

function remove(id) {
	const l = load();
	if (!l.some((e) => e.id === id)) return false;
	try {
		fs.rmSync(fileOf(id), { force: true });
	} catch (e) { /* файла уже нет */ }
	list = l.filter((e) => e.id !== id);
	persist();
	return true;
}

function pathOf(id) {
	const e = load().find((x) => x.id === id);
	return e && fs.existsSync(fileOf(id)) ? fileOf(id) : null;
}

module.exports = { init, all, reserve, commit, remove, pathOf };
