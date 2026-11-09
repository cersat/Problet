const { contextBridge, ipcRenderer } = require('electron');

function applyTheme(t) {
	const root = document.documentElement;
	if (!root) return;
	root.dataset.theme = t.dark ? 'dark' : 'light';
	root.style.setProperty('--accent', t.accent);
	root.style.setProperty('--accent-soft', t.accentSoft);
	root.style.setProperty('--on-accent', t.onAccent);
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
	go: (text) => ipcRenderer.send('go', text),
	back: () => ipcRenderer.send('back'),
	forward: () => ipcRenderer.send('forward'),
	reload: () => ipcRenderer.send('reload'),
	toggleBookmark: () => ipcRenderer.send('toggle-bookmark'),
	openInternal: (name) => ipcRenderer.send('open-internal', name),
	newTab: () => ipcRenderer.send('tab-new'),
	activateTab: (id) => ipcRenderer.send('tab-activate', id),
	closeTab: (id) => ipcRenderer.send('tab-close', id),
	tabMenu: (id) => ipcRenderer.send('tab-menu', id),
	tabRename: (id, name) => ipcRenderer.send('tab-rename', id, name),
	onTabRename: (cb) => ipcRenderer.on('tab-rename', (_e, id) => cb(id)),
	tabsScale: (v) => ipcRenderer.send('tabs-scale', v),
	customButton: (id) => ipcRenderer.send('custom-button', id),
	barMenu: (id) => ipcRenderer.send('bar:menu', id),
	moveTab: (id, to) => ipcRenderer.send('tab-move', id, to),
	suggestQuery: (msg) => ipcRenderer.send('suggest-query', msg),
	suggestMove: (dir) => ipcRenderer.send('suggest-move', dir),
	suggestHide: () => ipcRenderer.send('suggest-hide'),
	onState: (cb) => ipcRenderer.on('state', (_e, state) => cb(state)),
	pwOfferAccept: () => ipcRenderer.send('pw-offer-accept'),
	zoomReset: () => ipcRenderer.send('zoom-reset'),
	updateTip: (rect) => ipcRenderer.send('update-tip', rect),
	updateApply: () => ipcRenderer.send('update-apply'),
	updateState: () => ipcRenderer.sendSync('update-get'),
	onUpdate: (cb) => ipcRenderer.on('update-state', (_e, st) => cb(st)),
	onDownloadsBusy: (cb) => ipcRenderer.on('downloads-busy', (_e, n) => cb(n)),
	onTabs: (cb) => ipcRenderer.on('tabs', (_e, data) => cb(data)),
	onFocusAddress: (cb) => ipcRenderer.on('focus-address', () => cb()),
	onSetAddress: (cb) => ipcRenderer.on('set-address', (_e, msg) => cb(msg)),
	layout: () => ipcRenderer.sendSync('layout:get'),
	onLayout: (cb) => ipcRenderer.on('layout', (_e, l) => cb(l)),
	bar: () => ipcRenderer.sendSync('bar:get'),
	onBar: (cb) => ipcRenderer.on('bar', (_e, b) => cb(b)),
	barOpen: (id, newTab) => ipcRenderer.send('bar:open', id, !!newTab),
	barFolder: (id) => ipcRenderer.send('bar:folder', id),
	newTabMenu: () => ipcRenderer.send('newtab-menu'),
	openApplet: (kind, rect) => ipcRenderer.send('applet-open', kind, rect),
	winMinimize: () => ipcRenderer.send('win:minimize'),
	winMaximize: () => ipcRenderer.send('win:maximize'),
	winClose: () => ipcRenderer.send('win:close'),
	onSuggestVisible: (cb) => ipcRenderer.on('suggest-visible', (_e, visible) => cb(visible)),
});
