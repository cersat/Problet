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
const isPng = !bm && /\.png$/i.test(file); // png открывается сразу в растровом режиме
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
            scale: '1', bitmap: false, format: 'svg'
        };
        this.svg = EMPTY; // последнее состояние рисунка
        this.savedSvg = null; // что лежит в файле
        this.bitmapCanvas = null;
        this.n = 0;
        this.state.title = file;
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
    }
    componentWillUnmount () {
        this.observer.disconnect();
        document.removeEventListener('keydown', this.onKey);
    }
    onKey = e => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
            e.preventDefault();
            this.save();
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
            if (bm) await api.bmIconSet(bm, isEmptyDrawing(this.svg) ? '' : this.svg);
            else this.savedTo = (await api.svgWrite(file, this.svg)).path;
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
            const r = await api.svgSaveAs(this.svg);
            if (r) this.say('Сохранено в ' + r.path);
        } catch (e) {
            this.say(clean(e));
        }
    }
    renderPng () {
        // растр уже готов; для вектора рисуем svg на холсте с выбранным масштабом
        const scale = Number(this.state.scale) || 1;
        if (this.bitmapCanvas) return Promise.resolve(this.bitmapCanvas.toDataURL('image/png'));
        return new Promise((resolve, reject) => {
            const img = new Image();
            const url = URL.createObjectURL(new Blob([this.svg], {type: 'image/svg+xml'}));
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = Math.max(1, Math.round((img.naturalWidth || 1) * scale));
                canvas.height = Math.max(1, Math.round((img.naturalHeight || 1) * scale));
                canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
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
    async copyCode () {
        try {
            await navigator.clipboard.writeText(this.svg);
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
                </header>
                {error ? <div className={styles.error}>{error}</div> : null}
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
