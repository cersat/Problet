const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('errApi', {
	get: () => ipcRenderer.invoke('error:get'),
	copy: () => ipcRenderer.invoke('error:copy'),
	close: () => ipcRenderer.send('error:close'),
});
