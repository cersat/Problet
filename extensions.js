// Расширения Chrome: папки с распакованным расширением (где лежит manifest.json).
// Electron поддерживает не все API расширений (в основном content scripts, страницы, часть chrome.* вроде storage и tabs),
// поэтому сложные расширения могут работать не полностью.

const fs = require('fs');
const path = require('path');

let ses = null;
let file = '';
let entries = []; // { path, id, name, version, error }

function save() {
	try {
		fs.writeFileSync(file, JSON.stringify(entries.map((e) => e.path)), 'utf8');
	} catch (e) { /* не страшно: список восстановится при следующем добавлении */ }
}

function readManifest(dir) {
	let m;
	try {
		m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
	} catch (e) {
		throw new Error('В папке нет корректного manifest.json. Нужна распакованная папка расширения');
	}
	if (!m || typeof m !== 'object') throw new Error('Некорректный manifest.json');
	return m;
}

async function loadOne(dir) {
	const entry = { path: dir, id: '', name: path.basename(dir), version: '', error: '' };
	try {
		readManifest(dir);
		const ext = await ses.extensions.loadExtension(dir, { allowFileAccess: false });
		entry.id = ext.id;
		entry.name = ext.name || entry.name;
		entry.version = ext.version || '';
	} catch (e) {
		entry.error = String((e && e.message) || e);
	}
	return entry;
}

async function init(session, userData) {
	ses = session;
	file = path.join(userData, 'extensions.json');
	let paths = [];
	try {
		const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
		if (Array.isArray(raw)) paths = raw.filter((p) => typeof p === 'string');
	} catch (e) { /* списка ещё нет */ }
	entries = [];
	for (const p of paths) entries.push(await loadOne(p));
}

function list() {
	return entries.map((e) => ({ path: e.path, id: e.id, name: e.name, version: e.version, error: e.error }));
}

async function add(dir) {
	if (typeof dir !== 'string' || !dir) throw new Error('Папка не выбрана');
	dir = path.resolve(dir);
	if (entries.some((e) => e.path === dir)) throw new Error('Это расширение уже добавлено');
	readManifest(dir);
	const entry = await loadOne(dir);
	if (entry.error) throw new Error(entry.error);
	entries.push(entry);
	save();
	return entry;
}

async function remove(dir) {
	const i = entries.findIndex((e) => e.path === dir);
	if (i < 0) return;
	const [e] = entries.splice(i, 1);
	if (e.id) {
		try {
			await ses.extensions.removeExtension(e.id);
		} catch (err) { /* уже выгружено */ }
	}
	save();
}

module.exports = { init, list, add, remove };
