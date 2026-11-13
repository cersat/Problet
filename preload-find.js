const { contextBridge, ipcRenderer } = require('electron');

function applyTheme(t) {
	const root = document.documentElement;
	if (!root) return;
	root.dataset.theme = t.dark ? 'dark' : 'light';
	root.style.setProperty('--accent', t.accent);
	root.style.setProperty('--accent-soft', t.accentSoft);
	root.style.setProperty('--on-accent', t.onAccent);
	for (const [k, v] of Object.entries(t.vars || {})) root.style.setProperty(k, v); // оттенок фона и контраст
}
function watchTheme() {
	let current = ipcRenderer.sendSync('theme:get');
	const apply = () => applyTheme(current);
	if (document.documentElement) apply();
	else new MutationObserver((_m, obs) => { if (document.documentElement) { obs.disconnect(); apply(); } }).observe(document, { childList: true });
	ipcRenderer.on('theme', (_e, t) => { current = t; apply(); });
}
watchTheme();

contextBridge.exposeInMainWorld('api', {
	find: (text, forward, next) => ipcRenderer.send('find-query', { text, forward, next }),
	close: () => ipcRenderer.send('find-close'),
	onOpen: (cb) => ipcRenderer.on('find-open', (_e, text) => cb(text)),
	onResult: (cb) => ipcRenderer.on('find-result', (_e, r) => cb(r)),
});
