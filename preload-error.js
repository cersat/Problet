const { contextBridge, ipcRenderer } = require('electron');

// Язык окна ошибки: по нему pages/i18n.js переводит надписи
const lang = ipcRenderer.sendSync('error:lang') === 'en' ? 'en' : 'ru'; // окно может открыться и тогда, когда main.js не загрузился
const setLang = () => {
	if (document.documentElement) document.documentElement.dataset.lang = lang;
};
if (document.documentElement) setLang();
else new MutationObserver((_m, obs) => { if (document.documentElement) { obs.disconnect(); setLang(); } }).observe(document, { childList: true });

contextBridge.exposeInMainWorld('problet', {
	get: () => ipcRenderer.invoke('error:get'),
	copy: () => ipcRenderer.invoke('error:copy'),
	close: () => ipcRenderer.send('error:close'),
	safeMode: () => ipcRenderer.invoke('error:safe'),
	safeState: () => ipcRenderer.invoke('error:safe-state'),
});
