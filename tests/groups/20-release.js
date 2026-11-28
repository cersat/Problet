// Состояние проекта: последний Electron, открытые issue и pull request, поднятая версия, зелёная сборка.
// Эти проверки смотрят на GitHub и npm, поэтому без сети падают с пометкой «не удалось проверить»: молча проходить им нельзя
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.join(__dirname, '..', '..');

const MAIN = 'cersat/Problet';
const ADDONS = 'cersat/ProbletAddons';

// Запрос к REST API GitHub: сначала через gh (он залогинен и без лимитов), потом напрямую
function gh(route) {
	const r = spawnSync('gh', ['api', route], { encoding: 'utf8', timeout: 30000 });
	if (r.status === 0) {
		try { return JSON.parse(r.stdout); } catch (e) { /* ответ не JSON */ }
	}
	return null;
}

async function ghFetch(route) {
	const viaGh = gh(route);
	if (viaGh) return viaGh;
	const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'problet-tests' };
	if (process.env.GH_TOKEN) headers.Authorization = 'Bearer ' + process.env.GH_TOKEN;
	const res = await fetch('https://api.github.com/' + route, { headers });
	if (!res.ok) throw new Error('GitHub ответил ' + res.status);
	return res.json();
}

function git(args) {
	const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout: 30000 });
	return r.status === 0 ? r.stdout.trim() : null;
}

const newer = (a, b) => {
	const x = a.split('.').map(Number);
	const y = b.split('.').map(Number);
	for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
	return false;
};

module.exports = {
	title: 'Состояние проекта: Electron, issue и PR, версия, сборка',
	async run(t) {
		const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

		// Electron: стоит ли последняя версия (если в package.json указано latest — проверять нечего)
		const spec = String((pkg.devDependencies && pkg.devDependencies.electron) || (pkg.dependencies && pkg.dependencies.electron) || '');
		if (spec === 'latest') {
			t.check('Electron: в package.json указан latest', true);
		} else {
			let latest = null;
			try {
				const res = await fetch('https://registry.npmjs.org/electron/latest', { headers: { 'User-Agent': 'problet-tests' } });
				if (res.ok) latest = (await res.json()).version;
			} catch (e) { /* нет сети */ }
			if (!latest) {
				const r = spawnSync('npm', ['view', 'electron', 'version'], { encoding: 'utf8', timeout: 30000 });
				if (r.status === 0) latest = r.stdout.trim();
			}
			let installed = '';
			try { installed = JSON.parse(fs.readFileSync(path.join(root, 'node_modules', 'electron', 'package.json'), 'utf8')).version; } catch (e) { /* не установлен */ }
			t.check('Electron: установленная версия — последняя (' + (latest || '?') + ')', !!latest && installed === latest, { installed, latest, spec });
			const declared = spec.replace(/^[\^~]/, '');
			t.check('Electron: версия в package.json совпадает с установленной', declared === installed, { declared, installed });
		}

		// Открытые issue и pull request
		for (const repo of [MAIN, ADDONS]) {
			let list = null;
			try { list = await ghFetch('repos/' + repo + '/issues?state=open&per_page=100'); } catch (e) { /* нет сети */ }
			if (!list) {
				t.check('не удалось проверить issue в ' + repo, false, 'нет ответа GitHub');
				continue;
			}
			const issues = list.filter((x) => !x.pull_request);
			const prs = list.filter((x) => x.pull_request);
			t.check('в ' + repo + ' нет открытых issue', issues.length === 0, issues.map((x) => '#' + x.number + ' ' + x.title));
			if (repo === ADDONS) t.check('в ' + repo + ' нет открытых pull request', prs.length === 0, prs.map((x) => '#' + x.number + ' ' + x.title));
		}

		// Версия поднята: если программа изменилась относительно origin/main, версия должна быть больше
		// fetch кладёт ветку в FETCH_HEAD (отслеживаемой origin/main в этом клоне может не быть)
		const ref = git(['fetch', '--quiet', 'origin', 'main']) !== null ? 'FETCH_HEAD' : 'origin/main';
		const base = git(['show', ref + ':package.json']);
		if (!base) {
			t.check('не удалось сравнить версию с origin/main', false, 'нет origin/main');
		} else {
			const baseVer = JSON.parse(base).version;
			const files = (git(['diff', '--name-only', ref]) || '').split('\n').filter(Boolean);
			const program = files.filter((f) => !/^(docs\/|\.github\/|tests\/|tools\/)/.test(f) && !/\.md$/.test(f) && f !== 'package.json' && f !== 'package-lock.json');
			if (program.length) t.check('программа изменилась (' + program.length + ' файлов): версия выше, чем в origin/main (' + baseVer + ')', newer(pkg.version, baseVer), { now: pkg.version, base: baseVer, files: program.slice(0, 5) });
			else t.check('программа не менялась: версия не обязана расти', true);
			if (!program.length && files.some((f) => f === 'package.json')) t.check('менялся только package.json: версия не ниже прежней', !newer(baseVer, pkg.version), { now: pkg.version, base: baseVer });
		}

		// package-lock.json знает ту же версию
		let lock = null;
		try { lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8')); } catch (e) { /* нет файла */ }
		t.check('версия в package-lock.json совпадает с package.json', !!lock && lock.version === pkg.version && (!lock.packages || !lock.packages[''] || lock.packages[''].version === pkg.version), { lock: lock && lock.version, pkg: pkg.version });

		// Последняя завершённая сборка на main не красная
		let runs = null;
		try { runs = await ghFetch('repos/' + MAIN + '/actions/runs?branch=main&status=completed&per_page=5'); } catch (e) { /* нет сети */ }
		if (!runs || !runs.workflow_runs) {
			t.check('не удалось проверить последнюю сборку', false, 'нет ответа GitHub');
		} else {
			const last = runs.workflow_runs.find((r) => r.name === 'Сборка');
			t.check('последняя завершённая сборка на main зелёная', !last || last.conclusion === 'success', last && { run: last.id, conclusion: last.conclusion, sha: String(last.head_sha).slice(0, 7) });
		}
	},
};
