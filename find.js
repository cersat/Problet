PROBLET_ICONS.fill();
const q = document.getElementById('q');
const count = document.getElementById('count');

const run = (forward, next) => problet.find(q.value, forward, next);

q.addEventListener('input', () => run(true, false));
q.addEventListener('keydown', (e) => {
	if (e.key === 'Enter') {
		e.preventDefault();
		run(!e.shiftKey, true);
	} else if (e.key === 'Escape') {
		problet.close();
	}
});
document.getElementById('next').addEventListener('click', () => run(true, true));
document.getElementById('prev').addEventListener('click', () => run(false, true));
document.getElementById('close').addEventListener('click', () => problet.close());

problet.onOpen((text) => {
	q.value = text || '';
	count.textContent = '';
	q.focus();
	q.select();
	if (q.value) run(true, false);
});

problet.onResult(({ active, total }) => {
	count.textContent = q.value ? (total ? active + ' / ' + total : 'Нет') : '';
});
