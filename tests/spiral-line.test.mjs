import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createSpiralLine } from '../spiral-line.mjs';

function fixture() {
    const center = new THREE.BufferGeometry();
    center.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 1, 0, 2, 2, 0], 3));
    center.setAttribute('color', new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1], 3));
    center.setIndex([0, 1, 1, 1, 1, 2]);
    const line = createSpiralLine(center, 0.24);
    return { center, line, dispose() { center.dispose(); line.geometry.dispose(); line.material.dispose(); } };
}

test('wide lines use world-space width and compact missing segments without adding visible dots', () => {
    const { center, line, dispose } = fixture();
    try {
        assert.equal(line.material.worldUnits, true);
        assert.equal(line.material.linewidth, 0.24);
        assert.equal(line.geometry.instanceCount, 2);
        assert.equal(line.centerGeometry, center);
        assert.deepEqual([...line.geometry.attributes.instanceStart.data.array.slice(0, 12)],
            [0, 0, 0, 1, 1, 0, 1, 1, 0, 2, 2, 0]);
        for (const count of [0, 2, 4, 6, Infinity]) {
            center.setDrawRange(0, count); line.sync();
            assert.equal(line.geometry.instanceCount, count === 0 ? 0 : count <= 4 ? 1 : 2);
        }
        const before = line.geometry.attributes.instanceStart.data.version;
        line.material.linewidth = 0.012;
        line.sync();
        assert.equal(line.geometry.attributes.instanceStart.data.version, before, 'Width must not rebuild the path');
    } finally { dispose(); }
});

test('wide lines follow morph positions, gap topology, and animated vertex colors', () => {
    const { center, line, dispose } = fixture();
    try {
        const positions = line.geometry.attributes.instanceStart.data;
        const colors = line.geometry.attributes.instanceColorStart.data;
        center.attributes.color.setXYZ(1, 1, 1, 1);
        center.attributes.color.needsUpdate = true;
        line.sync();
        assert.deepEqual([...colors.array.slice(3, 9)], [1, 1, 1, 1, 1, 1]);
        const colorVersion = colors.version;
        line.sync();
        assert.equal(colors.version, colorVersion, 'Unchanged colors must not upload again');
        center.attributes.position.setXYZ(1, 3, 4, 5);
        center.attributes.position.needsUpdate = true;
        line.sync();
        assert.deepEqual([...positions.array.slice(3, 9)], [3, 4, 5, 3, 4, 5]);
        center.index.array.set([0, 1, 1, 1, 2, 2]);
        center.index.needsUpdate = true;
        line.sync();
        assert.equal(line.geometry.instanceCount, 1);
        center.attributes.position.setXYZ(1, 0, 0, 0);
        center.attributes.position.needsUpdate = true;
        line.sync();
        assert.equal(line.geometry.instanceCount, 0, 'Coincident copies must not create a cap-like dot');
        assert.ok(positions.array.every(Number.isFinite));
    } finally { dispose(); }
});
