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
	pick: (i) => ipcRenderer.send('popup-pick', i),
	remove: (i) => ipcRenderer.send('popup-delete', i),
	onRender: (cb) => ipcRenderer.on('render', (_e, payload) => cb(payload)),
});
