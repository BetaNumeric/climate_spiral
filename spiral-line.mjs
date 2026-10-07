import { DynamicDrawUsage } from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

export function createSpiralLine(centerGeometry, width) {
    const capacity = centerGeometry.index.count / 2;
    const geometry = new LineSegmentsGeometry();
    geometry.setPositions(new Float32Array(capacity * 6));
    geometry.setColors(new Float32Array(capacity * 6));
    geometry.attributes.instanceStart.data.setUsage(DynamicDrawUsage);
    geometry.attributes.instanceColorStart.data.setUsage(DynamicDrawUsage);
    const material = new LineMaterial({ vertexColors: true, worldUnits: true, linewidth: width, alphaToCoverage: true });
    const line = new LineSegments2(geometry, material);
    line.centerGeometry = centerGeometry;
    line.frustumCulled = false;
    const slots = new Uint32Array(capacity);
    const pairs = new Uint32Array(capacity * 2);
    let positionVersion = -1, colorVersion = -1, indexVersion = -1, segmentCount = 0;
    const beforeRender = line.onBeforeRender;
    line.sync = () => {
        const { position, color } = centerGeometry.attributes;
        const index = centerGeometry.index;
        const moved = positionVersion !== position.version || indexVersion !== index.version;
        if (moved) {
            segmentCount = 0;
            const positions = geometry.attributes.instanceStart.data;
            for (let i = 0; i < index.count; i += 2) {
                const a = index.array[i], b = index.array[i + 1];
                const offsetA = a * 3, offsetB = b * 3;
                // Missing intervals and coincident January copies must not become visible dots.
                if (a === b || (position.array[offsetA] === position.array[offsetB]
                    && position.array[offsetA + 1] === position.array[offsetB + 1]
                    && position.array[offsetA + 2] === position.array[offsetB + 2])) continue;
                slots[segmentCount] = i / 2;
                pairs[segmentCount * 2] = a;
                pairs[segmentCount * 2 + 1] = b;
                for (let axis = 0; axis < 3; axis++) {
                    positions.array[segmentCount * 6 + axis] = position.array[offsetA + axis];
                    positions.array[segmentCount * 6 + 3 + axis] = position.array[offsetB + axis];
                }
                segmentCount++;
            }
            positions.needsUpdate = true;
            positionVersion = position.version;
            indexVersion = index.version;
        }
        if (moved || colorVersion !== color.version) {
            const colors = geometry.attributes.instanceColorStart.data;
            for (let i = 0; i < segmentCount * 2; i++) {
                for (let axis = 0; axis < 3; axis++) colors.array[i * 3 + axis] = color.array[pairs[i] * 3 + axis];
            }
            colors.needsUpdate = true;
            colorVersion = color.version;
        }
        let visible = 0;
        const lastSlot = centerGeometry.drawRange.count / 2;
        while (visible < segmentCount && slots[visible] < lastSlot) visible++;
        geometry.instanceCount = visible;
    };
    line.onBeforeRender = function (...args) {
        this.sync();
        beforeRender.apply(this, args);
    };
    line.sync();
    return line;
}
