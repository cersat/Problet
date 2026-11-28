// Разрешения сайтов: камера, микрофон, геолокация, уведомления, буфер обмена, запись экрана, MIDI.
// Для каждого вида есть значение по умолчанию (спрашивать, разрешать, блокировать) и исключения по сайтам.
// Эта часть чистая (без Electron): решает, что делать с запросом; окно вопроса и запоминание — в main.js.

const TYPES = ['camera', 'microphone', 'geolocation', 'notifications', 'clipboard', 'screen', 'midi'];
const VALUES = ['ask', 'allow', 'block'];
const NAMES = { camera: 'камере', microphone: 'микрофону', geolocation: 'местоположению', notifications: 'уведомлениям', clipboard: 'чтению буфера обмена', screen: 'записи экрана', midi: 'MIDI-устройствам' };

// Какие из наших видов затрагивает запрос Electron; null — этот вид разрешений не настраивается и ведёт себя как раньше
function kindsOf(permission, details) {
	const d = details || {};
	switch (permission) {
		case 'media': {
			const t = Array.isArray(d.mediaTypes) ? d.mediaTypes : d.mediaType && d.mediaType !== 'unknown' ? [d.mediaType] : ['video', 'audio'];
			const out = [];
			if (t.includes('video')) out.push('camera');
			if (t.includes('audio')) out.push('microphone');
			return out.length ? out : ['camera', 'microphone'];
		}
		case 'geolocation': return ['geolocation'];
		case 'notifications': return ['notifications'];
		case 'clipboard-read': return ['clipboard'];
		case 'display-capture': return ['screen'];
		case 'midi':
		case 'midiSysex': return ['midi'];
		default: return null;
	}
}

// state: { defaults: { вид: значение }, sites: { источник: { вид: значение } } }; extra — временные решения (инкогнито), они сильнее
function decide(kinds, origin, state, extra) {
	let result = 'allow';
	for (const k of kinds) {
		const v = (extra && extra[origin] && extra[origin][k]) || (state.sites[origin] && state.sites[origin][k]) || state.defaults[k] || 'ask';
		if (v === 'block') return 'block';
		if (v === 'ask') result = 'ask';
	}
	return result;
}

module.exports = { TYPES, VALUES, NAMES, kindsOf, decide };
