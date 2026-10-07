import test from 'node:test';
import assert from 'node:assert/strict';
import { getCalendarStepIndex, setupStepButtons } from '../timeline-controls.mjs';

function harness(t) {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const button = new EventTarget(), document = new EventTarget(), window = new EventTarget();
    Object.assign(button, { disabled: false, isConnected: true,
        getClientRects: () => [{}], getBoundingClientRect: () => ({ left: 0, top: 0, right: 40, bottom: 40 }) });
    document.hidden = false;
    let busy = false, progress = true;
    const steps = [];
    const dispose = setupStepButtons({ buttons: [{ button, direction: 1 }], document, window,
        isBusy: () => busy, step: (direction, months) => { steps.push([direction, months]); return progress; } });
    const send = (target, type, extra = {}) => {
        const event = new Event(type, { cancelable: true });
        Object.assign(event, { pointerId: 1, button: 0, isPrimary: true, shiftKey: false, clientX: 10, clientY: 10, ...extra });
        target.dispatchEvent(event);
        return event.defaultPrevented;
    };
    return { button, document, window, steps, send, dispose,
        pointer: (type, extra) => send(button, type, extra),
        tick: ms => t.mock.timers.tick(ms),
        setBusy(value) { busy = value; },
        setProgress(value) { progress = value; } };
}

test('a tap steps immediately once without an extra click; a deliberate hold repeats', t => {
    const h = harness(t);
    h.pointer('pointerdown');
    assert.deepEqual(h.steps, [[1, 1]]);
    h.tick(449); assert.equal(h.steps.length, 1);
    h.tick(1); assert.equal(h.steps.length, 2);
    h.tick(120); assert.equal(h.steps.length, 3);
    h.send(h.document, 'pointerup');
    assert.equal(h.pointer('click', { detail: 1, pointerType: 'mouse' }), true);
    h.tick(1000); assert.equal(h.steps.length, 3);
    h.pointer('pointerdown'); h.send(h.document, 'pointerup');
    h.pointer('click', { detail: 1 });
    assert.equal(h.steps.length, 4);
});

test('Shift-click, keyboard activation, and changing Shift during a hold use the expected step sizes', t => {
    const h = harness(t);
    h.pointer('click', { detail: 0, shiftKey: true });
    h.pointer('pointerdown', { shiftKey: true });
    h.tick(450);
    h.send(h.document, 'keyup', { key: 'Shift' }); h.tick(120);
    h.send(h.document, 'keydown', { key: 'Shift' }); h.tick(120);
    assert.deepEqual(h.steps, [[1, 12], [1, 12], [1, 12], [1, 1], [1, 12]]);
    h.send(h.document, 'pointerup');
    h.pointer('click', { detail: 0 });
    assert.deepEqual(h.steps.at(-1), [1, 1], 'Native keyboard activation is not suppressed by an old pointer click');
});

for (const reason of ['cancel', 'leave', 'move outside', 'lost capture', 'blur', 'hidden', 'busy', 'disabled',
    'detached', 'invisible', 'endpoint', 'another finger', 'other key', 'dispose']) {
    test(`button hold stops on ${reason}`, t => {
        const h = harness(t);
        h.pointer('pointerdown'); h.tick(450);
        const count = h.steps.length;
        if (reason === 'cancel') h.send(h.document, 'pointercancel');
        if (reason === 'leave') h.pointer('pointerleave');
        if (reason === 'move outside') h.pointer('pointermove', { clientX: 60 });
        if (reason === 'lost capture') h.pointer('lostpointercapture');
        if (reason === 'blur') h.send(h.window, 'blur');
        if (reason === 'hidden') { h.document.hidden = true; h.send(h.document, 'visibilitychange'); }
        if (reason === 'busy') h.setBusy(true);
        if (reason === 'disabled') h.button.disabled = true;
        if (reason === 'detached') h.button.isConnected = false;
        if (reason === 'invisible') h.button.getClientRects = () => [];
        if (reason === 'endpoint') h.setProgress(false);
        if (reason === 'another finger') h.send(h.document, 'pointerdown', { pointerId: 2 });
        if (reason === 'other key') h.send(h.document, 'keydown', { key: ' ' });
        if (reason === 'dispose') h.dispose();
        h.tick(120); h.tick(1000);
        assert.equal(h.steps.length, count + (reason === 'endpoint' ? 1 : 0));
    });
}

test('right-clicks, secondary touches, disabled buttons, and busy sessions never start a hold', t => {
    const h = harness(t);
    h.pointer('pointerdown', { button: 2 });
    h.pointer('pointerdown', { isPrimary: false });
    h.button.disabled = true; h.pointer('pointerdown');
    h.button.disabled = false; h.setBusy(true); h.pointer('pointerdown');
    h.pointer('click'); h.tick(1000);
    assert.deepEqual(h.steps, []);
});

test('year steps follow calendar months, not the number of available records', () => {
    const complete = Array.from({ length: 37 }, (_, month) => ({ month, index: month * 6 }));
    assert.equal(getCalendarStepIndex(complete, 12, 1), 144);
    assert.equal(getCalendarStepIndex(complete, 24, -1), 72);
    const sparse = complete.filter(stop => stop.month === 0 || stop.month >= 12);
    assert.equal(getCalendarStepIndex(sparse, 0, 1), 72);
    assert.equal(getCalendarStepIndex(sparse, 24, -1), 72);
    const gap = complete.filter(stop => stop.month !== 12);
    assert.equal(getCalendarStepIndex(gap, 0, 1), 78);
    assert.equal(getCalendarStepIndex(gap, 24, -1), 66);
    assert.equal(getCalendarStepIndex(complete, 0, -1), 0);
    assert.equal(getCalendarStepIndex(complete, 36, 1), 216);
    assert.equal(getCalendarStepIndex([], 0, 1), 0);
});
