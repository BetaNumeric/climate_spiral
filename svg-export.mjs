import { isConnectedDataSegment } from './spiral-layout.mjs';
import { Color } from 'three';

const SVG_NS = 'http://www.w3.org/2000/svg';
const colorPattern = /^#[\da-f]{6}$/i;

export function getSvgPaths(samples, preserveMonthlyGaps = true) {
    if (!Array.isArray(samples) || samples.length < 2) throw new Error('No spiral is available to export.');
    const paths = [];
    let current = null;
    const color = new Color(), nextColor = new Color();
    for (const sample of samples) {
        if (!Number.isFinite(sample.x) || !Number.isFinite(sample.y) || !Number.isFinite(sample.decimalYear)
            || !colorPattern.test(sample.color)) throw new Error('Invalid spiral coordinates or colors.');
    }
    for (let i = 1; i < samples.length; i++) {
        const a = samples[i - 1], b = samples[i];
        if (a.missing || b.missing || (preserveMonthlyGaps && !isConnectedDataSegment(a, b))) {
            current = null;
            continue;
        }
        // Shared January points do not interrupt the wrapped spiral.
        if (a.x === b.x && a.y === b.y) continue;
        const stroke = a.color === b.color ? a.color.toLowerCase()
            : '#' + color.set(a.color).lerp(nextColor.set(b.color), 0.5).getHexString();
        if (current && current.stroke === stroke) {
            current.points.push([b.x, b.y]);
            current.endColor = b.color;
        } else {
            current = { points: [[a.x, a.y], [b.x, b.y]], startColor: a.color, endColor: b.color, stroke };
            paths.push(current);
        }
    }
    if (!paths.length) throw new Error('No connected spiral segments are available to export.');
    return paths;
}

export function createSpiralSvg({ samples, preserveMonthlyGaps = true, lineWidth, monthRadius, months,
    references = [], annotations = true, title, subtitle = '', description = '', sourceLabel, sourceHref,
    legend, legendPercent = null, endYear, endValue, endDate }, document = globalThis.document) {
    const paths = getSvgPaths(samples, preserveMonthlyGaps);
    if (!Number.isFinite(lineWidth) || lineWidth <= 0 || !Number.isFinite(monthRadius) || monthRadius <= 0
        || !Array.isArray(months) || months.length !== 12
        || references.some(reference => !Number.isFinite(reference.radius) || reference.radius < 0)
        || !legend?.legendStops?.length || legend.legendStops.some(([stop, color]) => !Number.isFinite(stop)
            || stop < 0 || stop > 1 || !colorPattern.test(color))) throw new Error('Invalid SVG export settings.');

    const xml = document.implementation.createDocument(SVG_NS, 'svg', null);
    const svg = xml.documentElement;
    const add = (parent, name, attributes = {}, content) => {
        const element = xml.createElementNS(SVG_NS, name);
        for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
        if (content !== undefined) element.textContent = String(content).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
        parent.appendChild(element);
        return element;
    };
    svg.setAttribute('viewBox', '0 0 1200 1200');
    svg.setAttribute('width', '1200');
    svg.setAttribute('height', '1200');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-labelledby', 'svg-title svg-description');
    svg.setAttribute('font-family', 'Arial, sans-serif');
    add(svg, 'title', { id: 'svg-title' }, title);
    add(svg, 'desc', { id: 'svg-description' }, `${description} Full-history top-down spiral; no 3D lighting or playback highlight. ${sourceLabel}: ${sourceHref}`);
    add(svg, 'metadata', {}, JSON.stringify({ source: sourceLabel, sourceUrl: sourceHref,
        projection: 'top-down spiral', through: endDate, colorCaption: legend.caption ?? '',
        samples: samples.length, preserveMonthlyGaps }));
    const defs = add(svg, 'defs');
    add(svg, 'rect', { width: 1200, height: 1200, fill: '#000000' });
    const text = (parent, x, y, value, size, color = '#888888', extra = {}) => add(parent, 'text', {
        x, y, fill: color, 'font-size': size, 'text-anchor': 'middle', 'dominant-baseline': 'middle', ...extra,
    }, value);
    text(svg, 600, 42, title, Math.min(28, 1040 / (Math.max(1, String(title).length) * 0.6)), '#eeeeee', { 'font-weight': 600 });
    text(svg, 600, 77, subtitle, Math.min(17, 1040 / (Math.max(1, String(subtitle).length) * 0.6)), '#aaaaaa');

    let radius = monthRadius, innerRadius = Infinity;
    for (const reference of references) radius = Math.max(radius, reference.radius);
    for (const sample of samples) {
        const r = Math.hypot(sample.x, sample.y);
        radius = Math.max(radius, r);
        if (!sample.missing) innerRadius = Math.min(innerRadius, r);
    }
    radius += lineWidth / 2;
    const scale = 430 / radius;
    const cx = 600, cy = 550;

    const data = add(svg, 'g', { id: 'spiral-data', transform: `translate(${cx} ${cy}) scale(${scale})`,
        fill: 'none', 'stroke-width': lineWidth, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
    // Keep rounding below 0.002 viewBox units, independently of the scene scale.
    const decimals = Math.min(12, Math.max(0, Math.ceil(Math.log10(scale / 0.002))));
    const number = value => Number(value.toFixed(decimals));
    for (const path of paths) {
        const d = path.points.map(([x, y], i) => `${i ? 'L' : 'M'}${number(x)} ${number(y)}`).join(' ');
        add(data, 'path', { d, stroke: path.stroke });
    }
    if (annotations) {
        const guides = add(svg, 'g', { id: 'reference-guides' });
        for (const { radius: r } of references) {
            add(guides, 'circle', { cx, cy, r: r * scale, fill: 'none', stroke: '#808080', 'stroke-width': 0.6 });
        }
        const referenceLabels = add(svg, 'g', { id: 'reference-labels' });
        for (const { radius: r, label } of references) {
            text(referenceLabels, cx + r * scale / Math.SQRT2, cy + r * scale / Math.SQRT2, label, 14, '#ffffff',
                { stroke: '#000000', 'stroke-width': 1.5, 'stroke-linejoin': 'round', 'paint-order': 'stroke' });
        }
        const labels = add(svg, 'g', { id: 'month-labels' });
        months.forEach((month, index) => {
            const angle = index / 12 * Math.PI * 2 - Math.PI / 2;
            text(labels, cx + Math.cos(angle) * monthRadius * scale, cy + Math.sin(angle) * monthRadius * scale, month, 21);
        });
        const yearSize = Math.min(64, innerRadius * scale * 1.5 / (String(endYear).length * 0.6));
        if (yearSize >= 20) text(svg, cx, cy, endYear, yearSize, samples.at(-1).color, { id: 'year-label' });
    }

    const legendGroup = add(svg, 'g', { id: 'color-legend' });
    text(legendGroup, 180, 1024, endDate, 22, '#eeeeee', { 'text-anchor': 'start', 'font-weight': 600 });
    text(legendGroup, 1020, 1024, endValue, 22, samples.at(-1).color, { 'text-anchor': 'end', 'font-weight': 600 });
    const gradient = add(defs, 'linearGradient', { id: 'legend-gradient', 'color-interpolation': 'sRGB' });
    for (const [offset, color] of legend.legendStops) add(gradient, 'stop', { offset, 'stop-color': color });
    add(legendGroup, 'rect', { x: 180, y: 1052, width: 840, height: 14, fill: 'url(#legend-gradient)' });
    if (Number.isFinite(legendPercent)) {
        add(legendGroup, 'rect', { id: 'legend-marker', x: 180 + 8.4 * Math.max(0, Math.min(100, legendPercent)) - 1,
            y: 1047, width: 2, height: 24, fill: '#ffffff' });
    }
    legend.legendLabels.forEach((label, index, all) => {
        const fraction = all.length === 1 ? 0.5 : index / (all.length - 1);
        text(legendGroup, 180 + fraction * 840, 1091, label, 18, '#cccccc',
            { 'text-anchor': index === 0 ? 'start' : index === all.length - 1 ? 'end' : 'middle' });
    });
    if (legend.caption) text(legendGroup, 600, 1123, legend.caption, 17, '#aaaaaa');
    text(svg, 600, 1165, `Source: ${sourceLabel}`, 16, '#888888');
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(svg);
}
