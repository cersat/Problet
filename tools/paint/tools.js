// Дополнительные инструменты редактора Problet поверх scratch-paint: точные размеры, выравнивание, логические операции с фигурами, вставка картинок.
// Работают с выделением в векторном режиме и сохраняют результат так же, как это делает сам редактор (с шагом отмены).
import paper from '@turbowarp/paper';
import {getSelectedRootItems, getSelectedLeafItems, setItemSelection, clearSelection} from '../helper/selection';
import {setSelectedItems, redrawSelectionBox} from '../reducers/selected-items';
import {undoSnapshot} from '../reducers/undo';
import {updateViewBounds} from '../reducers/view-bounds';
import {performSnapshot} from '../helper/undo';
import {hideGuideLayers, showGuideLayers} from '../helper/layer';
import {scaleWithStrokes} from '../helper/math';
import {ART_BOARD_WIDTH, ART_BOARD_HEIGHT, SVG_ART_BOARD_WIDTH, SVG_ART_BOARD_HEIGHT, CENTER, setWorkspaceBounds} from '../helper/view';
import Formats, {isBitmap} from '../lib/format';

// Внутри редактора всё нарисовано в масштабе 2:1, пользователю показываем единицы svg
const K = 2;

let store = null;
let onUpdate = null;
export function attach (reduxStore, onUpdateImage) {
    store = reduxStore;
    onUpdate = onUpdateImage;
}

export const bitmapMode = () => !store || isBitmap(store.getState().scratchPaint.format);
export const selection = () => (bitmapMode() || !paper.project ? [] : getSelectedRootItems());

// То же, что делает scratch-paint после каждого изменения: svg в onUpdateImage и шаг отмены
export function commit () {
    let mask = null;
    const layer = paper.project.activeLayer;
    if (layer.clipped) {
        for (const child of layer.children) {
            if (child.isClipMask()) {
                mask = child;
                break;
            }
        }
        layer.clipped = false;
        mask.remove();
    }
    const guides = hideGuideLayers(true);
    scaleWithStrokes(layer, 0.5, new paper.Point());
    const b = layer.drawnBounds;
    const cx = b.width === 0 ? 0 : (SVG_ART_BOARD_WIDTH / 2) - b.x;
    const cy = b.height === 0 ? 0 : (SVG_ART_BOARD_HEIGHT / 2) - b.y;
    const svg = paper.project.exportSVG({asString: true, bounds: 'content', matrix: new paper.Matrix().translate(-b.x, -b.y)});
    scaleWithStrokes(layer, 2, new paper.Point());
    layer.applyMatrix = true;
    showGuideLayers(guides);
    if (mask) {
        layer.addChild(mask);
        mask.clipMask = true;
    }
    onUpdate(true, svg, cx, cy);
    setWorkspaceBounds();
    store.dispatch(updateViewBounds(paper.view.matrix));
    performSnapshot(s => store.dispatch(undoSnapshot(s)), Formats.VECTOR);
    store.dispatch(setSelectedItems(getSelectedLeafItems(), false));
    store.dispatch(redrawSelectionBox());
}

function unionBounds (items) {
    let r = null;
    for (const it of items) r = r ? r.unite(it.bounds) : it.bounds.clone();
    return r;
}

// Размер и место выделения в единицах svg
export function selectionBox () {
    const items = selection();
    if (!items.length) return null;
    const r = unionBounds(items);
    const opacity = items.reduce((s, it) => s + it.opacity, 0) / items.length;
    return {x: r.x / K, y: r.y / K, w: r.width / K, h: r.height / K, opacity: Math.round(opacity * 100), count: items.length};
}

export function setBox (patch, keepRatio) {
    const items = selection();
    if (!items.length) return;
    const r = unionBounds(items);
    let w = patch.w === undefined ? r.width : patch.w * K;
    let h = patch.h === undefined ? r.height : patch.h * K;
    if (keepRatio && r.width > 0 && r.height > 0) {
        if (patch.w !== undefined && patch.h === undefined) h = r.height * w / r.width;
        if (patch.h !== undefined && patch.w === undefined) w = r.width * h / r.height;
    }
    const sx = r.width > 0 && w > 0 ? w / r.width : 1;
    const sy = r.height > 0 && h > 0 ? h / r.height : 1;
    const origin = r.topLeft;
    for (const it of items) if (sx !== 1 || sy !== 1) it.scale(sx, sy, origin);
    const nr = unionBounds(items);
    const dx = patch.x === undefined ? 0 : patch.x * K - nr.x;
    const dy = patch.y === undefined ? 0 : patch.y * K - nr.y;
    for (const it of items) it.position = it.position.add(new paper.Point(dx, dy));
    commit();
}

export function rotate (deg) {
    const items = selection();
    if (!items.length || !deg) return;
    const c = unionBounds(items).center;
    for (const it of items) it.rotate(deg, c);
    commit();
}

export function setOpacity (pct) {
    const items = selection();
    if (!items.length) return;
    for (const it of items) it.opacity = Math.min(1, Math.max(0, pct / 100));
    commit();
}

// Одна фигура выравнивается по холсту, несколько — по общей рамке
export function align (how) {
    const items = selection();
    if (!items.length) return;
    const ref = items.length === 1 ? new paper.Rectangle(0, 0, ART_BOARD_WIDTH, ART_BOARD_HEIGHT) : unionBounds(items);
    for (const it of items) {
        const b = it.bounds;
        let dx = 0;
        let dy = 0;
        if (how === 'left') dx = ref.left - b.left;
        if (how === 'hcenter') dx = ref.center.x - b.center.x;
        if (how === 'right') dx = ref.right - b.right;
        if (how === 'top') dy = ref.top - b.top;
        if (how === 'vcenter') dy = ref.center.y - b.center.y;
        if (how === 'bottom') dy = ref.bottom - b.bottom;
        it.position = it.position.add(new paper.Point(dx, dy));
    }
    commit();
}

// Равные промежутки между фигурами (крайние остаются на месте)
export function distribute (axis) {
    const items = selection();
    if (items.length < 3) return false;
    const horiz = axis === 'h';
    const sorted = [...items].sort((a, b) => (horiz ? a.bounds.left - b.bounds.left : a.bounds.top - b.bounds.top));
    const first = sorted[0].bounds;
    const last = sorted[sorted.length - 1].bounds;
    const span = horiz ? last.right - first.left : last.bottom - first.top;
    const sizes = sorted.reduce((s, it) => s + (horiz ? it.bounds.width : it.bounds.height), 0);
    const gap = (span - sizes) / (sorted.length - 1);
    let at = horiz ? first.left : first.top;
    for (const it of sorted) {
        const b = it.bounds;
        if (horiz) it.position = it.position.add(new paper.Point(at - b.left, 0));
        else it.position = it.position.add(new paper.Point(0, at - b.top));
        at += (horiz ? b.width : b.height) + gap;
    }
    commit();
    return true;
}

// Объединить, вычесть верхние из нижней, пересечь, исключить пересечение
export function boolean (op) {
    const items = selection().filter(it => it instanceof paper.PathItem);
    if (items.length < 2) return false;
    items.sort((a, b) => a.index - b.index);
    const base = items[0];
    let result = base;
    for (const it of items.slice(1)) {
        const next = result[op](it, {insert: false});
        if (result !== base) result.remove();
        result = next;
    }
    result.style = base.style;
    result.opacity = base.opacity;
    result.insertAbove(items[items.length - 1]);
    for (const it of items) it.remove();
    clearSelection(() => store.dispatch(setSelectedItems([], false)));
    setItemSelection(result, true);
    commit();
    return true;
}

// Картинка из файла — новой фигурой в середине холста
export function insertImage (kind, data) {
    return new Promise((resolve, reject) => {
        const place = item => {
            const w = item.bounds.width;
            const h = item.bounds.height;
            // не больше холста
            const fit = Math.min(1, (ART_BOARD_WIDTH * 0.9) / (w || 1), (ART_BOARD_HEIGHT * 0.9) / (h || 1));
            if (fit < 1) item.scale(fit);
            item.position = CENTER;
            paper.project.activeLayer.addChild(item);
            clearSelection(() => store.dispatch(setSelectedItems([], false)));
            setItemSelection(item, true);
            commit();
            resolve();
        };
        if (kind === 'svg') {
            let item;
            try {
                item = paper.project.importSVG(data, {insert: false, expandShapes: true});
            } catch (e) {
                reject(new Error('Не удалось разобрать svg'));
                return;
            }
            if (!item) return reject(new Error('Не удалось разобрать svg'));
            scaleWithStrokes(item, K, new paper.Point());
            place(item);
        } else {
            const raster = new paper.Raster({source: data, insert: false});
            raster.onLoad = () => {
                raster.scale(K);
                place(raster);
            };
            raster.onError = () => reject(new Error('Не удалось открыть картинку'));
        }
    });
}
