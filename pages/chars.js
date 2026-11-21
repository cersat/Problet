const SYMBOLS = {
	'Знаки': '© ® ™ § ¶ † ‡ • … ‰ ′ ″ ‹ › « » “ ” „ ‘ ’ ‚ ‐ – — ¡ ¿ № ° ¦ ~ ^ ` | \\ @ # & * ¤ · ‽ ※ ⁂ ‖ ¨ ´ ‒ ― ¬',
	'Валюты': '$ € £ ¥ ₽ ₴ ₸ ₹ ₩ ₺ ₪ ₫ ₿ ¢ ฿ ₦ ₱ ₡ ₲ ₭ ₮ ₼ ₾ ₣ ₤ ₳ ₥ ₯ ₠',
	'Математика': '± × ÷ ≠ ≈ ≤ ≥ < > ∞ √ ∛ ∑ ∏ ∫ ∂ ∆ ∇ ∈ ∉ ∩ ∪ ⊂ ⊃ ⊆ ⊇ ∀ ∃ ∅ ∧ ∨ ¬ ⇒ ⇔ ∝ ∠ ⊥ ∥ ° ¼ ½ ¾ ⅓ ⅔ ⁰ ¹ ² ³ ⁴ ⁵ ⁶ ⁷ ⁸ ⁹ ₀ ₁ ₂ ₃ ₄ ₅ ₆ ₇ ₈ ₉ π ≡ ≢ ≅ ∼ ∓ ∘ ∙ ∴ ∵ ⌊ ⌋ ⌈ ⌉ ⊕ ⊗ ℕ ℤ ℚ ℝ ℂ',
	'Стрелки': '← ↑ → ↓ ↔ ↕ ↖ ↗ ↘ ↙ ⇐ ⇑ ⇒ ⇓ ⇔ ⇕ ↩ ↪ ↺ ↻ ⟵ ⟶ ⟷ ➔ ➜ ➤ ▲ ▼ ◀ ▶ △ ▽ ◁ ▷',
	'Греческие': 'α β γ δ ε ζ η θ ι κ λ μ ν ξ ο π ρ σ ς τ υ φ χ ψ ω Α Β Γ Δ Ε Ζ Η Θ Ι Κ Λ Μ Ν Ξ Ο Π Ρ Σ Τ Υ Φ Χ Ψ Ω',
	'Латиница': 'À Á Â Ã Ä Å Æ Ç È É Ê Ë Ì Í Î Ï Ð Ñ Ò Ó Ô Õ Ö Ø Ù Ú Û Ü Ý Þ ß à á â ã ä å æ ç è é ê ë ì í î ï ð ñ ò ó ô õ ö ø ù ú û ü ý þ ÿ Ł ł Ś ś Ź ź Ż ż Ć ć Ń ń Ą ą Ę ę Š š Ž ž Č č Ř ř Ő ő Ű ű',
	'Кириллица': 'Ґ ґ Є є І і Ї ї Ў ў Ё ё Ђ ђ Ѓ ѓ Љ љ Њ њ Ћ ћ Џ џ Ә ә Ғ ғ Қ қ Ң ң Ө ө Ү ү Һ һ',
	'Фигуры': '■ □ ▪ ▫ ● ○ ◆ ◇ ★ ☆ ♠ ♣ ♥ ♦ ♪ ♫ ☀ ☁ ☂ ☎ ✉ ✓ ✔ ✗ ✘ ✚ ✿ ❤ ☺ ☹ ⚠ ⚡ ☑ ☐ ☒ ▬ ◐ ◑ ◢ ◣ ◤ ◥ ♀ ♂ ☯ ☮',
	'Клавиши': '⌘ ⌥ ⇧ ⌃ ⎋ ⏎ ↵ ⌫ ⌦ ⇥ ⇤ ⇪ ⏏ ⇞ ⇟ ↖ ↘ ⎙ ⌨ ⏻ ⏸ ⏯ ⏹ ⏺ ⏮ ⏭ ⏪ ⏩',
	'Рамки': '─ │ ┌ ┐ └ ┘ ├ ┤ ┬ ┴ ┼ ═ ║ ╔ ╗ ╚ ╝ ╠ ╣ ╦ ╩ ╬ ╭ ╮ ╰ ╯ ┄ ┆ ━ ┃ ┏ ┓ ┗ ┛ ░ ▒ ▓ █ ▀ ▄ ▌ ▐',
	'Нумерация': 'Ⅰ Ⅱ Ⅲ Ⅳ Ⅴ Ⅵ Ⅶ Ⅷ Ⅸ Ⅹ Ⅺ Ⅻ Ⅼ Ⅽ Ⅾ Ⅿ ① ② ③ ④ ⑤ ⑥ ⑦ ⑧ ⑨ ⑩ ⑪ ⑫ ⑬ ⑭ ⑮ ⑯ ⑰ ⑱ ⑲ ⑳ ❶ ❷ ❸ ❹ ❺ ❻ ❼ ❽ ❾ ❿ ⒈ ⒉ ⒊ ⒋ ⒌',
	'Игры': '♔ ♕ ♖ ♗ ♘ ♙ ♚ ♛ ♜ ♝ ♞ ♟ ⚀ ⚁ ⚂ ⚃ ⚄ ⚅ ♤ ♧ ♡ ♢ 🂡 🂱 🃁 🃑 🃏 ⛀ ⛁ ⛂ ⛃',
};
const EMOJI = {
	'Смайлы': '😀 😃 😄 😁 😆 😅 😂 🤣 🙂 🙃 😉 😊 😇 🥰 😍 🤩 😘 😋 😛 😜 🤪 😝 🤑 🤗 🤭 🤫 🤔 🤐 🤨 😐 😑 😶 😏 😒 🙄 😬 😌 😔 😪 😴 😷 🤒 🤕 🤢 🤮 🥵 🥶 🥴 😵 🤯 🤠 🥳 😎 🤓 🧐 😕 😟 🙁 😮 😯 😲 😳 🥺 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬 😈 👿 💀 💩 🤡 👻 👽 🤖 😺 😸 😹 😻 😼 😽 🙀 😿 😾',
	'Жесты и люди': '👋 🤚 🖐 ✋ 🖖 👌 🤌 🤏 ✌ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝ 👍 👎 ✊ 👊 🤛 🤜 👏 🙌 👐 🤲 🤝 🙏 ✍ 💅 💪 🦾 🦵 🦶 👂 👃 🧠 👀 👁 👅 👄 👶 🧒 👦 👧 🧑 👨 👩 🧓 👴 👵 🙋 🙅 🙆 🤷 🤦 🙇 💁 👮 👷 💂 🕵 🧑‍💻 🧑‍🔬 🧑‍🚀 🧑‍🍳 🧑‍🎓 🧑‍🏫 🦸 🦹 🧙 🧚 🧛 🧜 🧝 🧞 🧟 🏃 🚶 💃 🕺 👫 👪',
	'Животные и природа': '🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🙈 🙉 🙊 🐔 🐧 🐦 🐤 🦆 🦅 🦉 🦇 🐺 🐗 🐴 🦄 🐝 🐛 🦋 🐌 🐞 🐜 🕷 🦂 🐢 🐍 🦎 🦖 🐙 🦑 🦀 🐠 🐟 🐬 🐳 🦈 🐊 🐅 🐘 🦒 🦘 🐪 🐑 🐐 🦌 🐕 🐈 🐓 🦃 🦚 🦜 🕊 🐇 🐿 🦔 🌵 🎄 🌲 🌳 🌴 🌱 🌿 🍀 🍁 🍂 🍃 🍄 🌾 💐 🌷 🌹 🥀 🌺 🌸 🌼 🌻 🌞 🌝 🌙 ⭐ 🌟 ✨ ⚡ 🔥 🌈 ☀ ⛅ ☁ 🌧 ⛈ 🌩 ❄ ☃ ⛄ 🌊 💧',
	'Еда': '🍏 🍎 🍐 🍊 🍋 🍌 🍉 🍇 🍓 🫐 🍈 🍒 🍑 🥭 🍍 🥥 🥝 🍅 🍆 🥑 🥦 🥬 🥒 🌶 🌽 🥕 🧄 🧅 🥔 🍠 🥐 🥯 🍞 🥖 🥨 🧀 🥚 🍳 🧈 🥞 🧇 🥓 🥩 🍗 🍖 🌭 🍔 🍟 🍕 🥪 🌮 🌯 🥗 🥘 🍝 🍜 🍲 🍛 🍣 🍱 🥟 🍤 🍙 🍚 🍘 🍥 🥮 🍢 🍡 🍧 🍨 🍦 🥧 🧁 🍰 🎂 🍮 🍭 🍬 🍫 🍿 🍩 🍪 🌰 🥜 🍯 🥛 ☕ 🍵 🧃 🥤 🧋 🍶 🍺 🍻 🥂 🍷 🥃 🍸 🍹 🧉 🧊',
	'Путешествия': '🚗 🚕 🚙 🚌 🚎 🏎 🚓 🚑 🚒 🚐 🛻 🚚 🚛 🚜 🛵 🏍 🛺 🚲 🛴 🚨 🚔 🚍 🚘 🚖 🚡 🚠 🚟 🚃 🚋 🚞 🚝 🚄 🚅 🚈 🚂 🚆 🚇 🚊 🚉 ✈ 🛫 🛬 🛩 💺 🛰 🚀 🛸 🚁 🛶 ⛵ 🚤 🛥 🛳 ⛴ 🚢 ⚓ 🚧 ⛽ 🚏 🚦 🚥 🗺 🗿 🗽 🗼 🏰 🏯 🏟 🎡 🎢 🎠 ⛲ ⛱ 🏖 🏝 🏜 🌋 ⛰ 🏔 🗻 🏕 ⛺ 🏠 🏡 🏘 🏚 🏗 🏭 🏢 🏬 🏣 🏤 🏥 🏦 🏨 🏪 🏫 🏩 💒 🏛 ⛪ 🕌 🕍 🛕 🌅 🌄 🌠 🎇 🎆 🌇 🌆 🏙 🌃 🌌 🌉 🌁',
	'Занятия': '⚽ 🏀 🏈 ⚾ 🥎 🎾 🏐 🏉 🥏 🎱 🪀 🏓 🏸 🏒 🏑 🥍 🏏 🥅 ⛳ 🪁 🏹 🎣 🤿 🥊 🥋 🎽 🛹 🛼 🛷 ⛸ 🥌 🎿 ⛷ 🏂 🏋 🤸 🤺 🤾 🏌 🏇 🧘 🏄 🏊 🤽 🚣 🧗 🚵 🚴 🏆 🥇 🥈 🥉 🏅 🎖 🏵 🎗 🎫 🎟 🎪 🤹 🎭 🩰 🎨 🎬 🎤 🎧 🎼 🎹 🥁 🎷 🎺 🎸 🪕 🎻 🎲 ♟ 🎯 🎳 🎮 🎰 🧩 🎉 🎊 🎈 🎁 🎀 🪅 🎃 🎄 🎆 🎇 🧨',
	'Предметы': '⌚ 📱 💻 ⌨ 🖥 🖨 🖱 🖲 🕹 🗜 💽 💾 💿 📀 📼 📷 📸 📹 🎥 📽 🎞 📞 ☎ 📟 📠 📺 📻 🎙 🎚 🎛 🧭 ⏱ ⏲ ⏰ 🕰 ⌛ ⏳ 📡 🔋 🔌 💡 🔦 🕯 🧯 🛢 💸 💵 💴 💶 💷 🪙 💰 💳 💎 ⚖ 🧰 🔧 🔨 ⚒ 🛠 ⛏ 🔩 ⚙ 🧱 ⛓ 🧲 🔫 💣 🧨 🪓 🔪 🗡 ⚔ 🛡 🔮 📿 🧿 💈 ⚗ 🔭 🔬 🕳 💊 💉 🩸 🧬 🦠 🧫 🧪 🌡 🧹 🧺 🧻 🚽 🚰 🚿 🛁 🧼 🪒 🧽 🔑 🗝 🚪 🛋 🛏 🧸 🖼 🛍 🛒 🎁 ✉ 📩 📨 📧 📦 📫 📮 📜 📃 📄 📑 📊 📈 📉 🗒 🗓 📆 📅 📇 🗃 🗳 🗄 📋 📁 📂 🗂 🗞 📰 📓 📔 📒 📕 📗 📘 📙 📚 📖 🔖 🔗 📎 🖇 📐 📏 🧮 📌 📍 ✂ 🖊 🖋 ✒ 🖌 🖍 📝 ✏ 🔍 🔎 🔏 🔐 🔒 🔓',
	'Символы': '❤ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣ 💕 💞 💓 💗 💖 💘 💝 💟 ☮ ✝ ☪ 🕉 ☸ ✡ 🔯 🕎 ☯ ☦ 🛐 ⛎ ♈ ♉ ♊ ♋ ♌ ♍ ♎ ♏ ♐ ♑ ♒ ♓ 🆔 ⚛ ☢ ☣ 📴 📳 🈶 🆚 💮 🉐 🅰 🅱 🆎 🆑 🅾 🆘 ❌ ⭕ 🛑 ⛔ 📛 🚫 💯 💢 ♨ 🚷 🚯 🚳 🚱 🔞 📵 🚭 ❗ ❕ ❓ ❔ ‼ ⁉ 🔅 🔆 〽 ⚠ 🚸 🔱 ⚜ 🔰 ♻ ✅ 💹 ❇ ✳ ❎ 🌐 💠 Ⓜ 🌀 💤 🏧 🚾 ♿ 🅿 🚹 🚺 🚼 🚻 🚮 🎦 📶 🆗 🆙 🆒 🆕 🆓 0️⃣ 1️⃣ 2️⃣ 3️⃣ 4️⃣ 5️⃣ 6️⃣ 7️⃣ 8️⃣ 9️⃣ 🔟 ▶ ⏸ ⏯ ⏹ ⏺ ⏭ ⏮ ⏩ ⏪ 🔀 🔁 🔂 ◀ 🔼 🔽 ➡ ⬅ ⬆ ⬇ ↗ ↘ ↙ ↖ ↕ ↔ ↪ ↩ ⤴ ⤵ 🔄 🔃 🎵 🎶 ➕ ➖ ➗ ✖ ♾ 💲 💱 ™ © ® 〰 ➰ ➿ 🔚 🔙 🔛 🔝 🔜 ✔ ☑ 🔘 🔴 🟠 🟡 🟢 🔵 🟣 ⚫ ⚪ 🟤 🔺 🔻 🔸 🔹 🔶 🔷 🔳 🔲 ▪ ▫ ◾ ◽ ◼ ◻ 🟥 🟧 🟨 🟩 🟦 🟪 ⬛ ⬜ 🟫 🔈 🔇 🔉 🔊 🔔 🔕 📣 📢 💬 💭 🗯 ♠ ♣ ♥ ♦ 🃏 🎴 🀄',
	'Флаги': '🏳 🏴 🏁 🚩 🏳️‍🌈 🇬🇪 🇷🇺 🇺🇦 🇧🇾 🇰🇿 🇦🇲 🇦🇿 🇺🇿 🇰🇬 🇹🇯 🇲🇩 🇺🇸 🇬🇧 🇨🇦 🇩🇪 🇫🇷 🇮🇹 🇪🇸 🇵🇹 🇳🇱 🇧🇪 🇨🇭 🇦🇹 🇵🇱 🇨🇿 🇸🇰 🇭🇺 🇷🇴 🇧🇬 🇬🇷 🇹🇷 🇸🇪 🇳🇴 🇫🇮 🇩🇰 🇮🇸 🇮🇪 🇱🇹 🇱🇻 🇪🇪 🇮🇱 🇪🇬 🇮🇳 🇨🇳 🇯🇵 🇰🇷 🇰🇵 🇹🇭 🇻🇳 🇮🇩 🇦🇺 🇳🇿 🇧🇷 🇦🇷 🇲🇽 🇨🇱 🇨🇴 🇿🇦 🇳🇬 🇪🇺 🇺🇳',
};
const MODES = { emoji: EMOJI, symbols: SYMBOLS };
const remembered = (key, fallback) => {
	try {
		return localStorage.getItem(key) || fallback;
	} catch (e) {
		return fallback;
	}
};
const remember = (key, v) => {
	try {
		localStorage.setItem(key, v);
	} catch (e) { /* не запомнится */ }
};
let mode = remembered('chars-mode', 'symbols') === 'emoji' ? 'emoji' : 'symbols';
const current = { emoji: Object.keys(EMOJI)[0], symbols: Object.keys(SYMBOLS)[0] };
for (const m of Object.keys(MODES)) {
	const c = remembered('chars-cat-' + m, '');
	if (Object.hasOwn(MODES[m], c)) current[m] = c;
}

for (const b of document.querySelectorAll('#modes button')) {
	b.addEventListener('click', () => {
		mode = b.dataset.mode;
		remember('chars-mode', mode);
		document.getElementById('grid').scrollTop = 0;
		render();
	});
}

function render() {
	for (const b of document.querySelectorAll('#modes button')) b.classList.toggle('on', b.dataset.mode === mode);
	const sets = MODES[mode];
	const cats = document.getElementById('cats');
	cats.textContent = '';
	for (const name of Object.keys(sets)) {
		const b = document.createElement('button');
		b.textContent = name;
		if (name === current[mode]) b.className = 'on';
		b.addEventListener('click', () => {
			current[mode] = name;
			remember('chars-cat-' + mode, name);
			document.getElementById('grid').scrollTop = 0;
			render();
		});
		cats.append(b);
	}
	const grid = document.getElementById('grid');
	grid.textContent = '';
	grid.classList.toggle('emoji', mode === 'emoji');
	for (const ch of sets[current[mode]].split(' ')) {
		const b = document.createElement('button');
		b.textContent = ch;
		b.title = [...ch].filter((c) => c !== '\u200d' && c !== '\ufe0f').map((c) => 'U+' + c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')).join(' ');
		b.addEventListener('click', () => problet.charPick(ch));
		grid.append(b);
	}
}

document.addEventListener('keydown', (e) => {
	if (e.key === 'Escape') problet.panelClose();
});
render();
