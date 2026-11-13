// Тема: акцентный цвет, оттенок фона, контраст, масштаб интерфейса и наборы тем. Главный процесс рассылает готовые CSS-переменные всем окнам

const ACCENTS = {
	default: { name: 'Стандартный', color: '#7c9cf5' },
	red: { name: 'Красный', color: '#f28b9b' },
	yellow: { name: 'Жёлтый', color: '#f5d77a' },
	blue: { name: 'Синий', color: '#6cb2f0' },
	green: { name: 'Зелёный', color: '#7fcf9a' },
	purple: { name: 'Фиолетовый', color: '#b79cf0' },
	orange: { name: 'Оранжевый', color: '#f7b26e' },
	pink: { name: 'Розовый', color: '#f4a0c4' },
};

const HEX = /^#[0-9a-f]{6}$/i;

const TINTS = {
	neutral: 'Нейтральный',
	warm: 'Тёплый',
	cool: 'Холодный',
	deep: 'Глубокий (чёрный или белый)',
};
const CONTRASTS = { normal: 'Обычный', high: 'Высокий' };
const UI_SCALES = [80, 90, 100, 110, 125, 150];

// Поверхности интерфейса для каждого оттенка: фон, полоса вкладок, панели, боковая панель, карточки, кнопки, наведение, рамки
const KEYS = ['--bg', '--tabbar', '--panel', '--sidebar', '--surface', '--control', '--hover', '--border', '--border-strong'];
const PALETTES = {
	dark: {
		neutral: ['#1e1e20', '#151517', '#28282b', '#232326', '#2c2c2f', '#38383c', '#3a3a3e', '#38383c', '#4a4a50'],
		warm: ['#211e1c', '#181513', '#2c2826', '#262220', '#302b28', '#3d3733', '#403935', '#3d3733', '#514943'],
		cool: ['#1b1e23', '#13161a', '#252a31', '#20242a', '#293038', '#343c46', '#37404a', '#343c46', '#465260'],
		deep: ['#000000', '#000000', '#0e0e10', '#08080a', '#141416', '#202024', '#26262a', '#202024', '#36363c'],
	},
	light: {
		neutral: ['#fbfbfd', '#e9e9ee', '#f3f3f7', '#efeff4', '#f0f0f5', '#e8e8ee', '#dcdce4', '#e2e2e8', '#cfcfd8'],
		warm: ['#fcfaf6', '#ece6dc', '#f5f1ea', '#f1ece4', '#f3eee6', '#ebe4d9', '#e0d7c9', '#e6dfd3', '#d4cab9'],
		cool: ['#f8fafd', '#e3e9f1', '#eff3f8', '#eaeff5', '#ecf1f7', '#e2e9f1', '#d5dee9', '#dce4ee', '#c6d2e0'],
		deep: ['#ffffff', '#ececf0', '#f7f7f9', '#f2f2f5', '#f4f4f7', '#eaeaef', '#dedee5', '#e2e2e8', '#c8c8d2'],
	},
};
// Текст при высоком контрасте ярче, второстепенный текст и рамки заметнее
const TEXT = {
	dark: { normal: ['#e4e4e8', '#ffffff', '#a0a0a8', '#7c7c84'], high: ['#ffffff', '#ffffff', '#d0d0d8', '#acacb4'] },
	light: { normal: ['#2c2c30', '#111111', '#6e6e78', '#94949e'], high: ['#000000', '#000000', '#3c3c44', '#5c5c66'] },
};

// Готовые наборы. В наборе — все параметры раздела «Тема»
const PRESETS = [
	{ id: 'problet', name: 'Problet', theme: { darkTheme: true, accent: 'default', bgTint: 'neutral', contrast: 'normal', uiScale: 100, arrows: 'tri' } },
	{ id: 'midnight', name: 'Полночь', theme: { darkTheme: true, accent: 'blue', bgTint: 'deep', contrast: 'normal', uiScale: 100, arrows: 'angle' } },
	{ id: 'evening', name: 'Тёплый вечер', theme: { darkTheme: true, accent: 'orange', bgTint: 'warm', contrast: 'normal', uiScale: 100, arrows: 'tri' } },
	{ id: 'north', name: 'Северный', theme: { darkTheme: true, accent: '#88c0d0', bgTint: 'cool', contrast: 'normal', uiScale: 100, arrows: 'arrow' } },
	{ id: 'forest', name: 'Лес', theme: { darkTheme: true, accent: 'green', bgTint: 'warm', contrast: 'normal', uiScale: 100, arrows: 'angle' } },
	{ id: 'sharp', name: 'Чёткий', theme: { darkTheme: true, accent: 'yellow', bgTint: 'deep', contrast: 'high', uiScale: 110, arrows: 'heavy' } },
	{ id: 'paper', name: 'Бумага', theme: { darkTheme: false, accent: '#c0703a', bgTint: 'warm', contrast: 'normal', uiScale: 100, arrows: 'tri' } },
	{ id: 'daylight', name: 'День', theme: { darkTheme: false, accent: 'default', bgTint: 'cool', contrast: 'normal', uiScale: 100, arrows: 'tri' } },
];
const THEME_KEYS = ['darkTheme', 'accent', 'bgTint', 'contrast', 'uiScale', 'arrows'];

function accentList() {
	return Object.entries(ACCENTS).map(([id, a]) => ({ id, name: a.name, color: a.color }));
}

const accentColor = (accent) => (HEX.test(accent || '') ? accent.toLowerCase() : (ACCENTS[accent] || ACCENTS.default).color);

function vars(settings) {
	const mode = settings.darkTheme ? 'dark' : 'light';
	const pal = PALETTES[mode][settings.bgTint] || PALETTES[mode].neutral;
	const out = {};
	KEYS.forEach((k, i) => { out[k] = pal[i]; });
	const high = settings.contrast === 'high';
	const [text, strong, muted, faint] = TEXT[mode][high ? 'high' : 'normal'];
	Object.assign(out, { '--text': text, '--text-strong': strong, '--muted': muted, '--faint': faint });
	if (high) {
		out['--border'] = settings.darkTheme ? '#6a6a72' : '#8a8a96';
		out['--border-strong'] = settings.darkTheme ? '#8e8e98' : '#5c5c68';
	}
	return out;
}

function themePayload(settings) {
	const accent = accentColor(settings.accent);
	const [r, g, b] = [1, 3, 5].map((i) => parseInt(accent.slice(i, i + 2), 16));
	const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
	return {
		dark: settings.darkTheme,
		accent,
		accentSoft: 'rgba(' + r + ', ' + g + ', ' + b + ', ' + (settings.contrast === 'high' ? 0.36 : 0.22) + ')',
		onAccent: luminance > 0.55 ? '#1d1d1f' : '#ffffff', // чтобы текст на жёлтой кнопке читался
		vars: vars(settings),
		scale: (UI_SCALES.includes(settings.uiScale) ? settings.uiScale : 100) / 100,
	};
}

module.exports = { ACCENTS, HEX, TINTS, CONTRASTS, UI_SCALES, PRESETS, PALETTES, THEME_KEYS, accentList, accentColor, themePayload };
