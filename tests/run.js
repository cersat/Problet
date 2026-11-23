// Тесты Problet по группам.
//   node tests/run.js              — все группы
//   node tests/run.js 05 parental  — только группы, в имени которых есть «05» или «parental»
//   node tests/run.js --list       — список групп
// Группа — файл tests/groups/NN-имя.js: module.exports = { title, gui (нужно окно), run: async (t) => {...} }.
// В t: check(имя, условие, подробности), skip(причина), sleep, env (свои XDG-папки), dir (временная папка группы),
// server (локальный сайт), browser(opts) — запуск Problet. Код выхода 0 — всё прошло
const fs = require('fs');
const path = require('path');
const env = require('./lib/env');
const browser = require('./lib/browser');
const server = require('./lib/server');

const GROUP_TIMEOUT = 6 * 60 * 1000;

async function main() {
	const args = process.argv.slice(2);
	const dir = path.join(__dirname, 'groups');
	let files = fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort();
	if (args.includes('--list')) {
		for (const f of files) console.log(f.replace(/\.js$/, '').padEnd(28) + require(path.join(dir, f)).title);
		return 0;
	}
	const filters = args.filter((a) => !a.startsWith('--'));
	if (filters.length) files = files.filter((f) => filters.some((x) => f.includes(x)));

	const site = await server.start();
	const summary = [];
	let total = 0;
	let bad = 0;
	for (const f of files) {
		const group = require(path.join(dir, f));
		const name = f.replace(/\.js$/, '');
		console.log('\n=== ' + name + ' — ' + group.title);
		const iso = env.isolated(name);
		const started = [];
		let ok = 0;
		let fail = 0;
		let skipped = '';
		const t = {
			env: iso.env,
			dir: iso.dir,
			server: site,
			sleep: env.sleep,
			waitFor: browser.waitFor,
			check(label, cond, info) {
				if (cond) ok++;
				else fail++;
				console.log((cond ? '  OK   ' : '  FAIL ') + label + (!cond && info !== undefined ? '  -> ' + JSON.stringify(info).slice(0, 600) : ''));
				return !!cond;
			},
			skip(reason) {
				skipped = reason;
				throw new SkipGroup();
			},
			async browser(opts = {}) {
				const b = await browser.start({ env: iso.env, dir: path.join(iso.dir, opts.profile || 'profile'), ...opts });
				started.push(b);
				return b;
			},
		};
		const t0 = Date.now();
		try {
			if (group.gui && !(await env.ensureDisplay())) t.skip('нет дисплея');
			await Promise.race([group.run(t), new Promise((_, rej) => setTimeout(() => rej(new Error('группа не уложилась в ' + GROUP_TIMEOUT / 60000 + ' мин')), GROUP_TIMEOUT))]);
		} catch (e) {
			if (!(e instanceof SkipGroup)) {
				fail++;
				console.log('  FAIL группа упала: ' + String((e && e.stack) || e).split('\n').slice(0, 4).join(' | '));
			}
		}
		for (const b of started) await b.close();
		const secs = Math.round((Date.now() - t0) / 1000);
		if (skipped) console.log('  ПРОПУЩЕНО: ' + skipped);
		summary.push({ name, ok, fail, secs, skipped });
		total += ok + fail;
		bad += fail;
	}
	site.close();
	console.log('\n=== Итого');
	for (const s of summary) console.log((s.skipped ? 'SKIP ' : s.fail ? 'FAIL ' : 'OK   ') + s.name.padEnd(28) + String(s.ok).padStart(4) + ' ok' + (s.fail ? ', ' + s.fail + ' fail' : '') + ('  ' + s.secs + ' с').padStart(8) + (s.skipped ? '  (' + s.skipped + ')' : ''));
	console.log((bad ? 'ПРОВАЛЕНО: ' + bad + ' из ' + total : 'ВСЁ ЗЕЛЁНОЕ: ' + total + ' проверок') + ', групп ' + summary.length);
	fs.rmSync(env.work, { recursive: true, force: true });
	return bad ? 1 : 0;
}

class SkipGroup extends Error {}

main().then((code) => process.exit(code), (e) => {
	console.error(e);
	process.exit(2);
});
