// Калькулятор для подсказок: разбирает выражение сам, без eval

const FUNCS = {
	sqrt: Math.sqrt, abs: Math.abs, sin: Math.sin, cos: Math.cos, tan: Math.tan,
	asin: Math.asin, acos: Math.acos, atan: Math.atan, ln: Math.log, log: Math.log10,
	exp: Math.exp, floor: Math.floor, ceil: Math.ceil, round: Math.round,
};
const CONSTS = { pi: Math.PI, e: Math.E };
const OP_ALIASES = { '×': '*', '÷': '/', '−': '-', '–': '-' };

function tokenize(src) {
	const tokens = [];
	let i = 0;
	while (i < src.length) {
		let c = src[i];
		if (/\s/.test(c)) {
			i++;
			continue;
		}
		if (/[0-9.]/.test(c)) {
			let j = i;
			while (j < src.length && /[0-9.]/.test(src[j])) j++;
			const text = src.slice(i, j);
			if (!/^(\d+\.?\d*|\.\d+)$/.test(text)) return null;
			tokens.push({ type: 'num', value: parseFloat(text) });
			i = j;
			continue;
		}
		if (/[a-z]/i.test(c)) {
			let j = i;
			while (j < src.length && /[a-z]/i.test(src[j])) j++;
			tokens.push({ type: 'id', value: src.slice(i, j).toLowerCase() });
			i = j;
			continue;
		}
		if (c === '*' && src[i + 1] === '*') {
			tokens.push({ type: 'op', value: '^' });
			i += 2;
			continue;
		}
		c = OP_ALIASES[c] || c;
		if ('+-*/^%'.includes(c)) {
			tokens.push({ type: 'op', value: c });
			i++;
			continue;
		}
		if (c === '(' || c === ')') {
			tokens.push({ type: c });
			i++;
			continue;
		}
		return null;
	}
	return tokens;
}

// expr = term (('+'|'-') term)*
// term = unary (('*'|'/'|'%') unary)*
// unary = ('-'|'+') unary | power
// power = atom ('^' unary)?
function evaluate(tokens) {
	let pos = 0;
	const peek = () => tokens[pos];
	const isOp = (t, chars) => t && t.type === 'op' && chars.includes(t.value);
	const fail = () => {
		throw new Error('bad expression');
	};

	function expr() {
		let left = term();
		while (isOp(peek(), '+-')) {
			const op = tokens[pos++].value;
			const right = term();
			left = op === '+' ? left + right : left - right;
		}
		return left;
	}

	function term() {
		let left = unary();
		while (isOp(peek(), '*/%')) {
			const op = tokens[pos++].value;
			const right = unary();
			left = op === '*' ? left * right : op === '/' ? left / right : left % right;
		}
		return left;
	}

	function unary() {
		const t = peek();
		if (isOp(t, '+-')) {
			pos++;
			const v = unary();
			return t.value === '-' ? -v : v;
		}
		return power();
	}

	function power() {
		const base = atom();
		if (isOp(peek(), '^')) {
			pos++;
			return Math.pow(base, unary());
		}
		return base;
	}

	function closeParen() {
		if (!peek() || peek().type !== ')') fail();
		pos++;
	}

	function atom() {
		const t = tokens[pos++];
		if (!t) fail();
		if (t.type === 'num') return t.value;
		if (t.type === '(') {
			const v = expr();
			closeParen();
			return v;
		}
		if (t.type === 'id') {
			if (Object.hasOwn(FUNCS, t.value)) {
				if (!peek() || peek().type !== '(') fail();
				pos++;
				const v = expr();
				closeParen();
				return FUNCS[t.value](v);
			}
			if (Object.hasOwn(CONSTS, t.value)) return CONSTS[t.value];
		}
		return fail();
	}

	const result = expr();
	if (pos !== tokens.length) fail();
	return result;
}

// Возвращает строку с результатом или null, если это не выражение для калькулятора
function tryCalc(text) {
	if (typeof text !== 'string' || text.length > 120) return null;
	const tokens = tokenize(text);
	if (!tokens || !tokens.length) return null;
	const meaningful = tokens.some((t) => t.type === 'op' || (t.type === 'id' && Object.hasOwn(FUNCS, t.value)));
	if (!meaningful) return null;
	let result;
	try {
		result = evaluate(tokens);
	} catch (e) {
		return null;
	}
	if (typeof result !== 'number' || !Number.isFinite(result)) return null;
	const out = String(Number(result.toPrecision(12)));
	if (out === text.replace(/\s/g, '')) return null;
	return out;
}

module.exports = { tryCalc };
