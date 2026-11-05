const q = document.getElementById('q');
const count = document.getElementById('count');

const run = (forward, next) => api.find(q.value, forward, next);

q.addEventListener('input', () => run(true, false));
q.addEventListener('keydown', (e) => {
	if (e.key === 'Enter') {
		e.preventDefault();
		run(!e.shiftKey, true);
	} else if (e.key === 'Escape') {
		api.close();
	}
});
document.getElementById('next').addEventListener('click', () => run(true, true));
document.getElementById('prev').addEventListener('click', () => run(false, true));
document.getElementById('close').addEventListener('click', () => api.close());

api.onOpen((text) => {
	q.value = text || '';
	count.textContent = '';
	q.focus();
	q.select();
	if (q.value) run(true, false);
});

api.onResult(({ active, total }) => {
	count.textContent = q.value ? (total ? active + ' / ' + total : 'Нет') : '';
});
