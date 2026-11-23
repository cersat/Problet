// Страница «Заблокировано»: показывает, почему адрес закрыт, и открывает его по паролю родительского контроля
const $ = (id) => document.getElementById(id);
const EN = document.documentElement.dataset.lang === 'en' || document.documentElement.lang === 'en';
const L = (ru, en) => (EN ? en : ru);
const clean = (e) => String((e && e.message) || e).replace(/^.*Error: /, '');
const span = (ms) => {
	const m = Math.round(ms / 60000);
	if (m < 60) return m + L(' мин', ' min');
	const h = Math.floor(m / 60);
	return h + L(' ч', ' h') + (m % 60 ? ' ' + (m % 60) + L(' мин', ' min') : '');
};
let target = '';

problet.parentalBlocked().then((st) => {
	target = st.url;
	$('url').textContent = st.url;
	if (st.reason === 'time') {
		const until = new Date(st.periodEnd).toLocaleString(EN ? 'en-GB' : 'ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hour12: false });
		const used = span(Math.min(st.used, st.limit));
		$('why').textContent = L('Время пользования браузером закончилось: ' + used + ' из ' + span(st.limit) + '. Снова можно будет ' + until + '.', 'Browser time is up: ' + used + ' of ' + span(st.limit) + '. Available again on ' + until + '.');
	} else if (st.reason === 'locked') {
		$('why').textContent = L('Настройки родительского контроля удалены или изменены не через браузер, поэтому Problet заперт. Введи пароль родительского контроля, чтобы продолжить.', 'Parental control settings were deleted or changed outside the browser, so Problet is locked. Enter the parental control password to continue.');
	} else {
		$('why').textContent = L('Этот сайт закрыт родительским контролем.', 'This site is blocked by parental control.');
	}
	$('pass').focus();
}).catch((e) => { $('err').textContent = clean(e); });

$('enter').addEventListener('submit', async (e) => {
	e.preventDefault();
	$('err').textContent = '';
	try {
		await problet.parentalEnter(target, $('pass').value);
	} catch (err) {
		$('err').textContent = clean(err);
		$('pass').select();
	}
});
