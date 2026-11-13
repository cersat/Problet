document.getElementById('search-form').addEventListener('submit', (e) => {
	e.preventDefault();
	const q = document.getElementById('q').value.trim();
	if (q) api.search(q);
});

function tile(b, hint) {
	const a = document.createElement('a');
	a.className = 'tile';
	a.href = b.url;
	a.title = hint || b.url;
	let fav;
	if (b.customIcon || b.icon) {
		fav = document.createElement('img');
		fav.className = 'fav';
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
	const { bookmarks } = await api.bookmarks();
	const tiles = document.getElementById('tiles');
	tiles.textContent = '';
	const latest = [...bookmarks].sort((a, b) => b.added - a.added).slice(0, 12);
	for (const b of latest) tiles.append(tile(b));
	headings();
}

// Часто посещаемые сайты: счётчик посещений по истории
async function renderTop() {
	const list = await api.topSites();
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
	const both = document.getElementById('top').children.length > 0 && document.getElementById('tiles').children.length > 0;
	document.getElementById('top-head').hidden = !both;
	document.getElementById('bm-head').hidden = !both;
}

renderTiles();
renderTop();
api.onChange((kinds) => {
	if (kinds.includes('bookmarks') || kinds.includes('all')) renderTiles();
	if (kinds.includes('visits') || kinds.includes('settings') || kinds.includes('all')) renderTop();
});
