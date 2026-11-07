const $ = (id) => document.getElementById(id);
const target = new URLSearchParams(location.search).get('u') || '';
let host = '';
try {
	host = new URL(target).host;
} catch (e) { /* адрес не разобрался */ }
$('host').textContent = host || '?';
$('url').textContent = target;
$('go').disabled = !host;
$('back').addEventListener('click', () => {
	if (history.length > 1) history.back();
	else location.href = 'problet://newtab';
});
$('go').addEventListener('click', () => api.insecureProceed(target).catch((e) => { $('url').textContent = String(e.message || e); }));
