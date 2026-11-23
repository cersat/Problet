// Ресурсы: сколько памяти и процессора ест Problet с несколькими вкладками в простое. Пороги с запасом:
// тест ловит заметный рост (утечку, лишний процесс, крутящийся таймер), а не колебания
const { spawnSync } = require('child_process');

function tree(rootPid) {
	const out = spawnSync('ps', ['-eo', 'pid=,ppid=,rss=,time=,args='], { encoding: 'utf8' }).stdout.trim().split('\n').map((l) => {
		const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+([\d:.-]+)\s+(.*)$/.exec(l);
		return m && { pid: +m[1], ppid: +m[2], rss: +m[3], time: m[4], args: m[5] };
	}).filter(Boolean);
	const keep = new Set([rootPid]);
	let grew = true;
	while (grew) {
		grew = false;
		for (const p of out) if (!keep.has(p.pid) && keep.has(p.ppid)) { keep.add(p.pid); grew = true; }
	}
	return out.filter((p) => keep.has(p.pid));
}
const secs = (s) => s.split(/[:-]/).reduce((a, x) => a * 60 + Number(x), 0);

module.exports = {
	title: 'Ресурсы: память и процессор в простое с четырьмя вкладками',
	gui: true,
	async run(t) {
		if (process.platform !== 'linux') t.skip('замер через ps — только Linux');
		const base = t.server.base;
		const b = await t.browser();
		await b.go(base + '/a', 1000);
		for (const u of ['/b', '/find', '/long']) await b.newTab(base + u, 1000);
		await t.sleep(5000);
		const p1 = tree(b.proc.pid);
		const mem = Math.round(p1.reduce((a, p) => a + p.rss, 0) / 1024);
		const cpu0 = p1.reduce((a, p) => a + secs(p.time), 0);
		await t.sleep(20000);
		const p2 = tree(b.proc.pid);
		const cpu1 = p2.reduce((a, p) => a + secs(p.time), 0);
		const idle = ((cpu1 - cpu0) / 20) * 100;
		const main = p1.find((p) => p.pid === b.proc.pid);
		console.log('  память ' + mem + ' МБ (главный ' + Math.round(main.rss / 1024) + ' МБ), процессов ' + p1.length + ', процессор в простое ' + idle.toFixed(1) + '%');
		t.check('память с 4 вкладками меньше 1500 МБ', mem < 1500, mem);
		t.check('главный процесс меньше 350 МБ', main.rss / 1024 < 350, Math.round(main.rss / 1024));
		t.check('процессов не больше 12', p1.length <= 12, p1.map((p) => p.args.replace(/^.*--type=([\w-]+).*$/, '$1').slice(0, 30)));
		t.check('в простое процессор почти не занят (меньше 5%)', idle < 5, idle);
	},
};
