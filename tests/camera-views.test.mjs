import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCameraController } from '../camera-controller.mjs';

class Controls extends EventTarget {
    constructor(object) {
        super();
        this.object = object;
        this.target = new THREE.Vector3();
        this.enabled = true;
    }
    update() { this.object.lookAt(this.target); }
}

function harness(t, perspective = false) {
    const previous = new Map(['document', 'window', 'requestAnimationFrame'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    t.after(() => {
        for (const [key, descriptor] of previous) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else delete globalThis[key];
        }
    });
    let now = 1000, busy = false, reduced = false, editing = false;
    const frames = [];
    t.mock.method(performance, 'now', () => now);
    globalThis.document = new EventTarget();
    document.getElementById = () => ({ checked: false });
    document.closest = () => editing ? {} : null;
    globalThis.window = { matchMedia: () => ({ matches: reduced }) };
    globalThis.requestAnimationFrame = callback => { frames.push(callback); };
    const canvas = new EventTarget();
    const orthographicCamera = new THREE.OrthographicCamera(-35, 35, 35, -35, 0.1, 1000);
    const perspectiveCamera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    orthographicCamera.position.set(0, 200, 0.0001);
    orthographicCamera.lookAt(0, 0, 0);
    perspectiveCamera.position.copy(orthographicCamera.position);
    const state = { orthographicCamera, perspectiveCamera, activeCamera: perspective ? perspectiveCamera : orthographicCamera,
        spiralHeight: 24, controls: null };
    const camera = createCameraController({ THREE, OrbitControls: Controls, canvas, getSceneState: () => state,
        isBusy: () => busy, defaultDistance: 200 });
    state.controls = camera.createControls(state.activeCamera, new THREE.Vector3(0, 12, 0));
    camera.setupGestures();
    const flush = () => { while (frames.length) frames.shift()(); };
    const pointer = (type, x = 10, y = 10, button = 2) => {
        const event = new Event(type, { cancelable: true });
        Object.assign(event, { pointerType: 'mouse', pointerId: 1, clientX: x, clientY: y, button });
        canvas.dispatchEvent(event);
        return event.defaultPrevented;
    };
    const touch = (type, pointerId, x = 80 + pointerId * 30, y = 100) => {
        const event = new Event(type, { cancelable: true });
        Object.assign(event, { pointerType: 'touch', pointerId, clientX: x, clientY: y });
        canvas.dispatchEvent(event);
        return event.defaultPrevented;
    };
    return {
        camera, state, pointer, touch,
        advance(ms) { now += ms; camera.update(); },
        finish() { flush(); now += 1000; camera.update(); },
        flush,
        setBusy(value) { busy = value; },
        setReduced(value) { reduced = value; },
        setEditing(value) { editing = value; },
        key(key, modifiers = {}) {
            const event = new Event('keydown', { cancelable: true });
            Object.assign(event, { key, ...modifiers });
            document.dispatchEvent(event);
            return event.defaultPrevented;
        },
        position(polar, azimuth, radius = 83, zoom = 1.35, target = new THREE.Vector3(2, 13, -3)) {
            state.controls.target.copy(target);
            state.activeCamera.position.copy(target).add(new THREE.Vector3().setFromSphericalCoords(radius, polar, azimuth));
            state.activeCamera.zoom = zoom;
            state.controls.update();
        },
        angles() { return new THREE.Spherical().setFromVector3(state.activeCamera.position.clone().sub(state.controls.target)); },
        doubleRight() {
            pointer('pointerdown'); now += 10; pointer('pointerup');
            now += 70;
            pointer('pointerdown'); now += 10;
            return pointer('pointerup');
        },
        twoFingerTap({ reverse = false, offset = 0, duration = 30 } = {}) {
            touch('pointerdown', 1, 110 + offset);
            now += 10;
            touch('pointerdown', 2, 140 + offset);
            now += duration;
            touch('pointerup', reverse ? 2 : 1, (reverse ? 140 : 110) + offset);
            now += 10;
            return touch('pointerup', reverse ? 1 : 2, (reverse ? 110 : 140) + offset);
        },
        doubleTwoFinger(options) {
            this.twoFingerTap(options);
            now += 70;
            return this.twoFingerTap(options);
        },
        orbit(polar, azimuth, endPolar, endAzimuth) {
            this.position(polar, azimuth);
            state.controls.dispatchEvent(new Event('start'));
            this.position(endPolar, endAzimuth);
            state.controls.dispatchEvent(new Event('end'));
            flush();
        }
    };
}

function assertView(h, polar, azimuth) {
    const current = h.angles();
    assert.ok(Math.abs(current.phi - polar) < 1e-6);
    if (polar !== 0) assert.ok(Math.abs(Math.atan2(Math.sin(current.theta - azimuth), Math.cos(current.theta - azimuth))) < 1e-6);
    assert.equal(h.state.controls.enabled, true);
}

test('all five shortcut keys select the correct views in orthographic and perspective cameras', t => {
    for (const perspective of [false, true]) {
        const h = harness(t, perspective);
        for (const [key, azimuth] of [['2', 0], ['3', Math.PI / 2], ['4', -Math.PI / 2], ['5', Math.PI]]) {
            assert.equal(h.key(key), true);
            assert.equal(h.camera.isAnimating, true);
            h.finish();
            assertView(h, Math.PI / 2, azimuth);
            assert.equal(h.state.activeCamera.zoom, 1);
            assert.deepEqual(h.state.controls.target.toArray(), [0, 12, 0]);
        }
        h.key('1'); h.finish();
        assertView(h, 0, 0);
    }
});

test('double-right-click changes top to front and cycles all four side views', t => {
    const h = harness(t);
    h.key('1'); h.finish();
    for (const azimuth of [0, Math.PI / 2, Math.PI, -Math.PI / 2, 0, Math.PI / 2]) {
        assert.equal(h.doubleRight(), true);
        h.finish();
        assertView(h, Math.PI / 2, azimuth);
    }
});

test('rapid double-right-clicks continue from each animated destination', t => {
    const h = harness(t);
    h.key('1'); h.finish();
    for (let i = 0; i < 4; i++) h.doubleRight();
    h.finish();
    assertView(h, Math.PI / 2, -Math.PI / 2);
    h.doubleRight(); h.finish();
    assertView(h, Math.PI / 2, 0);
});

test('arrow keys select top/front and rotate both ways only from a side view', t => {
    const h = harness(t);
    assert.equal(h.key('ArrowUp'), true); h.finish();
    assertView(h, 0, 0);
    assert.equal(h.key('ArrowLeft'), false);
    assert.equal(h.key('ArrowRight'), false);
    assert.equal(h.camera.isAnimating, false);
    assert.equal(h.key('ArrowDown'), true); h.finish();
    assertView(h, Math.PI / 2, 0);
    for (const azimuth of [-Math.PI / 2, Math.PI, Math.PI / 2, 0]) {
        assert.equal(h.key('ArrowLeft'), true); h.finish();
        assertView(h, Math.PI / 2, azimuth);
    }
    for (const azimuth of [Math.PI / 2, Math.PI, -Math.PI / 2, 0]) {
        assert.equal(h.key('ArrowRight'), true); h.finish();
        assertView(h, Math.PI / 2, azimuth);
    }
});

test('arrow rotation can reverse or continue an unfinished camera turn', t => {
    const h = harness(t);
    h.key('ArrowDown');
    h.key('ArrowLeft');
    h.key('ArrowRight');
    h.key('ArrowRight');
    h.finish();
    assertView(h, Math.PI / 2, Math.PI / 2);
});

test('side cycling uses a smooth positive quarter turn through the back-left wrap', t => {
    const h = harness(t);
    h.key('5'); h.finish();
    h.doubleRight();
    h.advance(225);
    const current = h.angles();
    assert.ok(Math.abs(current.theta + Math.PI * 3 / 4) < 1e-6);
    assert.equal(h.camera.isAnimating, true);
    h.finish();
    assertView(h, Math.PI / 2, -Math.PI / 2);
});

test('magnetic snapping includes left and back and preserves framing across both cameras', t => {
    for (const perspective of [false, true]) {
        const h = harness(t, perspective);
        for (const [polar, azimuth] of [[0, 0], [Math.PI / 2, 0], [Math.PI / 2, Math.PI / 2],
            [Math.PI / 2, -Math.PI / 2], [Math.PI / 2, Math.PI], [Math.PI / 2, -Math.PI]]) {
            h.orbit(polar === 0 ? 0.3 : polar, azimuth + 0.3, polar === 0 ? 0.08 : polar, azimuth + 0.08);
            assert.equal(h.camera.isAnimating, true);
            h.finish();
            assertView(h, polar, azimuth);
            assert.ok(Math.abs(h.angles().radius - 83) < 1e-6);
            assert.equal(h.state.activeCamera.zoom, 1.35);
            assert.deepEqual(h.state.controls.target.toArray(), [2, 13, -3]);
        }
    }
});

test('distant orientations, zoom-only gestures, and busy sessions do not snap', t => {
    const h = harness(t);
    h.orbit(Math.PI / 2, -Math.PI / 2 + 0.4, Math.PI / 2, -Math.PI / 2 + 0.2);
    assert.equal(h.camera.isAnimating, false);
    h.orbit(Math.PI / 2, Math.PI + 0.08, Math.PI / 2, Math.PI + 0.08);
    assert.equal(h.camera.isAnimating, false);
    h.setBusy(true);
    h.orbit(Math.PI / 2, Math.PI + 0.3, Math.PI / 2, Math.PI + 0.08);
    assert.equal(h.camera.isAnimating, false);
});

test('new keyboard views and side cycling respect editing, modifier, and preview locks', t => {
    const h = harness(t);
    for (const key of ['4', '5', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
        h.setEditing(true);
        assert.equal(h.key(key), false);
        h.setEditing(false);
        for (const modifier of ['ctrlKey', 'shiftKey', 'metaKey', 'altKey', 'repeat']) {
            assert.equal(h.key(key, { [modifier]: true }), false);
        }
        h.setBusy(true);
        assert.equal(h.key(key), false);
        h.doubleRight();
        h.setBusy(false);
        assert.equal(h.camera.isAnimating, false);
    }
});

test('right-button panning and long presses are not mistaken for double-right-click', t => {
    const h = harness(t);
    h.pointer('pointerdown'); h.pointer('pointermove', 50); h.pointer('pointerup', 50);
    h.pointer('pointerdown', 50); h.pointer('pointerup', 50);
    assert.equal(h.camera.isAnimating, false);
    h.advance(1000);
    h.pointer('pointerdown'); h.advance(350); h.pointer('pointerup');
    h.pointer('pointerdown'); h.pointer('pointerup');
    assert.equal(h.camera.isAnimating, false);
});

test('reduced motion applies left, back, and cycling without animation', t => {
    const h = harness(t);
    h.setReduced(true);
    h.key('4'); assertView(h, Math.PI / 2, -Math.PI / 2);
    h.key('5'); assertView(h, Math.PI / 2, Math.PI);
    h.doubleRight(); assertView(h, Math.PI / 2, -Math.PI / 2);
    assert.equal(h.camera.isAnimating, false);
});

test('two-finger double-tap cycles all side views with either finger lifted first', t => {
    const h = harness(t);
    h.key('1'); h.finish();
    for (const [index, azimuth] of [0, Math.PI / 2, Math.PI, -Math.PI / 2, 0].entries()) {
        assert.equal(h.doubleTwoFinger({ reverse: index % 2 === 0 }), true);
        h.finish();
        assertView(h, Math.PI / 2, azimuth);
    }
    // One-finger reset must still work immediately after a two-finger gesture.
    h.touch('pointerdown', 1); h.touch('pointerup', 1);
    h.advance(70);
    h.touch('pointerdown', 1); h.touch('pointerup', 1);
    h.finish();
    assertView(h, 0, 0);
});

test('two-finger cycling honors reduced motion and can continue an unfinished turn', t => {
    const h = harness(t);
    h.doubleTwoFinger(); h.flush();
    assert.equal(h.camera.isAnimating, true);
    h.doubleTwoFinger(); h.flush(); h.finish();
    assertView(h, Math.PI / 2, Math.PI / 2);
    h.setReduced(true);
    h.doubleTwoFinger(); h.flush();
    assert.equal(h.camera.isAnimating, false);
    assertView(h, Math.PI / 2, Math.PI);
});

test('a single two-finger tap, distant taps, and slow taps do not change the view', t => {
    const h = harness(t);
    h.twoFingerTap(); h.flush();
    assert.equal(h.camera.isAnimating, false);
    h.twoFingerTap({ offset: 60 }); h.flush();
    assert.equal(h.camera.isAnimating, false);
    h.advance(501);
    h.twoFingerTap({ offset: 60 }); h.flush();
    assert.equal(h.camera.isAnimating, false);
    h.advance(600);
    h.doubleTwoFinger({ duration: 350 }); h.flush();
    assert.equal(h.camera.isAnimating, false);
});

for (const cancel of ['pinch', 'third finger', 'pointer cancel', 'move before pairing', 'move after lifting',
    'release displacement', 'held finger', 'replacement finger', 'single tap', 'busy']) {
    test(`two-finger taps reject ${cancel} and discard the previous tap`, t => {
        const h = harness(t);
        h.twoFingerTap();
        h.advance(70);
        h.touch('pointerdown', 1);
        if (cancel === 'move before pairing') h.touch('pointermove', 1, 135);
        if (cancel === 'held finger') h.advance(350);
        if (cancel !== 'single tap') h.touch('pointerdown', 2);
        if (cancel === 'pinch') h.touch('pointermove', 2, 170);
        if (cancel === 'third finger') h.touch('pointerdown', 3);
        if (cancel === 'busy') h.setBusy(true);
        h.touch(cancel === 'pointer cancel' ? 'pointercancel' : 'pointerup', 1,
            cancel === 'release displacement' ? 135 : 110);
        if (cancel === 'move after lifting') h.touch('pointermove', 2, 165);
        if (cancel === 'replacement finger') {
            h.touch('pointerdown', 3);
            h.touch('pointerup', 3);
        }
        h.touch('pointerup', 2);
        if (cancel === 'third finger') h.touch('pointerup', 3);
        h.setBusy(false);
        h.flush();
        assert.equal(h.camera.isAnimating, false);
        h.twoFingerTap(); h.flush();
        assert.equal(h.camera.isAnimating, false, 'A cancelled gesture must not count as the first tap');
        h.advance(70);
        h.twoFingerTap(); h.finish();
        assertView(h, Math.PI / 2, 0);
    });
}

test('a queued two-finger gesture cannot override a newly started preview', t => {
    const h = harness(t);
    h.doubleTwoFinger();
    h.setBusy(true); h.flush();
    assert.equal(h.camera.isAnimating, false);
    h.doubleTwoFinger(); h.flush();
    h.setBusy(false);
    h.twoFingerTap(); h.flush();
    assert.equal(h.camera.isAnimating, false);
});
