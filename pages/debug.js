const status = document.getElementById('status');
const safeBtn = document.getElementById('safe-btn');
const showSafe = (on) => { safeBtn.textContent = on ? 'Выключить' : 'Включить'; };
problet.getSettings().then((r) => showSafe(r.safeMode)).catch(() => {});
document.addEventListener('click', async (e) => {
	const b = e.target.closest('button[data-debug]');
	if (!b) return;
	b.disabled = true;
	try {
		const r = await problet.debug(b.dataset.debug);
		status.textContent = (r && r.message) || '';
		if (r && typeof r.safeMode === 'boolean') showSafe(r.safeMode);
	} catch (err) {
		status.textContent = String((err && err.message) || err);
	} finally {
		b.disabled = false;
	}
});
