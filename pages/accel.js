// Горячие клавиши: список действий и перевод нажатия в строку вроде «Ctrl+Shift+O».
// Файл общий: его читает главный процесс (require) и страница настроек (тег script).
(function (root) {
	const ACTIONS = [
		{ id: 'address', label: 'Адресная строка', key: 'Ctrl+L' },
		{ id: 'newTab', label: 'Новая вкладка', key: 'Ctrl+T' },
		{ id: 'closeTab', label: 'Закрыть вкладку', key: 'Ctrl+W' },
		{ id: 'nextTab', label: 'Следующая вкладка', key: 'Ctrl+Tab' },
		{ id: 'prevTab', label: 'Предыдущая вкладка', key: 'Ctrl+Shift+Tab' },
		{ id: 'nextTab2', label: 'Следующая вкладка (запасное)', key: 'Ctrl+PageDown' },
		{ id: 'prevTab2', label: 'Предыдущая вкладка (запасное)', key: 'Ctrl+PageUp' },
		{ id: 'reopenTab', label: 'Открыть закрытую вкладку', key: 'Ctrl+Shift+T' },
		{ id: 'tabsMenu', label: 'Список вкладок', key: 'Ctrl+Shift+A' },
		{ id: 'incognito', label: 'Новая вкладка инкогнито', key: 'Ctrl+Shift+N' },
		{ id: 'pin', label: 'Закрепить вкладку', key: 'Ctrl+Shift+P' },
		{ id: 'back', label: 'Назад', key: 'Alt+Left' },
		{ id: 'forward', label: 'Вперёд', key: 'Alt+Right' },
		{ id: 'reload', label: 'Обновить', key: 'Ctrl+R' },
		{ id: 'reload2', label: 'Обновить (запасное)', key: 'F5' },
		{ id: 'find', label: 'Найти на странице', key: 'Ctrl+F' },
		{ id: 'bookmark', label: 'Добавить в закладки', key: 'Ctrl+D' },
		{ id: 'bookmarks', label: 'Закладки', key: 'Ctrl+Shift+O' },
		{ id: 'history', label: 'История', key: 'Ctrl+H' },
		{ id: 'downloads', label: 'Загрузки', key: 'Ctrl+J' },
		{ id: 'saveOffline', label: 'Сохранить страницу для офлайна', key: 'Ctrl+Alt+S' },
		{ id: 'offlinePage', label: 'Сохранённые страницы', key: '' },
		{ id: 'passwords', label: 'Пароли', key: 'Ctrl+Shift+K' },
		{ id: 'settings', label: 'Настройки', key: 'Ctrl+,' },
		{ id: 'zoomIn', label: 'Увеличить масштаб', key: 'Ctrl+=' },
		{ id: 'zoomOut', label: 'Уменьшить масштаб', key: 'Ctrl+-' },
		{ id: 'zoomReset', label: 'Масштаб 100%', key: 'Ctrl+0' },
		{ id: 'screenshot', label: 'Скриншот страницы', key: 'Ctrl+Shift+S' },
		{ id: 'print', label: 'Печать', key: 'Ctrl+P' },
		{ id: 'pdf', label: 'Сохранить как PDF', key: 'Ctrl+Alt+P' },
		{ id: 'source', label: 'Код страницы', key: 'Ctrl+U' },
		{ id: 'translate', label: 'Перевести страницу', key: 'Ctrl+Shift+Y' },
		{ id: 'darkPage', label: 'Тёмная тема страницы', key: 'Ctrl+Shift+L' },
		{ id: 'devtools', label: 'Инструменты разработчика', key: 'F12' },
	];

	const KEY_NAMES = { arrowleft: 'Left', arrowright: 'Right', arrowup: 'Up', arrowdown: 'Down', ' ': 'Space', escape: 'Esc', pageup: 'PageUp', pagedown: 'PageDown', '+': '=' };
	const MODIFIER_KEYS = ['control', 'shift', 'alt', 'meta', 'altgraph', 'os'];

	// ev: { key, ctrl, meta, alt, shift }. Вернёт строку или '' (если нажаты одни модификаторы)
	function fromEvent(ev) {
		const raw = String(ev.key || '');
		const low = raw.toLowerCase();
		if (!raw || MODIFIER_KEYS.includes(low)) return '';
		let key = KEY_NAMES[low] || (raw.length === 1 ? raw.toUpperCase() : raw[0].toUpperCase() + raw.slice(1));
		// Для знаков вроде «+» или «?» Shift уже учтён в самом символе
		const punctuation = raw.length === 1 && !/[a-z0-9]/i.test(raw);
		const parts = [];
		if (ev.ctrl || ev.meta) parts.push('Ctrl');
		if (ev.alt) parts.push('Alt');
		if (ev.shift && !punctuation) parts.push('Shift');
		parts.push(key);
		return parts.join('+');
	}

	// Допустимая запись: «Ctrl+Shift+O», «F12» и т.п. Пустая строка означает «без клавиши»
	function valid(s) {
		return typeof s === 'string' && (s === '' || /^((Ctrl|Alt|Shift)\+){0,3}[^\s+]{1,12}$|^((Ctrl|Alt|Shift)\+){0,3}=$/.test(s));
	}

	const api = { ACTIONS, fromEvent, valid };
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
	else root.accel = api;
})(typeof self !== 'undefined' ? self : this);
