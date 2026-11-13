const { contextBridge, ipcRenderer } = require('electron');

// Язык окна ошибки: по нему pages/i18n.js переводит надписи
const lang = ipcRenderer.sendSync('theme:get').lang === 'en' ? 'en' : 'ru';
const setLang = () => {
	if (document.documentElement) document.documentElement.dataset.lang = lang;
};
if (document.documentElement) setLang();
else new MutationObserver((_m, obs) => { if (document.documentElement) { obs.disconnect(); setLang(); } }).observe(document, { childList: true });

contextBridge.exposeInMainWorld('errApi', {
	get: () => ipcRenderer.invoke('error:get'),
	copy: () => ipcRenderer.invoke('error:copy'),
	close: () => ipcRenderer.send('error:close'),
});
