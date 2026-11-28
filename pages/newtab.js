document.getElementById('search-form').addEventListener('submit', (e) => {
	e.preventDefault();
	const q = document.getElementById('q').value.trim();
	if (q) problet.search(q);
});

let opts = { ntTitle: true, ntSearch: true, ntSearchMode: 'search', ntBookmarks: true, ntBmHidden: [], ntRecent: false };

// Что показывать, решают настройки раздела «Новая вкладка»
function applyOptions() {
	document.getElementById('title').hidden = !opts.ntTitle;
	const form = document.getElementById('search-form');
	form.hidden = !opts.ntSearch;
	const q = document.getElementById('q');
	q.placeholder = opts.ntSearchMode === 'url' ? 'Адрес сайта' : 'Поиск';
	if (opts.ntSearchMode === 'all') q.placeholder = 'Поиск или адрес';
	document.getElementById('tiles').hidden = !opts.ntBookmarks;
}

function tile(b, hint) {
	const a = document.createElement('a');
	a.className = 'tile';
	a.href = b.url;
	a.title = hint || b.url;
	let fav;
	if (b.customIcon || b.icon) {
		fav = document.createElement('img');
		fav.className = 'fav' + (!b.customIcon && b.iconTone ? ' tone-' + b.iconTone : '');
		fav.src = b.customIcon || b.icon;
		fav.addEventListener('error', () => {
			const l = document.createElement('span');
			l.className = 'fav letter';
			l.textContent = (b.title[0] || '•').toUpperCase();
			fav.replaceWith(l);
		});
	} else {
		fav = document.createElement('span');
		fav.className = 'fav letter';
		fav.textContent = (b.title[0] || '•').toUpperCase();
	}
	const name = document.createElement('span');
	name.className = 'name';
	name.textContent = b.title;
	a.append(fav, name);
	return a;
}

// Плитки с последними закладками
async function renderTiles() {
	const { bookmarks } = await problet.bookmarks();
	const tiles = document.getElementById('tiles');
	tiles.textContent = '';
	const hide = new Set(opts.ntBmHidden || []);
	const latest = bookmarks.filter((b) => b.folder !== 'hidden' && !hide.has(b.id)).sort((a, b) => b.added - a.added).slice(0, opts.ntBmHidden && opts.ntBmHidden.length ? 24 : 12);
	for (const b of latest) tiles.append(tile(b));
	headings();
}

// Часто посещаемые сайты: счётчик посещений по истории
async function renderTop() {
	const list = await problet.topSites();
	const box = document.getElementById('top');
	box.textContent = '';
	for (const s of list) {
		const n = s.count;
		const word = n % 10 === 1 && n % 100 !== 11 ? 'посещение' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'посещения' : 'посещений';
		const t = tile({ url: s.url, title: s.host, icon: s.icon }, s.url + '\n' + n + ' ' + word);
		const badge = document.createElement('span');
		badge.className = 'count';
		badge.textContent = n;
		t.append(badge);
		box.append(t);
	}
	headings();
}

// Заголовки нужны, только когда видны оба ряда плиток
function headings() {
	const rows = ['recent', 'top', 'tiles'].filter((id) => !document.getElementById(id).hidden && document.getElementById(id).children.length > 0);
	const both = rows.length > 1;
	document.getElementById('recent-head').hidden = !both || !rows.includes('recent');
	document.getElementById('top-head').hidden = !both || !rows.includes('top');
	document.getElementById('bm-head').hidden = !both || !rows.includes('tiles');
}

// Недавно открытые страницы
async function renderRecent() {
	const list = opts.ntRecent ? await problet.recentVisits() : [];
	const box = document.getElementById('recent');
	box.textContent = '';
	for (const v of list) box.append(tile({ url: v.url, title: v.title, icon: v.icon }, v.url));
	headings();
}

async function refresh() {
	try {
		opts = { ...opts, ...(await problet.getSettings()).settings };
	} catch (e) { /* остаются значения по умолчанию */ }
	applyOptions();
	renderTiles();
	renderTop();
	renderRecent();
}

refresh();
problet.onChange((kinds) => {
	if (kinds.includes('settings') || kinds.includes('all')) refresh();
	else {
		if (kinds.includes('bookmarks')) renderTiles();
		if (kinds.includes('visits')) {
			renderTop();
			renderRecent();
		}
	}
});
