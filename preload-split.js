// Разделитель двух страниц: тянется мышью, главный процесс получает положение курсора на экране
const { ipcRenderer } = require('electron');
let drag = false;
addEventListener('mousedown', (e) => {
	if (e.button !== 0) return;
	drag = true;
	document.body.classList.add('drag');
});
addEventListener('mousemove', (e) => {
	if (drag) ipcRenderer.send('split:move', e.screenX);
});
addEventListener('mouseup', () => {
	drag = false;
	ipcRenderer.send('split:end');
	document.body.classList.remove('drag');
});
addEventListener('dblclick', () => ipcRenderer.send('split:move', null)); // двойной щелчок возвращает пополам
