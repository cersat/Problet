// Устройства аккаунта, синхронизация вкладок, пространства «инкогнито» и «локальное», разрешения сайтов.
// Сервер аккаунтов тестовый, в памяти (tests/lib/syncserver.js)
const sync = require('../lib/syncserver');
const permissions = require('../../permissions');

module.exports = {
	title: 'Устройства, вкладки и пространства в синхронизации, разрешения сайтов',
	gui: true,
	async run(t) {
		// Чистая часть разрешений: какие запросы настраиваются и как решается ответ
		t.check('media с видео — это камера', permissions.kindsOf('media', { mediaTypes: ['video'] }).join() === 'camera');
		t.check('media с видео и звуком — камера и микрофон', permissions.kindsOf('media', { mediaTypes: ['video', 'audio'] }).join() === 'camera,microphone');
		t.check('полный экран не настраивается', permissions.kindsOf('fullscreen', {}) === null);
		const st0 = { defaults: { geolocation: 'block' }, sites: { 'https://a.example': { geolocation: 'allow', camera: 'block' } } };
		t.check('исключение сайта сильнее значения по умолчанию', permissions.decide(['geolocation'], 'https://a.example', st0) === 'allow');
		t.check('без исключения действует значение по умолчанию', permissions.decide(['geolocation'], 'https://b.example', st0) === 'block');
		t.check('без значений спрашиваем', permissions.decide(['microphone'], 'https://b.example', st0) === 'ask');
		t.check('одно «блокировать» блокирует весь запрос', permissions.decide(['camera', 'microphone'], 'https://a.example', st0) === 'block');
		t.check('временное решение сильнее сохранённого', permissions.decide(['geolocation'], 'https://a.example', st0, { 'https://a.example': { geolocation: 'block' } }) === 'block');

		const srv = await sync.start();
		const base = t.server.base;
		const env = { ...t.env, PROBLET_SYNC_URL: srv.url };
		const a = await t.browser({ profile: 'a', env });
		const b = await t.browser({ profile: 'b', env });
		const ap = (code) => a.fe(`w.problet.${code}`);
		const bp = (code) => b.fe(`w.problet.${code}`);
		// Окно с внутренней страницей остаётся первой вкладкой: к ней возвращаемся после открытия сайтов
		const home = async (x) => {
			const ids = await x.tb.ev(`[...document.querySelectorAll('#tabs .tab')].map(e => Number(e.dataset.id))`);
			await x.tb.ev(`problet.activateTab(${ids[0]})`);
			await t.sleep(500);
		};
		await a.go('problet://settings/', 1000);
		await b.go('problet://settings/', 1000);
		try {
			await ap(`syncRegister('Boris_2', 'password-1', 'password-1')`);
			await bp(`syncLogin('Boris_2', 'password-1')`);

			// Устройства
			const devs = await ap(`syncDevices()`);
			t.check('в списке два устройства, одно текущее', devs.length === 2 && devs.filter((d) => d.current).length === 1, devs);
			t.check('у устройства есть имя с названием системы', devs.every((d) => /Linux|Windows|macOS/.test(d.name)), devs);
			const ui = await a.fe(`(async () => { d.querySelector('#cats button:nth-child(2)').click(); await new Promise((r) => setTimeout(r, 6500)); return [...d.querySelectorAll('#sync-devices li')].map((l) => l.textContent); })()`);
			t.check('страница настроек показывает устройства', ui.length === 2 && ui.some((x) => /это устройство/.test(x)), ui);

			// Пространства: инкогнито и локальное
			await ap(`setSettings({ syncSpaces: true, syncTabs: true, spacesMerged: true })`);
			await bp(`setSettings({ syncSpaces: true, syncTabs: true, spacesMerged: true })`);
			const shared = await ap(`spacesAdd('Общее')`);
			const local = await ap(`spacesAdd('Только тут')`);
			const priv = await ap(`spacesAdd('Тайное')`);
			await ap(`spacesSetFlag(${JSON.stringify(local)}, 'local', true)`);
			await ap(`spacesSetFlag(${JSON.stringify(priv)}, 'incognito', true)`);
			await ap(`syncNow()`);
			await bp(`syncNow()`);
			const bs = (await bp(`spaces()`)).spaces;
			t.check('обычное пространство пришло на второе устройство', bs.some((x) => x.id === shared), bs);
			t.check('локальное пространство не синхронизировалось', !bs.some((x) => x.id === local), bs);
			t.check('пространство-инкогнито пришло с флагом', !!(bs.find((x) => x.id === priv) || {}).incognito, bs);
			const as = (await ap(`spaces()`)).spaces;
			t.check('локальное пространство осталось на своём устройстве с флагом', !!(as.find((x) => x.id === local) || {}).local, as);
			// Локальное пространство переживает приход списка из аккаунта
			await ap(`spacesRename(${JSON.stringify(shared)}, 'Общее 2')`);
			await ap(`syncNow()`);
			await bp(`syncNow()`);
			await ap(`syncNow()`);
			t.check('после обмена локальное пространство не пропало', (await ap(`spaces()`)).spaces.some((x) => x.id === local));
			t.check('переименование дошло', (await bp(`spaces()`)).spaces.some((x) => x.id === shared && x.name === 'Общее 2'));

			// Вкладки: из обычного пространства уходят, из локального и инкогнито — нет
			await ap(`spacesSwitch(${JSON.stringify(shared)})`);
			await a.newTab(base + '/a?обычная', 800);
			await ap2(a, `spacesSwitch(${JSON.stringify(local)})`);
			await a.newTab(base + '/a?локальная', 800);
			await ap2(a, `spacesSwitch(${JSON.stringify(priv)})`);
			await a.newTab(base + '/a?тайная', 800);
			const incog = await a.tb.ev(`[...document.querySelectorAll('#tabs .tab.incognito')].length`);
			t.check('новая вкладка в пространстве-инкогнито — инкогнито', incog === 1, incog);
			await home(a);
			await ap(`syncNow()`);
			await bp(`syncNow()`);
			const remote = await bp(`syncRemoteTabs()`);
			const urls = remote.flatMap((d) => d.tabs.map((x) => x.url));
			t.check('вкладки других устройств пришли', remote.length === 1 && /Linux|Windows|macOS/.test(remote[0].name), remote);
			t.check('обычная вкладка в списке', urls.some((u) => u.includes('/a?') && decodeURIComponent(u).includes('обычная')), urls);
			t.check('локальная вкладка не ушла', !urls.some((u) => decodeURIComponent(u).includes('локальная')), urls);
			t.check('вкладка инкогнито не ушла', !urls.some((u) => decodeURIComponent(u).includes('тайная')), urls);
			const raw = srv.stored('Boris_2', 'tabs');
			t.check('на сервере вкладки лежат зашифрованными', raw && !/обычная|%D0%BE%D0%B1/.test(raw.data) && !/a\?/.test(raw.data), raw);
			const ui2 = await b.fe(`(async () => { d.querySelector('#cats button:nth-child(2)').click(); await new Promise((r) => setTimeout(r, 5500)); return [...d.querySelectorAll('#sync-tabs a')].map((x) => x.href); })()`);
			t.check('страница настроек показывает вкладки другого устройства', ui2.some((u) => u.includes('/a?')), ui2);

			// Выход на другом устройстве
			const second = (await ap(`syncDevices()`)).find((d) => !d.current);
			const left = await ap(`syncRemoveDevice(${JSON.stringify(second.id)})`);
			t.check('устройство убрано из списка', left.length === 1, left);
			await bp(`syncNow()`).catch(() => {});
			t.check('удалённое устройство вышло из аккаунта', !(await bp(`syncStatus()`)).logged);
			await ap(`syncNow()`);
			t.check('запись удалённого устройства ушла из вкладок', (await ap(`syncRemoteTabs()`)).length === 0);

			// Разрешения: значения по умолчанию и исключения. «Спрашивать» тут не проверяем, оно показывает окно
			const origin = new URL(base).origin;
			const geo = (x) => x.page((u) => u.startsWith(base)).then((p) => p.ev(`new Promise((r) => navigator.geolocation.getCurrentPosition(() => r(0), (e) => r(e.code), { timeout: 4000 }))`));
			await ap(`permsSetDefault('geolocation', 'block')`);
			await a.newTab(base + '/b?гео', 800);
			t.check('по умолчанию «блокировать»: доступ отклонён', (await geo(a)) === 1);
			await home(a);
			const st = await ap(`permsSetSite(${JSON.stringify(origin)}, 'geolocation', 'allow')`);
			t.check('исключение записано', st.sites[origin].geolocation === 'allow', st);
			const ids = await a.tb.ev(`[...document.querySelectorAll('#tabs .tab')].map(e => Number(e.dataset.id))`);
			await a.tb.ev(`problet.activateTab(${ids[ids.length - 1]})`);
			await t.sleep(400);
			t.check('исключение «разрешить» сильнее значения по умолчанию', (await geo(a)) !== 1);
			await home(a);
			const ui3 = await a.fe(`(async () => { d.querySelector('#cats button:nth-child(' + ([...d.querySelectorAll('#cats button')].findIndex((x) => x.textContent === 'Разрешения сайтов') + 1) + ')').click(); await new Promise((r) => setTimeout(r, 300)); return { defaults: d.querySelectorAll('#perm-defaults select').length, sites: [...d.querySelectorAll('#perm-sites li')].map((l) => l.textContent) }; })()`);
			t.check('в настройках семь видов разрешений и исключение', ui3.defaults === 7 && ui3.sites.length === 1 && ui3.sites[0].includes('геолокац') === false && ui3.sites[0].includes('Местоположение'), ui3);
			const after = await ap(`permsSetSite(${JSON.stringify(origin)}, 'geolocation', 'ask')`);
			t.check('исключение удаляется', Object.keys(after.sites).length === 0, after);
			await ap(`permsSetDefault('geolocation', 'ask')`);
			t.check('«спрашивать» возвращает значение по умолчанию', !(await ap(`permsGet()`)).defaults.geolocation);
		} finally {
			srv.close();
		}

		// Локальный помощник: действие в активной внутренней странице другого окна после смены вкладки
		async function ap2(x, code) {
			await home(x);
			return x.fe(`w.problet.${code}`);
		}
	},
};
