// Страница первого запуска: problet://welcome/ — язык и несколько главных настроек
const $ = (id) => document.getElementById(id);
const FIELDS = ['language', 'darkTheme', 'tabsPos', 'bookmarksBar', 'engine'];

async function save(patch) {
	try {
		await problet.setSettings(patch);
	} catch (e) { /* не записалось: страница настроек покажет то, что есть */ }
}

(async () => {
	const r = await problet.getSettings();
	for (const e of r.engines) {
		const o = document.createElement('option');
		o.value = e.id;
		o.textContent = e.name;
		$('engine').append(o);
	}
	for (const key of FIELDS) {
		const el = $(key);
		const v = r.settings[key];
		if (el.type === 'checkbox') el.checked = !!v;
		else el.value = String(v);
		el.addEventListener('change', () => save({ [key]: el.type === 'checkbox' ? el.checked : el.value }));
	}
})();

const msg = (text, bad) => {
	$('msg').textContent = text || '';
	$('msg').style.color = bad ? 'var(--danger, #d44)' : '';
};

function showAccount(st) {
	$('acc-out').classList.toggle('hidden', st.logged);
	$('acc-in').classList.toggle('hidden', !st.logged);
	$('acc-in').textContent = st.logged ? 'Вход выполнен: ' + st.nick : '';
}

async function account(kind) {
	msg('');
	try {
		const nick = $('acc-nick').value.trim();
		const st = kind === 'login' ? await problet.syncLogin(nick, $('acc-pass').value) : await problet.syncRegister(nick, $('acc-pass').value, $('acc-pass2').value);
		if ($('acc-sync').checked) await problet.setSettings({ syncBookmarks: true, syncSpaces: true, syncSettings: true, syncTabs: true });
		for (const id of ['acc-pass', 'acc-pass2']) $(id).value = '';
		showAccount(st);
	} catch (e) {
		msg(e.message, true);
	}
}
$('acc-login').addEventListener('click', () => account('login'));
$('acc-register').addEventListener('click', () => account('register'));
problet.syncStatus().then(showAccount).catch(() => {});

$('restore').addEventListener('click', async () => {
	msg('');
	try {
		const r = await problet.importAll($('file-pass').value);
		if (!r.canceled) msg(r.message);
	} catch (e) {
		msg(e.message, true);
	}
});

$('done').addEventListener('click', () => problet.welcomeDone());
