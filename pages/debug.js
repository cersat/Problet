const status = document.getElementById('status');
document.addEventListener('click', async (e) => {
	const b = e.target.closest('button[data-debug]');
	if (!b) return;
	b.disabled = true;
	try {
		const r = await api.debug(b.dataset.debug);
		status.textContent = (r && r.message) || '';
	} catch (err) {
		status.textContent = String((err && err.message) || err);
	} finally {
		b.disabled = false;
	}
});
