// Акцентные цвета и данные темы, которые главный процесс рассылает всем окнам

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

function accentList() {
	return Object.entries(ACCENTS).map(([id, a]) => ({ id, name: a.name, color: a.color }));
}

function themePayload(settings) {
	const accent = (ACCENTS[settings.accent] || ACCENTS.default).color;
	const [r, g, b] = [1, 3, 5].map((i) => parseInt(accent.slice(i, i + 2), 16));
	const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
	return {
		dark: settings.darkTheme,
		accent,
		accentSoft: 'rgba(' + r + ', ' + g + ', ' + b + ', 0.22)',
		onAccent: luminance > 0.55 ? '#1d1d1f' : '#ffffff', // чтобы текст на жёлтой кнопке читался
	};
}

module.exports = { ACCENTS, accentList, themePayload };
