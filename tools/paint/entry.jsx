// Графический редактор SVG для Problet: редактор «Костюмов» из scratch-paint (форк TurboWarp) и своя верхняя панель.
// Собирается скриптом build.sh в pages/svgedit.js
import React from 'react';
import ReactDOM from 'react-dom';
import PaintEditor, {ScratchPaintReducer} from '..';
import {Provider} from 'react-redux';
import {combineReducers, createStore} from 'redux';
import {addLocaleData} from 'react-intl';
import {IntlProvider, intlReducer} from 'react-intl-redux';
import ruData from 'react-intl/locale-data/ru';
import enData from 'react-intl/locale-data/en';
import paintMessages from 'scratch-l10n/locales/paint-editor-msgs';
import styles from './entry.css';
import * as tools from './tools';

addLocaleData([...ruData, ...enData]);

const api = window.api;
const file = new URLSearchParams(location.search).get('p') || '';
const params = new URLSearchParams(location.search);
const bm = params.get('bm') || ''; // режим «иконка закладки»: рисунок хранится в закладке, а не в файле
// Любую картинку (ico, gif, webp, svg…) приводим к png: растровый режим редактора работает с ним
function rasterize (dataUrl) {
    return new Promise(resolve => {
        const img = new Image();
        img.onload = () => {
            const w = img.naturalWidth || 64;
            const h = img.naturalHeight || 64;
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            canvas.getContext('2d').drawImage(img, 0, 0, w, h);
            try {
                resolve({dataUrl: canvas.toDataURL('image/png'), width: w, height: h});
            } catch (e) {
                resolve(null);
            }
        };
        img.onerror = () => resolve(null);
        img.src = dataUrl;
    });
}
const isPng = !bm && /\.png$/i.test(file);
const pref = (key, def) => {
    try {
        const v = localStorage.getItem('svgedit-' + key);
        return v === null ? def : JSON.parse(v);
    } catch (e) {
        return def;
    }
};
const setPref = (key, v) => {
    try {
        localStorage.setItem('svgedit-' + key, JSON.stringify(v));
    } catch (e) { /* без запоминания */ }
};
// Округление координат в svg: файлы заметно меньше, на вид разницы нет
const roundSvg = svg => svg.replace(/(data:[^"')\s]+)|(-?\d*\.\d{3,})/g, (m, uri, num) => (uri ? uri : String(Number(Number(num).toFixed(2)))));
const fmt = n => String(Math.round(n * 100) / 100); // png открывается сразу в растровом режиме
const baseName = bm ? 'icon' : (file.split(/[\\/]/).pop() || 'image.svg').replace(/\.(svg|png)$/i, '');

const store = createStore(
    combineReducers({intl: intlReducer, scratchPaint: ScratchPaintReducer}),
    {intl: {defaultLocale: 'ru', locale: 'ru', messages: {...paintMessages.en, ...paintMessages.ru, 'paint.paintEditor.costume': 'Имя'}}}
);

const EMPTY = '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360" viewBox="0 0 480 360"></svg>';
const EMPTY_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"></svg>';
// Пустой рисунок (ни одной фигуры) в закладке значит «своей иконки нет»
const isEmptyDrawing = svg => !/<(path|rect|circle|ellipse|polygon|polyline|line|text|image|use)\b/.test(svg);
const clean = err => String((err && err.message) || err).replace(/^Error invoking remote method '[^']*': (Error: )?/, '');

// Scratch дописывает в конец svg служебный комментарий с центром вращения; в файле он не нужен
const stripScratch = svg => svg.replace(/<!--rotationCenter:[^>]*-->\s*$/, '');

function sizeOf (svgText) {
    try {
        const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
        const root = doc.documentElement;
        if (doc.querySelector('parsererror') || root.localName !== 'svg') return null;
        const vb = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
        let w = parseFloat(root.getAttribute('width'));
        let h = parseFloat(root.getAttribute('height'));
        if (vb.length === 4 && vb.every(Number.isFinite)) {
            w = w || vb[2];
            h = h || vb[3];
        }
        return Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 ? {w, h} : null;
    } catch (e) {
        return null;
    }
}

class App extends React.Component {
    constructor (props) {
        super(props);
        this.state = {
            loaded: false, image: EMPTY, imageId: '0', width: 480, height: 360,
            dirty: false, note: '', error: '', theme: document.documentElement.dataset.theme === 'light' ? 'light' : 'dark',
            scale: '1', bitmap: false, format: 'svg',
            panel: pref('panel', true), round: pref('round', false), bg: pref('bg', ''),
            code: null, box: null, keepRatio: pref('keepRatio', true), angle: '15'
        };
        this.svg = EMPTY; // последнее состояние рисунка
        this.savedSvg = null; // что лежит в файле
        this.bitmapCanvas = null;
        this.n = 0;
        this.state.title = file;
        tools.attach(store, this.onUpdateImage);
        document.title = (bm ? (bm.startsWith('cb:') ? 'Иконка кнопки' : 'Иконка закладки') : baseName + (isPng ? '.png' : '.svg')) + ' — редактор';
    }
    componentDidMount () {
        if (isPng) {
            api.pngRead(file).then(r => {
                this.setState({loaded: true, format: 'png', image: r.dataUrl, imageId: String(++this.n), width: r.width, height: r.height, bitmap: true});
            }).catch(e => this.setState({loaded: true, error: 'Не удалось открыть файл: ' + clean(e)}));
        } else (bm ? api.bmIconGet(bm).then(r => ({text: r.svg, title: r.title, image: r.image})) : api.svgRead(file)).then(async r => {
            if (bm) {
                this.setState({title: (bm.startsWith('cb:') ? 'Иконка кнопки' : 'Иконка закладки') + ': ' + r.title});
                // у закладки есть только значок сайта: рисование начинается с него, в растровом режиме
                if (r.image && !r.text.trim()) {
                    const png = await rasterize(r.image);
                    if (png) {
                        this.setState({loaded: true, format: 'png', image: png.dataUrl, imageId: String(++this.n), width: png.width, height: png.height, bitmap: true});
                        return;
                    }
                }
                r.text = r.text || EMPTY_ICON;
            }
            const text = r.text.trim() ? r.text : EMPTY;
            const size = sizeOf(text);
            this.svg = text;
            this.savedSvg = r.text.trim() ? r.text : null;
            this.setState({
                loaded: true, image: text, imageId: String(++this.n),
                width: size ? Math.max(Math.ceil(size.w), 32) : 480, height: size ? Math.max(Math.ceil(size.h), 32) : 360,
                dirty: !bm && !r.text.trim(), error: size || !r.text.trim() ? '' : 'Не удалось разобрать svg: рисунок может открыться пустым'
            });
        }).catch(e => this.setState({loaded: true, error: 'Не удалось открыть файл: ' + clean(e)}));
        this.observer = new MutationObserver(() => this.setState({theme: document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'}));
        this.observer.observe(document.documentElement, {attributes: true, attributeFilter: ['data-theme']});
        document.addEventListener('keydown', this.onKey);
        // Свойства выделения обновляются после любого действия в редакторе
        this.unsubscribe = store.subscribe(() => {
            const sel = store.getState().scratchPaint.selectedItems;
            if (sel !== this.lastSel) {
                this.lastSel = sel;
                this.refreshBox();
            }
        });
        document.addEventListener('mouseup', this.refreshSoon);
        document.addEventListener('keyup', this.refreshSoon);
    }
    refreshSoon = () => setTimeout(() => this.refreshBox(), 0);
    refreshBox () {
        let box = null;
        try {
            box = tools.selectionBox();
        } catch (e) { /* редактор ещё не готов */ }
        const old = this.state.box;
        if (JSON.stringify(old) !== JSON.stringify(box)) this.setState({box});
    }
    componentWillUnmount () {
        this.observer.disconnect();
        document.removeEventListener('keydown', this.onKey);
        document.removeEventListener('mouseup', this.refreshSoon);
        document.removeEventListener('keyup', this.refreshSoon);
        this.unsubscribe();
    }
    onKey = e => {
        if (!(e.ctrlKey || e.metaKey)) return;
        const k = e.key.toLowerCase();
        if (k === 's' && e.shiftKey && !bm && !isPng) {
            e.preventDefault();
            this.saveAs();
        } else if (k === 's') {
            e.preventDefault();
            this.save();
        } else if (k === 'e' && e.shiftKey) {
            e.preventDefault();
            this.exportPng();
        }
    };
    onUpdateImage = (isVector, image) => {
        if (isVector) {
            this.svg = stripScratch(image);
            this.bitmapCanvas = null;
            this.setState({bitmap: false, dirty: this.svg !== this.savedSvg});
        } else {
            // растровый режим: из него svg получить нельзя, можно лишь выгрузить png
            const canvas = document.createElement('canvas');
            canvas.width = image.width;
            canvas.height = image.height;
            canvas.getContext('2d').putImageData(image, 0, 0);
            this.bitmapCanvas = canvas;
            this.setState({bitmap: true, dirty: true});
        }
    };
    say (note) {
        this.setState({note});
        clearTimeout(this.noteTimer);
        this.noteTimer = setTimeout(() => this.setState({note: ''}), 3500);
    }
    async save () {
        if (isPng) {
            if (!this.state.bitmap || !this.bitmapCanvas) return this.say(this.state.bitmap ? 'Рисунок ещё не менялся' : 'Для png нужен растровый режим');
            try {
                await api.pngWrite(file, this.bitmapCanvas.toDataURL('image/png'));
                this.setState({dirty: false});
                this.say('Сохранено');
            } catch (e) {
                this.say('Не удалось сохранить: ' + clean(e));
            }
            return;
        }
        if (bm && this.state.bitmap) {
            // рисунок в растровом режиме хранится как svg с картинкой внутри
            if (!this.bitmapCanvas) return this.say('Рисунок ещё не менялся');
            const c = this.bitmapCanvas;
            const svg = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="' + c.width + '" height="' + c.height + '" viewBox="0 0 ' + c.width + ' ' + c.height + '"><image width="' + c.width + '" height="' + c.height + '" xlink:href="' + c.toDataURL('image/png') + '"/></svg>';
            try {
                await api.bmIconSet(bm, svg);
                this.setState({dirty: false});
                this.say('Сохранено');
            } catch (e) {
                this.say('Не удалось сохранить: ' + clean(e));
            }
            return;
        }
        if (this.state.bitmap) return this.say('В растровом режиме svg не сохранить: переключись обратно на векторный или выгрузи PNG');
        try {
            if (bm) await api.bmIconSet(bm, isEmptyDrawing(this.svg) ? '' : this.out());
            else this.savedTo = (await api.svgWrite(file, this.out())).path;
            this.savedSvg = this.svg;
            this.setState({dirty: false});
            this.say('Сохранено' + (this.savedTo && this.savedTo !== file ? ' в ' + this.savedTo : ''));
        } catch (e) {
            this.say('Не удалось сохранить: ' + clean(e));
        }
    }
    async saveAs () {
        if (this.state.bitmap) return this.say('В растровом режиме svg не сохранить');
        try {
            const r = await api.svgSaveAs(this.out());
            if (r) this.say('Сохранено в ' + r.path);
        } catch (e) {
            this.say(clean(e));
        }
    }
    // svg для файла: с округлёнными координатами, если так выбрано
    out () {
        return this.state.round ? roundSvg(this.svg) : this.svg;
    }
    renderPng () {
        // растр уже готов; для вектора рисуем svg на холсте с выбранным масштабом. Фон — прозрачный или выбранный цвет
        const scale = Number(this.state.scale) || 1;
        const bg = this.state.bg;
        if (this.bitmapCanvas) {
            if (!bg) return Promise.resolve(this.bitmapCanvas.toDataURL('image/png'));
            const c = document.createElement('canvas');
            c.width = this.bitmapCanvas.width;
            c.height = this.bitmapCanvas.height;
            const ctx = c.getContext('2d');
            ctx.fillStyle = bg;
            ctx.fillRect(0, 0, c.width, c.height);
            ctx.drawImage(this.bitmapCanvas, 0, 0);
            return Promise.resolve(c.toDataURL('image/png'));
        }
        return new Promise((resolve, reject) => {
            const img = new Image();
            const url = URL.createObjectURL(new Blob([this.svg], {type: 'image/svg+xml'}));
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = Math.max(1, Math.round((img.naturalWidth || 1) * scale));
                canvas.height = Math.max(1, Math.round((img.naturalHeight || 1) * scale));
                const ctx = canvas.getContext('2d');
                if (bg) {
                    ctx.fillStyle = bg;
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                }
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                URL.revokeObjectURL(url);
                resolve(canvas.toDataURL('image/png'));
            };
            img.onerror = () => reject(new Error('Не удалось нарисовать svg'));
            img.src = url;
        });
    }
    async exportPng () {
        try {
            const r = await api.svgSavePng(await this.renderPng(), baseName + '.png');
            if (r) this.say('PNG сохранён: ' + r.path);
        } catch (e) {
            this.say(clean(e));
        }
    }
    async copyPng () {
        try {
            await api.svgCopyPng(await this.renderPng());
            this.say('PNG скопирован');
        } catch (e) {
            this.say('Не удалось скопировать картинку');
        }
    }
    // Картинка с диска (svg, png, jpg, gif, webp) — новой фигурой
    pickImage () {
        if (this.state.bitmap) return this.say('Вставить картинку можно в векторном режиме');
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.svg,image/svg+xml,image/png,image/jpeg,image/gif,image/webp';
        input.onchange = () => {
            const f = input.files[0];
            if (!f) return;
            const isSvg = /svg/.test(f.type) || /\.svg$/i.test(f.name);
            const reader = new FileReader();
            reader.onload = () => tools.insertImage(isSvg ? 'svg' : 'raster', reader.result).then(() => this.say('Картинка вставлена: ' + f.name)).catch(e => this.say(clean(e)));
            if (isSvg) reader.readAsText(f);
            else reader.readAsDataURL(f);
        };
        input.click();
    }
    // Код svg: открыть, поправить руками и применить
    toggleCode () {
        if (this.state.code !== null) return this.setState({code: null});
        if (this.state.bitmap) return this.say('В растровом режиме кода svg нет');
        this.setState({code: this.out()});
    }
    applyCode () {
        const text = this.state.code || '';
        const size = sizeOf(text);
        if (!size) return this.say('Это не svg: проверь код');
        this.svg = text;
        this.setState({image: text, imageId: String(++this.n), format: 'svg', width: Math.max(Math.ceil(size.w), 32), height: Math.max(Math.ceil(size.h), 32), dirty: text !== this.savedSvg, bitmap: false});
        this.say('Код применён');
    }
    setPrefState (key, v) {
        setPref(key, v);
        this.setState({[key]: v});
    }
    act (fn) {
        try {
            const r = fn();
            this.refreshSoon();
            return r;
        } catch (e) {
            this.say('Не получилось: ' + clean(e));
        }
    }
    renderPanel () {
        const {box, bitmap, keepRatio, angle} = this.state;
        const num = (key, label) => (
            <label className={styles.num} key={key + (box ? box[key] : '')}>
                <span>{label}</span>
                <input
                    type="number"
                    step="any"
                    disabled={!box}
                    defaultValue={box ? fmt(box[key]) : ''}
                    onKeyDown={e => {
                        if (e.key === 'Enter') e.target.blur();
                    }}
                    onBlur={e => {
                        const v = parseFloat(e.target.value);
                        if (!box || !Number.isFinite(v) || fmt(v) === fmt(box[key])) return;
                        if ((key === 'w' || key === 'h') && v <= 0) return;
                        this.act(() => tools.setBox({[key]: v}, keepRatio));
                    }}
                />
            </label>
        );
        const need = n => (box && box.count >= n ? null : true);
        return (
            <aside className={styles.panel}>
                <section>
                    <h4>{'Выделение'}{box ? <small>{box.count > 1 ? ' · фигур: ' + box.count : ''}</small> : null}</h4>
                    {bitmap ? <p className={styles.hint}>{'В растровом режиме точные размеры и выравнивание недоступны'}</p> : !box ? <p className={styles.hint}>{'Выдели фигуру инструментом «Выбрать»'}</p> : null}
                    <div className={styles.grid}>{num('x', 'X')}{num('y', 'Y')}{num('w', 'Ш')}{num('h', 'В')}</div>
                    <label className={styles.check}><input type="checkbox" checked={keepRatio} onChange={e => this.setPrefState('keepRatio', e.target.checked)} />{'Сохранять пропорции'}</label>
                    <div className={styles.row}>
                        <input className={styles.small} type="number" value={angle} onChange={e => this.setState({angle: e.target.value})} title="Угол в градусах" />
                        <button disabled={!box} onClick={() => this.act(() => tools.rotate(-(Number(angle) || 0)))} title="Повернуть против часовой">{'↺'}</button>
                        <button disabled={!box} onClick={() => this.act(() => tools.rotate(Number(angle) || 0))} title="Повернуть по часовой">{'↻'}</button>
                    </div>
                    <label className={styles.range} key={'o' + (box ? box.opacity : '')}>
                        <span>{'Непрозрачность'}</span>
                        <input type="range" min="0" max="100" disabled={!box} defaultValue={box ? box.opacity : 100} onChange={e => { e.target.nextSibling.textContent = e.target.value + '%'; }} onMouseUp={e => this.act(() => tools.setOpacity(Number(e.target.value)))} onKeyUp={e => this.act(() => tools.setOpacity(Number(e.target.value)))} />
                        <b>{(box ? box.opacity : 100) + '%'}</b>
                    </label>
                </section>
                <section>
                    <h4>{'Выравнивание'}<small>{box && box.count > 1 ? ' · по общей рамке' : ' · по холсту'}</small></h4>
                    <div className={styles.icons}>
                        <button disabled={!box} onClick={() => this.act(() => tools.align('left'))} title="По левому краю">{'⇤'}</button>
                        <button disabled={!box} onClick={() => this.act(() => tools.align('hcenter'))} title="По центру по горизонтали">{'↔'}</button>
                        <button disabled={!box} onClick={() => this.act(() => tools.align('right'))} title="По правому краю">{'⇥'}</button>
                        <button disabled={!box} onClick={() => this.act(() => tools.align('top'))} title="По верхнему краю">{'⤒'}</button>
                        <button disabled={!box} onClick={() => this.act(() => tools.align('vcenter'))} title="По центру по вертикали">{'↕'}</button>
                        <button disabled={!box} onClick={() => this.act(() => tools.align('bottom'))} title="По нижнему краю">{'⤓'}</button>
                    </div>
                    <div className={styles.row}>
                        <span className={styles.hint}>{'Распределить'}</span>
                        <button disabled={need(3)} onClick={() => this.act(() => tools.distribute('h'))} title="Равные промежутки по горизонтали (от 3 фигур)">{'↔'}</button>
                        <button disabled={need(3)} onClick={() => this.act(() => tools.distribute('v'))} title="Равные промежутки по вертикали (от 3 фигур)">{'↕'}</button>
                    </div>
                </section>
                <section>
                    <h4>{'Контуры'}<small>{' · от 2 фигур'}</small></h4>
                    <div className={styles.two}>
                        <button disabled={need(2)} onClick={() => this.act(() => tools.boolean('unite') || this.say('Нужны хотя бы две фигуры (не текст и не группы)'))}>{'Объединить'}</button>
                        <button disabled={need(2)} onClick={() => this.act(() => tools.boolean('subtract') || this.say('Нужны хотя бы две фигуры (не текст и не группы)'))} title="Из нижней фигуры вырезаются верхние">{'Вычесть'}</button>
                        <button disabled={need(2)} onClick={() => this.act(() => tools.boolean('intersect') || this.say('Нужны хотя бы две фигуры (не текст и не группы)'))}>{'Пересечь'}</button>
                        <button disabled={need(2)} onClick={() => this.act(() => tools.boolean('exclude') || this.say('Нужны хотя бы две фигуры (не текст и не группы)'))}>{'Исключить'}</button>
                    </div>
                </section>
                <section>
                    <h4>{'Файл'}</h4>
                    <button className={styles.wide} onClick={() => this.pickImage()}>{'Вставить картинку…'}</button>
                    {isPng ? null : <button className={styles.wide} onClick={() => this.toggleCode()}>{this.state.code === null ? 'Код SVG' : 'Скрыть код SVG'}</button>}
                    <button className={styles.wide} onClick={() => this.copyPng()}>{'Копировать PNG'}</button>
                    <label className={styles.field}>
                        <span>{'Фон PNG'}</span>
                        <select value={this.state.bg} onChange={e => this.setPrefState('bg', e.target.value)}>
                            <option value="">{'Прозрачный'}</option>
                            <option value="#ffffff">{'Белый'}</option>
                            <option value="#000000">{'Чёрный'}</option>
                        </select>
                    </label>
                    {isPng ? null : <label className={styles.check}><input type="checkbox" checked={this.state.round} onChange={e => this.setPrefState('round', e.target.checked)} />{'Округлять координаты при сохранении'}</label>}
                    <p className={styles.hint}>{'Ctrl+S — сохранить, Ctrl+Shift+S — сохранить как, Ctrl+Shift+E — выгрузить PNG'}</p>
                </section>
            </aside>
        );
    }
    async copyCode () {
        try {
            await navigator.clipboard.writeText(this.out());
            this.say('Код svg скопирован');
        } catch (e) {
            this.say('Не удалось скопировать');
        }
    }
    render () {
        const {loaded, image, imageId, width, height, dirty, note, error, theme, bitmap} = this.state;
        return (
            <div className={styles.app}>
                <header className={styles.bar}>
                    <div className={styles.file} title={file}>{this.state.title}{dirty ? ' •' : ''}</div>
                    <span className={styles.note}>{note || (bitmap ? 'Растровый режим' : dirty ? 'Не сохранено' : 'Сохранено')}</span>
                    <button className={styles.primary} onClick={() => this.save()} title="Ctrl+S">{'Сохранить'}</button>
                    {bm || isPng ? null : <button onClick={() => this.saveAs()}>{'Сохранить как…'}</button>}
                    <span className={styles.group}>
                        <button onClick={() => this.exportPng()}>{'Выгрузить PNG'}</button>
                        <select value={this.state.scale} onChange={e => this.setState({scale: e.target.value})} title="Масштаб PNG">
                            <option value="1">{'×1'}</option>
                            <option value="2">{'×2'}</option>
                            <option value="4">{'×4'}</option>
                            <option value="8">{'×8'}</option>
                        </select>
                    </span>
                    {isPng ? null : <button onClick={() => this.copyCode()}>{'Копировать код'}</button>}
                    {bm ? null : <button onClick={() => api.filesOpen(file, true)}>{'Открыть как есть'}</button>}
                    <button className={this.state.panel ? styles.on : ''} onClick={() => this.setPrefState('panel', !this.state.panel)} title="Панель свойств: размеры, выравнивание, контуры">{'Свойства'}</button>
                </header>
                {error ? <div className={styles.error}>{error}</div> : null}
                {this.state.code !== null ? (
                    <div className={styles.code}>
                        <textarea spellCheck={false} value={this.state.code} onChange={e => this.setState({code: e.target.value})} />
                        <div className={styles.row}>
                            <button className={styles.primary} onClick={() => this.applyCode()}>{'Применить'}</button>
                            <button onClick={() => this.setState({code: this.out()})}>{'Взять из рисунка'}</button>
                            <span className={styles.hint}>{'После применения история отмены начнётся заново'}</span>
                        </div>
                    </div>
                ) : null}
                <div className={styles.main}>
                <div className={styles.editor}>
                    {loaded ? (
                        <PaintEditor
                            image={image}
                            imageFormat={this.state.format}
                            imageId={imageId}
                            name={baseName}
                            width={width}
                            height={height}
                            theme={theme}
                            onUpdateImage={this.onUpdateImage}
                            onUpdateName={() => {}}
                        />
                    ) : null}
                </div>
                {this.state.panel ? this.renderPanel() : null}
                </div>
            </div>
        );
    }
}

ReactDOM.render((
    <Provider store={store}>
        <IntlProvider>
            <App />
        </IntlProvider>
    </Provider>
), document.getElementById('root'));
