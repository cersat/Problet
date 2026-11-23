// Блокировщик и защита: своё правило режет запрос, счётчик заблокированного, выключенный блокировщик ничего не режет,
// предупреждение о сайте без шифрования (http) и переход «всё равно открыть»
module.exports = {
	title: 'Блокировщик рекламы и предупреждение о http',
	gui: true,
	async run(t) {
		const base = t.server.base;
		const b = await t.browser({ settings: { adblock: true, customBlock: '127.0.0.1/ads/', warnInsecure: true } });
		const from = t.server.hits.length; // сайт общий для всех групп: считаем запросы только этой группы
		await b.go(base + '/', 2000);
		let pg = await b.page((u) => u === base + '/');
		let r = await pg.ev(`[String(window.adLoaded), String(window.okLoaded)]`);
		t.check('своё правило блокирует скрипт «рекламы», остальное грузится', r[0] === 'undefined' && r[1] === '1', r);
		t.check('сервер не получил запрос к заблокированному', !t.server.hits.slice(from).includes('/ads/banner.js'));
		await b.go('problet://settings/', 1200);
		const stats = await b.fe(`w.problet.adblockStats()`);
		t.check('счётчик заблокированного вырос', stats.session >= 1 && stats.total >= 1, stats);
		await b.fe(`w.problet.setSettings({ adblock: false })`);
		await b.go(base + '/?2', 2000);
		pg = await b.page((u) => u === base + '/?2');
		r = await pg.ev(`String(window.adLoaded)`);
		t.check('выключенный блокировщик ничего не режет', r === '1', r);

		// http без шифрования (локальные адреса не трогаем)
		await b.go('http://example.com/', 1500);
		let s = await b.st();
		t.check('сайт по http — сначала предупреждение', s.virtual && /insecure/.test(s.src || ''), s);
		await b.fe(`d.getElementById('go').click()`);
		await t.sleep(1500);
		s = await b.st();
		t.check('«всё равно открыть» уходит на сайт', !s.virtual && s.addr.includes('example.com'), s);
		await b.go(base + '/a');
		s = await b.st();
		t.check('локальный http не предупреждает', s.active === 'A', s);
		t.check('без ошибок в консоли', b.errors.length === 0, b.errors.slice(0, 5));
	},
};
