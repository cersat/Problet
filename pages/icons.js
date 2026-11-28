// Все иконки Problet в одном месте: панели, окошки, внутренние страницы, значки вкладок и каталог SVG-редактора.
// Каждая иконка — содержимое SVG 24×24, нарисованное линией цвета currentColor (толщина задаётся снаружи).
// Подключается и в страницах (window.PROBLET_ICONS), и в главном процессе (require)
(function (root) {
	const ICONS = {
		// Панели браузера
		reload: { label: 'Обновить', body: '<path d="M19 12a7 7 0 1 1-2.05-4.95"/><path d="M19 4.5V9h-4.5"/>' },
		stop: { label: 'Остановить', body: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>' },
		plus: { label: 'Новая вкладка', body: '<path d="M12 5v14M5 12h14"/>' },
		close: { label: 'Закрыть', body: '<path d="M7 7l10 10M17 7L7 17"/>' },
		star: { label: 'Закладка', body: '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9l-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z"/>' },
		update: { label: 'Обновление', body: '<path d="M12 20V9M7.5 13.5L12 9l4.5 4.5M5 5h14"/>' },
		translate: { label: 'Перевод', body: '<path d="M4 5h9M8.5 3v2M6 5c.6 3.5 3 6 6 7M12 5c-.6 3.2-3 6.2-7 8M12.5 20l4-9 4 9M14 17h5"/>' },
		darkpage: { label: 'Тёмная страница', body: '<path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z"/>' },
		chars: { label: 'Таблица символов', body: '<path d="M4 19h5v-2.2C6.2 15.6 5 13.6 5 11.5a7 7 0 0 1 14 0c0 2.1-1.2 4.1-4 5.3V19h5"/>' },
		bookmarks: { label: 'Закладки', body: '<path d="M7 4h10v16l-5-4-5 4z"/>' },
		passwords: { label: 'Пароли', body: '<circle cx="8.5" cy="14" r="3.5"/><path d="M11 12l8-8M16 7l2.5 2.5M13.5 9.5L15 11"/>' },
		notepad: { label: 'Блокнот', body: '<path d="M6 3.5h12v17H6z"/><path d="M9 8h6M9 12h6M9 16h3"/>' },
		history: { label: 'История', body: '<circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/>' },
		downloads: { label: 'Загрузки', body: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19h14"/>' },
		settings: { label: 'Настройки', body: '<path d="M4 7h9M19 7h1M4 17h1M11 17h9"/><circle cx="16" cy="7" r="2.2"/><circle cx="8" cy="17" r="2.2"/>' },
		spaces: { label: 'Пространства', body: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>' },
		safemode: { label: 'Безопасный режим', body: '<path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6z"/><path d="M9 12l2 2 4-4"/>' },
		incognito: { label: 'Инкогнито', body: '<path d="M3 11h18M6 11l1.5-6h9L18 11"/><circle cx="8" cy="16" r="2.5"/><circle cx="16" cy="16" r="2.5"/><path d="M10.5 16h3"/>' },
		clock: { label: 'Часы', body: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5h4"/>' },
		// Внутренние страницы
		version: { label: 'О браузере', body: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8v.2"/>' },
		offline: { label: 'Страницы для офлайна', body: '<path d="M6 4h9l3 3v13H6z"/><path d="M12 10v6M9.5 13.5L12 16l2.5-2.5"/>' },
		folder: { label: 'Папка', body: '<path d="M3.5 7.5a1.5 1.5 0 0 1 1.5-1.5h4l2 2.5h8a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5z"/>' },
		svgedit: { label: 'Графический редактор', body: '<path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19z"/><path d="M14.5 6.5l3 3"/>' },
		game: { label: 'Лабиринт', body: '<rect x="3.5" y="3.5" width="17" height="17" rx="2"/><path d="M3.5 9h10M9 14.5h11.5M9 14.5V20.5M14 3.5V9"/><circle cx="6.3" cy="17.7" r="1.2"/>' },
		blocklist: { label: 'Блокировщик', body: '<circle cx="12" cy="12" r="8.5"/><path d="M6 6l12 12"/>' },
		extensions: { label: 'Расширения', body: '<path d="M9 4.5a2 2 0 0 1 4 0V6h4a1 1 0 0 1 1 1v4h-1.5a2 2 0 0 0 0 4H18v4a1 1 0 0 1-1 1h-4v-1.5a2 2 0 0 0-4 0V20H5a1 1 0 0 1-1-1v-4h1.5a2 2 0 0 0 0-4H4V7a1 1 0 0 1 1-1h4z"/>' },
		// Подсказки адресной строки и списки
		search: { label: 'Поиск', body: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/>' },
		calc: { label: 'Калькулятор', body: '<rect x="5" y="3.5" width="14" height="17" rx="2"/><path d="M8 7.5h8M8.5 12h.01M12 12h.01M15.5 12h.01M8.5 16h.01M12 16h.01M15.5 16h.01"/>' },
		external: { label: 'Открыть', body: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>' },
		restore: { label: 'Из истории', body: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 4.5v4h4"/><path d="M12 8.5V12l2.5 1.5"/>' },
		edit: { label: 'Изменить', body: '<path d="M5 19l.8-3.6L15.6 5.6a1.9 1.9 0 0 1 2.8 2.8L8.6 18.2z"/><path d="M14 7.2l2.8 2.8"/>' },
		trash: { label: 'Удалить', body: '<path d="M4.5 7h15M10 7V4.5h4V7M6.5 7l1 12.5h9l1-12.5M10 10.5v6M14 10.5v6"/>' },
		up: { label: 'Вверх', body: '<path d="M12 19V5M6 11l6-6 6 6"/>' },
		down: { label: 'Вниз', body: '<path d="M12 5v14M6 13l6 6 6-6"/>' },
		chevronUp: { label: 'Выше', body: '<path d="M6 15l6-6 6 6"/>' },
		chevronDown: { label: 'Ниже', body: '<path d="M6 9l6 6 6-6"/>' },
		chevronRight: { label: 'Дальше', body: '<path d="M9.5 6l6 6-6 6"/>' },
		chevronLeft: { label: 'Назад', body: '<path d="M14.5 6l-6 6 6 6"/>' },
		parent: { label: 'Папка выше', body: '<path d="M10 19V9M5 14l5-5 5 5M10 9V5h9"/>' },
		more: { label: 'Ещё', body: '<circle cx="6" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18" cy="12" r="1.2"/>' },
		menu: { label: 'Меню', body: '<path d="M4 7h16M4 12h16M4 17h16"/>' },
		home: { label: 'Домой', body: '<path d="M4 11l8-7 8 7M6 9.5V20h12V9.5"/><path d="M10 20v-5h4v5"/>' },
		check: { label: 'Готово', body: '<path d="M5 12.5l4.5 4.5L19 7.5"/>' },
		copy: { label: 'Копировать', body: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/>' },
		cut: { label: 'Вырезать', body: '<circle cx="7" cy="17" r="2.5"/><circle cx="17" cy="17" r="2.5"/><path d="M8.8 15.2L18 4M15.2 15.2L6 4"/>' },
		paste: { label: 'Вставить', body: '<path d="M9 4.5h6v3H9z"/><path d="M15 6h2.5A1.5 1.5 0 0 1 19 7.5v11a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 18.5v-11A1.5 1.5 0 0 1 6.5 6H9"/>' },
		newFolder: { label: 'Новая папка', body: '<path d="M3.5 7.5a1.5 1.5 0 0 1 1.5-1.5h4l2 2.5h8a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5z"/><path d="M12 11v5M9.5 13.5h5"/>' },
		newFile: { label: 'Новый файл', body: '<path d="M6 3.5h8l4 4v13H6z"/><path d="M14 3.5v4h4M12 11v6M9 14h6"/>' },
		file: { label: 'Файл', body: '<path d="M6 3.5h8l4 4v13H6z"/><path d="M14 3.5v4h4"/>' },
		rename: { label: 'Переименовать', body: '<path d="M4 7h10M4 12h7M4 17h5"/><path d="M13 19l.6-2.6 5.2-5.2a1.4 1.4 0 0 1 2 2l-5.2 5.2z"/>' },
		eye: { label: 'Показать', body: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>' },
		eyeOff: { label: 'Скрыть', body: '<path d="M4 4l16 16M9.9 5.8A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-2.6 3.4M6.3 7.4A15.6 15.6 0 0 0 2.5 12S6 18.5 12 18.5a9 9 0 0 0 4.3-1.1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>' },
		grid: { label: 'Плитки', body: '<rect x="4" y="4" width="6.5" height="6.5" rx="1"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1"/>' },
		list: { label: 'Список', body: '<path d="M9 6.5h11M9 12h11M9 17.5h11M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01"/>' },
		sort: { label: 'Сортировка', body: '<path d="M7 4v16M3.5 16.5L7 20l3.5-3.5M17 20V4M13.5 7.5L17 4l3.5 3.5"/>' },
		terminal: { label: 'Терминал', body: '<rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="M7 9.5l3 2.5-3 2.5M12.5 15h4.5"/>' },
		drive: { label: 'Диск', body: '<rect x="3" y="13" width="18" height="6.5" rx="1.5"/><path d="M5 13l2.5-7.5h9L19 13M16.5 16.2h.01"/>' },
		image: { label: 'Картинка', body: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="M20.5 16l-5-5-9 8.5"/>' },
		music: { label: 'Музыка', body: '<path d="M9 18V6l11-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>' },
		video: { label: 'Видео', body: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10.5l5-3v9l-5-3"/>' },
		archive: { label: 'Архив', body: '<rect x="3.5" y="4" width="17" height="4.5" rx="1"/><path d="M5 8.5V20h14V8.5M10 12h4"/>' },
		code: { label: 'Код', body: '<path d="M8.5 7L3.5 12l5 5M15.5 7l5 5-5 5M13.5 4.5l-3 15"/>' },
		document: { label: 'Документ', body: '<path d="M6 3.5h8l4 4v13H6z"/><path d="M14 3.5v4h4M9 12h6M9 15.5h6M9 8.5h2"/>' },
		// Инструменты графического редактора
		rotateLeft: { label: 'Повернуть влево', body: '<path d="M5 12a7 7 0 1 0 2.05-4.95"/><path d="M5 4.5V9h4.5"/>' },
		rotateRight: { label: 'Повернуть вправо', body: '<path d="M19 12a7 7 0 1 1-2.05-4.95"/><path d="M19 4.5V9h-4.5"/>' },
		alignLeft: { label: 'По левому краю', body: '<path d="M4.5 3.5v17"/><rect x="7.5" y="6" width="11" height="4" rx="1"/><rect x="7.5" y="14" width="7" height="4" rx="1"/>' },
		alignHCenter: { label: 'По центру по горизонтали', body: '<path d="M12 3.5v17"/><rect x="5.5" y="6" width="13" height="4" rx="1"/><rect x="7.5" y="14" width="9" height="4" rx="1"/>' },
		alignRight: { label: 'По правому краю', body: '<path d="M19.5 3.5v17"/><rect x="5.5" y="6" width="11" height="4" rx="1"/><rect x="9.5" y="14" width="7" height="4" rx="1"/>' },
		alignTop: { label: 'По верхнему краю', body: '<path d="M3.5 4.5h17"/><rect x="6" y="7.5" width="4" height="11" rx="1"/><rect x="14" y="7.5" width="4" height="7" rx="1"/>' },
		alignVCenter: { label: 'По центру по вертикали', body: '<path d="M3.5 12h17"/><rect x="6" y="5.5" width="4" height="13" rx="1"/><rect x="14" y="7.5" width="4" height="9" rx="1"/>' },
		alignBottom: { label: 'По нижнему краю', body: '<path d="M3.5 19.5h17"/><rect x="6" y="5.5" width="4" height="11" rx="1"/><rect x="14" y="9.5" width="4" height="7" rx="1"/>' },
		distributeH: { label: 'Распределить по горизонтали', body: '<path d="M4 4v16M20 4v16"/><rect x="9.5" y="7" width="5" height="10" rx="1"/>' },
		distributeV: { label: 'Распределить по вертикали', body: '<path d="M4 4h16M4 20h16"/><rect x="7" y="9.5" width="10" height="5" rx="1"/>' },
		// Общие (для каталога редактора)
		heart: { label: 'Сердце', body: '<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7a4.3 4.3 0 0 1 7.5 2.8C19.5 15.4 12 20 12 20z"/>' },
		globe: { label: 'Сайт', body: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.5 3.5 5.3 3.5 8.5s-1 6-3.5 8.5c-2.5-2.5-3.5-5.3-3.5-8.5s1-6 3.5-8.5z"/>' },
		mail: { label: 'Почта', body: '<rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="M3.5 7l8.5 6 8.5-6"/>' },
		user: { label: 'Человек', body: '<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20c.8-3.8 3.8-6 7.5-6s6.7 2.2 7.5 6"/>' },
		lock: { label: 'Замок', body: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>' },
		unlock: { label: 'Открытый замок', body: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 7.6-1.7"/>' },
		bell: { label: 'Колокольчик', body: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>' },
		sun: { label: 'Солнце', body: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>' },
		cloud: { label: 'Облако', body: '<path d="M7 18.5a4.5 4.5 0 0 1-.6-9 6 6 0 0 1 11.4 1.5A3.8 3.8 0 0 1 17.5 18.5z"/>' },
		bolt: { label: 'Молния', body: '<path d="M13 3L5 13.5h6L10 21l8-10.5h-6z"/>' },
		play: { label: 'Пуск', body: '<path d="M8 5.5v13l10.5-6.5z"/>' },
		pause: { label: 'Пауза', body: '<path d="M8.5 5.5v13M15.5 5.5v13"/>' },
		camera: { label: 'Фото', body: '<path d="M4 8.5h3.5L9 6h6l1.5 2.5H20v10.5H4z"/><circle cx="12" cy="13.5" r="3.3"/>' },
		calendar: { label: 'Календарь', body: '<rect x="4" y="5.5" width="16" height="14.5" rx="2"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>' },
		pin: { label: 'Закрепить', body: '<path d="M9 4h6l-1 6 3.5 3.5h-11L10 10z"/><path d="M12 13.5V20"/>' },
		mapPin: { label: 'Место', body: '<path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>' },
		tag: { label: 'Метка', body: '<path d="M4 4h7.5l8.5 8.5-7.5 7.5L4 11.5z"/><circle cx="8.3" cy="8.3" r="1.3"/>' },
		flag: { label: 'Флажок', body: '<path d="M5.5 21V4M5.5 4.5h11l-2 4 2 4h-11"/>' },
		filter: { label: 'Фильтр', body: '<path d="M4 5h16l-6 7.5V19l-4 1.5v-8z"/>' },
		share: { label: 'Поделиться', body: '<circle cx="17.5" cy="5.5" r="2.5"/><circle cx="6.5" cy="12" r="2.5"/><circle cx="17.5" cy="18.5" r="2.5"/><path d="M8.7 10.7l6.6-3.9M8.7 13.3l6.6 3.9"/>' },
		save: { label: 'Сохранить', body: '<path d="M5 4h11.5L20 7.5V20H4V5a1 1 0 0 1 1-1z"/><path d="M8 4v5h7V4M7.5 20v-6.5h9V20"/>' },
		upload: { label: 'Отправить', body: '<path d="M12 15V4M7.5 8.5L12 4l4.5 4.5M5 19h14"/>' },
		link: { label: 'Ссылка', body: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>' },
		info: { label: 'Сведения', body: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8v.2"/>' },
		warning: { label: 'Внимание', body: '<path d="M12 4l9 16H3z"/><path d="M12 10v4.5M12 17.3v.2"/>' },
		smile: { label: 'Улыбка', body: '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01"/>' },
		cart: { label: 'Корзина', body: '<path d="M3.5 4.5h2.5l2 11h10l2-8H7"/><circle cx="9.5" cy="19" r="1.3"/><circle cx="17" cy="19" r="1.3"/>' },
		gift: { label: 'Подарок', body: '<rect x="4" y="9" width="16" height="11" rx="1"/><path d="M3 9h18M12 9v11M12 9c-1.5-4-6-4.5-6-2s4 2 6 2c2 0 6 .5 6-2s-4.5-2-6 2"/>' },
		rocket: { label: 'Ракета', body: '<path d="M12 3c3.5 2 5 5.5 5 9.5l-2 3.5H9l-2-3.5C7 8.5 8.5 5 12 3z"/><circle cx="12" cy="10" r="1.8"/><path d="M9 16l-2.5 4M15 16l2.5 4M12 16v4.5"/>' },
		puzzle: { label: 'Пазл', body: '<path d="M9 4.5a2 2 0 0 1 4 0V6h4a1 1 0 0 1 1 1v4h-1.5a2 2 0 0 0 0 4H18v4a1 1 0 0 1-1 1h-4v-1.5a2 2 0 0 0-4 0V20H5a1 1 0 0 1-1-1v-4h1.5a2 2 0 0 0 0-4H4V7a1 1 0 0 1 1-1h4z"/>' },
		cat: { label: 'Кот', body: '<path d="M5 9V4l4 3h6l4-3v5c1 1.4 1.5 3 1.5 4.5 0 4-3.8 6.5-8.5 6.5s-8.5-2.5-8.5-6.5C3.5 12 4 10.4 5 9z"/><path d="M9.5 12.5h.01M14.5 12.5h.01M11 15.5l1 .8 1-.8"/>' },
	};

	// Стрелки «назад»: «вперёд» — то же самое, отражённое по горизонтали
	const ARROWS = {
		tri: { label: 'Треугольник', body: '<path d="M15.5 5.5v13L6 12z" fill="currentColor"/>' },
		arrow: { label: 'Стрелка', body: '<path d="M19 12H5M11 6l-6 6 6 6"/>' },
		angle: { label: 'Уголок', body: '<path d="M14.5 6l-6 6 6 6"/>' },
		heavy: { label: 'Жирный уголок', body: '<path d="M15 5l-7 7 7 7" stroke-width="3.2"/>' },
		double: { label: 'Двойной уголок', body: '<path d="M12 6l-6 6 6 6M18.5 6l-6 6 6 6"/>' },
		dbl: { label: 'Двойная стрелка', body: '<path d="M19.5 9.5H9M19.5 14.5H9M11 5.5L4.5 12l6.5 6.5"/>' },
		outline: { label: 'Контурный треугольник', body: '<path d="M16 5.5v13L6 12z"/>' },
		curved: { label: 'Изогнутая', body: '<path d="M9 13.5L4 8.5l5-5"/><path d="M4 8.5h10a6 6 0 0 1 0 12h-3.5"/>' },
		circle: { label: 'В круге', body: '<circle cx="12" cy="12" r="8.5"/><path d="M16.5 12h-9M11 8.5L7.5 12l3.5 3.5"/>' },
		square: { label: 'В квадрате', body: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M13.5 8l-4 4 4 4"/>' },
		long: { label: 'Длинная', body: '<path d="M21 12H3M8 7l-5 5 5 5"/>' },
		block: { label: 'Объёмная', body: '<path d="M11 5L4 12l7 7v-4h8.5V9H11z"/>' },
	};

	const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
	// Готовый тег <svg>; opts: { size, width (толщина линии), cls, title }
	function svg(body, opts) {
		const o = opts || {};
		const size = o.size || 18;
		return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="' + size + '" height="' + size + '" fill="none" stroke="currentColor" stroke-width="' + (o.width || 1.8) + '" stroke-linecap="round" stroke-linejoin="round"' + (o.cls ? ' class="' + esc(o.cls) + '"' : '') + ' aria-hidden="true">' + (o.title ? '<title>' + esc(o.title) + '</title>' : '') + body + '</svg>';
	}
	function icon(name, opts) {
		const i = ICONS[name];
		return i ? svg(i.body, opts) : '';
	}
	// Стрелка набора: dir 'back' или 'forward'
	function arrow(set, dir, opts) {
		const a = ARROWS[set] || ARROWS.tri;
		return svg(dir === 'forward' ? '<g transform="matrix(-1 0 0 1 24 0)">' + a.body + '</g>' : a.body, opts);
	}
	// Иконка как data:-адрес картинки (значки вкладок, img)
	function dataUrl(name, color, width) {
		const i = ICONS[name];
		if (!i) return '';
		return 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="' + (color || '#8fa3d9') + '" stroke-width="' + (width || 2) + '" stroke-linecap="round" stroke-linejoin="round">' + i.body + '</svg>');
	}
	// Заполняет все элементы с data-icon="имя" (и data-icon-size)
	function fill(scope) {
		for (const el of (scope || document).querySelectorAll('[data-icon]')) {
			if (el.dataset.iconDone === el.dataset.icon) continue;
			el.dataset.iconDone = el.dataset.icon;
			const html = icon(el.dataset.icon, { size: Number(el.dataset.iconSize) || 18 });
			const old = el.querySelector(':scope > svg');
			if (old) old.outerHTML = html;
			else el.insertAdjacentHTML('afterbegin', html);
		}
	}

	const api = { ICONS, ARROWS, svg, icon, arrow, dataUrl, fill };
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
	else root.PROBLET_ICONS = api;
})(typeof window !== 'undefined' ? window : globalThis);
