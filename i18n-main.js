// Язык интерфейса в главном процессе: перевод меню, диалогов и уведомлений. Страницы переводит pages/i18n.js
const fs = require('fs');
const path = require('path');
const { app, Menu, dialog } = require('electron');
const i18n = require('./pages/i18n');

let getSetting = () => 'auto';

function systemLang() {
	let list = [];
	try {
		list = app.getPreferredSystemLanguages();
	} catch (e) { /* до готовности может не работать */ }
	const first = list[0] || process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || '';
	return /^ru/i.test(first) ? 'ru' : 'en';
}

const resolve = (v) => (v === 'ru' || v === 'en' ? v : systemLang());
const lang = () => resolve(getSetting());
const tr = (s, ctx) => (typeof s === 'string' && lang() === 'en' ? i18n.translate(s, ctx) : s);

// Язык самого Chromium (системные надписи, заголовок Accept-Language) задаётся до запуска, поэтому берём выбор прямо из файла данных
function applyChromiumLang() {
	try {
		const raw = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'data.json'), 'utf8'));
		const v = raw && raw.settings && raw.settings.language;
		if (v === 'ru') app.commandLine.appendSwitch('lang', 'ru');
		else if (v === 'en') app.commandLine.appendSwitch('lang', 'en-US');
	} catch (e) { /* профиль ещё пустой: язык системы */ }
}

function localizeMenu(items) {
	return items.map((it) => {
		if (!it || typeof it !== 'object') return it;
		const out = { ...it };
		if (out.label) out.label = tr(out.label, 'menu');
		if (out.sublabel) out.sublabel = tr(out.sublabel, 'menu');
		if (out.toolTip) out.toolTip = tr(out.toolTip, 'menu');
		if (Array.isArray(out.submenu)) out.submenu = localizeMenu(out.submenu);
		return out;
	});
}

function localizeOptions(o) {
	if (!o || typeof o !== 'object' || typeof o.getTitle === 'function') return o;
	const out = { ...o };
	for (const k of ['title', 'message', 'detail', 'checkboxLabel', 'buttonLabel']) if (typeof out[k] === 'string') out[k] = tr(out[k]);
	if (Array.isArray(out.buttons)) out.buttons = out.buttons.map((b) => tr(b, 'dialog'));
	if (Array.isArray(out.filters)) out.filters = out.filters.map((f) => ({ ...f, name: tr(f.name) }));
	return out;
}

function install(settingGetter) {
	getSetting = settingGetter;
	const buildFromTemplate = Menu.buildFromTemplate.bind(Menu);
	Menu.buildFromTemplate = (template) => buildFromTemplate(localizeMenu(template));
	for (const name of ['showMessageBox', 'showMessageBoxSync', 'showOpenDialog', 'showOpenDialogSync', 'showSaveDialog', 'showSaveDialogSync']) {
		const orig = dialog[name].bind(dialog);
		dialog[name] = (...args) => orig(...args.map(localizeOptions));
	}
	const showErrorBox = dialog.showErrorBox.bind(dialog);
	dialog.showErrorBox = (title, content) => showErrorBox(tr(title), tr(content));
}

module.exports = { install, lang, tr, applyChromiumLang, resolve };
