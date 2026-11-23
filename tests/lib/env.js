// Окружение тестов: временная папка, свои XDG-папки (чтобы родительский контроль и копии не попали в настоящий профиль),
// дисплей для групп с окном (Xvfb + openbox на Linux без графики)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, spawn } = require('child_process');

const root = path.join(__dirname, '..', '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'problet-tests-'));

// Каждой группе — своя «домашняя» папка настроек
function isolated(name) {
	const dir = path.join(work, name);
	fs.mkdirSync(dir, { recursive: true });
	return {
		dir,
		env: {
			...process.env,
			XDG_CONFIG_HOME: path.join(dir, 'config'),
			XDG_STATE_HOME: path.join(dir, 'state'),
			XDG_DATA_HOME: path.join(dir, 'share'),
			LANG: 'C.UTF-8',
			LC_ALL: 'C.UTF-8',
		},
	};
}

const has = (bin) => spawnSync('sh', ['-c', 'command -v ' + bin], { encoding: 'utf8' }).status === 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// На Linux без экрана поднимаем Xvfb и оконный менеджер (нужен для проверок фокуса и разворачивания окна)
let display = null;
async function ensureDisplay() {
	if (display !== null) return display;
	if (process.platform !== 'linux') return (display = process.env.DISPLAY || '');
	if (process.env.DISPLAY && spawnSync('xdpyinfo', [], { env: process.env, stdio: 'ignore' }).status === 0) return (display = process.env.DISPLAY);
	if (!has('Xvfb')) return (display = '');
	const d = ':' + (90 + Math.floor(Math.random() * 9));
	const x = spawn('Xvfb', [d, '-screen', '0', '1400x900x24'], { stdio: 'ignore', detached: true });
	x.unref();
	process.on('exit', () => { try { process.kill(-x.pid); } catch (e) { /* уже нет */ } });
	await sleep(1000);
	if (has('openbox')) {
		const wm = spawn('openbox', [], { env: { ...process.env, DISPLAY: d }, stdio: 'ignore', detached: true });
		wm.unref();
		process.on('exit', () => { try { process.kill(-wm.pid); } catch (e) { /* уже нет */ } });
		await sleep(800);
	}
	return (display = d);
}
const hasWM = () => process.platform !== 'linux' || has('openbox') || !!process.env.WINDOW_MANAGER;

module.exports = { root, work, isolated, has, sleep, ensureDisplay, hasWM };
