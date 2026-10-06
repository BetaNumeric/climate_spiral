import test from 'node:test';
import assert from 'node:assert/strict';
import { Quaternion } from 'three';
import { createCameraController } from '../camera-controller.mjs';

const triangle = [{ clientX: 195, clientY: 340 }, { clientX: 135, clientY: 430 }, { clientX: 255, clientY: 430 }];
const scale = (factor, points = triangle) => points.map(point => ({
    clientX: 195 + (point.clientX - 195) * factor,
    clientY: 400 + (point.clientY - 400) * factor
}));

function harness(t) {
    const previousDocument = globalThis.document;
    globalThis.document = new EventTarget();
    t.after(() => {
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
    });
    const canvas = new EventTarget(), layouts = [];
    let busy = false;
    const camera = createCameraController({
        canvas, defaultDistance: 200,
        getSceneState: () => ({ orthographicCamera: { quaternion: new Quaternion() } }),
        isBusy: () => busy,
        onLayoutGesture: layout => layouts.push(layout)
    });
    camera.setupGestures();
    return {
        layouts,
        setBusy: value => { busy = value; },
        touch(type, touches = triangle, targetTouches = touches) {
            const event = new Event(type, { cancelable: true });
            Object.assign(event, { touches, targetTouches });
            canvas.dispatchEvent(event);
            return event.defaultPrevented;
        }
    };
}

test('spreading three fingers unwraps, while bringing them together wraps the spiral', t => {
    const h = harness(t);
    assert.equal(h.touch('touchstart'), true);
    assert.equal(h.touch('touchmove', scale(1.5)), true);
    assert.deepEqual(h.layouts, ['graph']);
    h.touch('touchend', []);
    h.touch('touchstart');
    h.touch('touchmove', scale(0.5));
    assert.deepEqual(h.layouts, ['graph', 'spiral']);
});

test('one- and two-finger gestures do not change layout or cancel normal camera interaction', t => {
    const h = harness(t);
    for (const count of [1, 2]) {
        assert.equal(h.touch('touchstart', triangle.slice(0, count)), false);
        assert.equal(h.touch('touchmove', scale(1.5).slice(0, count)), false);
        h.touch('touchend', []);
    }
    assert.deepEqual(h.layouts, []);
});

test('small movements and translating all fingers together do not trigger a layout switch', t => {
    const h = harness(t);
    h.touch('touchstart');
    h.touch('touchmove', scale(1.08));
    h.touch('touchmove', triangle.map(point => ({ clientX: point.clientX + 75, clientY: point.clientY - 20 })));
    assert.deepEqual(h.layouts, []);
});

test('both relative and absolute movement thresholds protect against tiny gestures', t => {
    const h = harness(t);
    const small = scale(0.02);
    h.touch('touchstart', small);
    h.touch('touchmove', scale(3, small));
    assert.deepEqual(h.layouts, []);
    h.touch('touchmove', scale(10, small));
    assert.deepEqual(h.layouts, ['graph']);
});

test('one gesture triggers only one transition and requires a fresh touch sequence to reverse', t => {
    const h = harness(t);
    h.touch('touchstart');
    h.touch('touchmove', scale(1.5));
    h.touch('touchmove', scale(2));
    h.touch('touchmove', scale(0.5));
    assert.deepEqual(h.layouts, ['graph']);
    h.touch('touchend', []);
    h.touch('touchstart');
    h.touch('touchmove', scale(0.5));
    assert.deepEqual(h.layouts, ['graph', 'spiral']);
});

test('touch cancellation and lifting a finger invalidate the current pinch', t => {
    const h = harness(t);
    for (const type of ['touchcancel', 'touchend']) {
        h.touch('touchstart');
        h.touch(type, triangle.slice(0, 2));
        h.touch('touchmove', scale(1.5));
    }
    assert.deepEqual(h.layouts, []);
    h.touch('touchstart');
    h.touch('touchmove', scale(1.5));
    assert.deepEqual(h.layouts, ['graph']);
});

test('a fourth finger or a touch starting outside the canvas prevents recognition', t => {
    const h = harness(t);
    h.touch('touchstart');
    h.touch('touchstart', [...triangle, { clientX: 80, clientY: 200 }]);
    h.touch('touchmove', scale(1.5));
    h.touch('touchstart', triangle, triangle.slice(0, 2));
    h.touch('touchmove', scale(1.5), scale(1.5).slice(0, 2));
    assert.deepEqual(h.layouts, []);
});

test('preview or recording locks block new gestures and invalidate gestures already underway', t => {
    const h = harness(t);
    h.setBusy(true);
    h.touch('touchstart');
    h.setBusy(false);
    h.touch('touchmove', scale(1.5));
    assert.deepEqual(h.layouts, []);
    h.touch('touchstart');
    h.setBusy(true);
    h.touch('touchmove', scale(1.5));
    h.setBusy(false);
    h.touch('touchmove', scale(2));
    assert.deepEqual(h.layouts, []);
    h.touch('touchend', []);
    h.touch('touchstart');
    h.touch('touchmove', scale(1.5));
    assert.deepEqual(h.layouts, ['graph']);
});
