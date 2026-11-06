const SETS = {
	'Знаки': '© ® ™ § ¶ † ‡ • … ‰ ′ ″ ‹ › « » “ ” „ ‘ ’ ‚ ‐ – — ¡ ¿ № ° ′ ¦ ~ ^ ` | \\ @ # & * ¤',
	'Валюты': '$ € £ ¥ ₽ ₴ ₸ ₹ ₩ ₺ ₪ ₫ ₿ ¢ ฿ ₦ ₱ ₡ ₲ ₭ ₮ ₼ ₾ ₣ ₤ ₳',
	'Математика': '± × ÷ ≠ ≈ ≤ ≥ < > ∞ √ ∛ ∑ ∏ ∫ ∂ ∆ ∇ ∈ ∉ ∩ ∪ ⊂ ⊃ ⊆ ⊇ ∀ ∃ ∅ ∧ ∨ ¬ ⇒ ⇔ ∝ ∠ ⊥ ∥ ° ¼ ½ ¾ ⅓ ⅔ ⁰ ¹ ² ³ ⁴ ⁵ ⁶ ⁷ ⁸ ⁹ ₀ ₁ ₂ ₃ ₄ ₅ ₆ ₇ ₈ ₉ ‰ π',
	'Стрелки': '← ↑ → ↓ ↔ ↕ ↖ ↗ ↘ ↙ ⇐ ⇑ ⇒ ⇓ ⇔ ⇕ ↩ ↪ ↺ ↻ ⟵ ⟶ ⟷ ➔ ➜ ➤ ▲ ▼ ◀ ▶ △ ▽ ◁ ▷',
	'Греческие': 'α β γ δ ε ζ η θ ι κ λ μ ν ξ ο π ρ σ ς τ υ φ χ ψ ω Α Β Γ Δ Ε Ζ Η Θ Ι Κ Λ Μ Ν Ξ Ο Π Ρ Σ Τ Υ Φ Χ Ψ Ω',
	'Латиница': 'À Á Â Ã Ä Å Æ Ç È É Ê Ë Ì Í Î Ï Ð Ñ Ò Ó Ô Õ Ö Ø Ù Ú Û Ü Ý Þ ß à á â ã ä å æ ç è é ê ë ì í î ï ð ñ ò ó ô õ ö ø ù ú û ü ý þ ÿ Ł ł Ś ś Ź ź Ż ż Ć ć Ń ń Ą ą Ę ę Š š Ž ž Č č Ř ř Ő ő Ű ű',
	'Кириллица': 'Ґ ґ Є є І і Ї ї Ў ў Ё ё Ђ ђ Ѓ ѓ Љ љ Њ њ Ћ ћ Џ џ Ә ә Ғ ғ Қ қ Ң ң Ө ө Ү ү Һ һ',
	'Фигуры': '■ □ ▪ ▫ ● ○ ◆ ◇ ★ ☆ ♠ ♣ ♥ ♦ ♪ ♫ ☀ ☁ ☂ ☎ ✉ ✓ ✔ ✗ ✘ ✚ ✿ ❤ ☺ ☹ ⚠ ⚡ ☑ ☐ ☒',
};
let current = Object.keys(SETS)[0];

function render() {
	const cats = document.getElementById('cats');
	cats.textContent = '';
	for (const name of Object.keys(SETS)) {
		const b = document.createElement('button');
		b.textContent = name;
		if (name === current) b.className = 'on';
		b.addEventListener('click', () => {
			current = name;
			render();
		});
		cats.append(b);
	}
	const grid = document.getElementById('grid');
	grid.textContent = '';
	for (const ch of SETS[current].split(' ')) {
		const b = document.createElement('button');
		b.textContent = ch;
		b.title = 'U+' + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0');
		b.addEventListener('click', () => api.charPick(ch));
		grid.append(b);
	}
}

document.addEventListener('keydown', (e) => {
	if (e.key === 'Escape') api.panelClose();
});
render();
