document.getElementById('search-form').addEventListener('submit', (e) => {
	e.preventDefault();
	const q = document.getElementById('q').value.trim();
	if (q) api.search(q);
});

// Плитки с последними закладками
async function renderTiles() {
	const { bookmarks } = await api.bookmarks();
	const tiles = document.getElementById('tiles');
	tiles.textContent = '';
	const latest = [...bookmarks].sort((a, b) => b.added - a.added).slice(0, 12);
	for (const b of latest) {
		const a = document.createElement('a');
		a.className = 'tile';
		a.href = b.url;
		a.title = b.url;
		let fav;
		if (b.icon) {
			fav = document.createElement('img');
			fav.className = 'fav';
			fav.src = b.icon;
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
		tiles.append(a);
	}
}

renderTiles();
api.onChange((kinds) => {
	if (kinds.includes('bookmarks') || kinds.includes('all')) renderTiles();
});
