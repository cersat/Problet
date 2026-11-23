// Настройки → Родительский контроль. Всё проверяет главный процесс: без пароля он не отдаст и не примет настройки
(function () {
	const el = (id) => document.getElementById(id);
	const fail = (e) => say(errText(e), true);
	let st = null; // { on, hasPass, unlocked, minPass }
	let cfg = null;
	let ask = null; // что подтверждаем паролем: { on }

	const EN = () => document.documentElement.dataset.lang === 'en' || document.documentElement.lang === 'en';
	const L = (ru, en) => (EN() ? en : ru);
	const span = (ms) => {
		const m = Math.round(ms / 60000);
		if (m < 60) return m + L(' мин', ' min');
		const h = Math.floor(m / 60);
		return h + L(' ч', ' h') + (m % 60 ? ' ' + (m % 60) + L(' мин', ' min') : '');
	};
	const when = (t) => new Date(t).toLocaleString(EN() ? 'en-GB' : 'ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });

	async function refresh() {
		st = await problet.parentalStatus();
		const locked = st.on && !st.unlocked;
		el('pc-lock').hidden = !locked;
		el('pc-body').hidden = locked;
		el('pc-on').checked = st.on;
		el('pc-on-only').hidden = !st.on;
		if (locked || !st.on) return;
		cfg = await problet.parentalGet();
		show();
		await stats();
	}

	function show() {
		el('pc-time').checked = cfg.time.on;
		el('pc-time-row').hidden = !cfg.time.on;
		el('pc-limit-n').value = cfg.time.limit.n;
		el('pc-limit-unit').value = cfg.time.limit.unit;
		el('pc-period-n').value = cfg.time.period.n;
		el('pc-period-unit').value = cfg.time.period.unit;
		el('pc-sites').checked = cfg.sites.on;
		el('pc-sites-rows').hidden = !cfg.sites.on;
		el('pc-white').checked = cfg.sites.white;
		el('pc-list').value = cfg.sites.list.join('\n');
	}

	function row(table, cells) {
		const tr = document.createElement('tr');
		for (const c of cells) {
			const td = document.createElement('td');
			td.textContent = c;
			tr.append(td);
		}
		table.append(tr);
	}
	async function stats() {
		const s = await problet.parentalStats();
		el('pc-used').textContent = s.timeOn ? L('Сейчас использовано ', 'Used now: ') + span(Math.min(s.used, s.limit)) + L(' из ', ' of ') + span(s.limit) : '';
		el('pc-refresh').textContent = L('Обновить', 'Refresh');
		const hosts = el('pc-hosts');
		hosts.textContent = '';
		for (const h of s.hosts) row(hosts, [h.key, span(h.ms), when(h.last)]);
		if (!s.hosts.length) row(hosts, [L('Пока пусто', 'Nothing yet')]);
		const att = el('pc-attempts');
		att.textContent = '';
		for (const a of s.attempts) row(att, [when(a.t), a.url, a.reason === 'time' ? L('время вышло', 'time is up') : L('сайт закрыт', 'site blocked')]);
		if (!s.attempts.length) row(att, [L('Пока пусто', 'Nothing yet')]);
	}

	async function save(patch) {
		try {
			cfg = await problet.parentalSet(patch);
			show();
			say(L('Сохранено', 'Saved'));
		} catch (e) {
			fail(e);
			refresh().catch(fail);
		}
	}

	// Главный свитч: первый раз придумываем пароль, потом вводим его
	el('pc-on').addEventListener('change', () => {
		const on = el('pc-on').checked;
		el('pc-on').checked = !on; // пока пароль не подтверждён, ничего не меняем
		ask = { on };
		const create = !st.hasPass;
		el('pc-ask-title').textContent = create ? L('Придумай пароль родительского контроля (не меньше ' + st.minPass + ' символов)', 'Create a parental control password (at least ' + st.minPass + ' characters)') : L('Введи пароль родительского контроля', 'Enter the parental control password');
		el('pc-ask-pass2').hidden = !create;
		el('pc-ask-pass').value = '';
		el('pc-ask-pass2').value = '';
		el('pc-ask').hidden = false;
		el('pc-ask-pass').focus();
	});
	el('pc-ask-cancel').addEventListener('click', () => {
		ask = null;
		el('pc-ask').hidden = true;
	});
	el('pc-ask').addEventListener('submit', async (e) => {
		e.preventDefault();
		if (!ask) return;
		const pw = el('pc-ask-pass').value;
		if (!st.hasPass) {
			if (pw.length < st.minPass) return say(L('Пароль слишком короткий', 'The password is too short'), true);
			if (pw !== el('pc-ask-pass2').value) return say(L('Пароли не совпадают', 'The passwords do not match'), true);
		}
		try {
			await problet.parentalSetOn(ask.on, pw);
			ask = null;
			el('pc-ask').hidden = true;
			say(st.on ? L('Родительский контроль выключен', 'Parental control is off') : L('Родительский контроль включён', 'Parental control is on'));
			await refresh();
		} catch (err) {
			fail(err);
			el('pc-ask-pass').select();
		}
	});
	el('pc-lock').addEventListener('submit', async (e) => {
		e.preventDefault();
		try {
			await problet.parentalUnlock(el('pc-lock-pass').value);
			el('pc-lock-pass').value = '';
			await refresh();
		} catch (err) {
			fail(err);
			el('pc-lock-pass').select();
		}
	});

	el('pc-time').addEventListener('change', () => save({ time: { on: el('pc-time').checked } }));
	const span2 = () => save({ time: { limit: { n: Number(el('pc-limit-n').value), unit: el('pc-limit-unit').value }, period: { n: Number(el('pc-period-n').value), unit: el('pc-period-unit').value } } });
	for (const id of ['pc-limit-n', 'pc-limit-unit', 'pc-period-n', 'pc-period-unit']) el(id).addEventListener('change', span2);
	el('pc-sites').addEventListener('change', () => save({ sites: { on: el('pc-sites').checked } }));
	el('pc-white').addEventListener('change', () => save({ sites: { white: el('pc-white').checked } }));
	el('pc-list').addEventListener('change', () => save({ sites: { list: el('pc-list').value.split('\n') } }));
	el('pc-refresh').addEventListener('click', () => stats().catch(fail));

	refresh().catch(fail);
	// Каждый раз при входе в раздел проверяем, не истёк ли доступ
	document.getElementById('cats').addEventListener('click', () => {
		if (!el('parental').classList.contains('hidden')) refresh().catch(fail);
	});
})();
