import test from 'node:test';
import assert from 'node:assert/strict';
import { setupKeyboardShortcuts } from '../keyboard-shortcuts.mjs';

const bindings = { Enter: 'toggleLayout', ' ': 'togglePlayback', ',': 'stepBack', '.': 'stepForward',
    Home: 'skipStart', End: 'skipEnd', s: 'toggleSettings', i: 'toggleInfo' };

function harness() {
    const target = new EventTarget();
    const calls = [];
    const steps = [];
    let control = false, busy = false, hasData = true, panelOpen = true;
    target.closest = selector => control && (control !== 'button' || selector.includes('button')) ? {} : null;
    const actions = Object.fromEntries(Object.values(bindings).map(action => [action, () => calls.push(action)]));
    for (const action of ['stepBack', 'stepForward']) actions[action] = months => { calls.push(action); steps.push(months); };
    actions.closePanels = () => { calls.push('closePanels'); return panelOpen; };
    const dispose = setupKeyboardShortcuts({ target, actions, isBusy: () => busy, hasData: () => hasData });
    return {
        calls, steps, dispose,
        setControl(value) { control = value; },
        setBusy(value) { busy = value; },
        setData(value) { hasData = value; },
        setPanelOpen(value) { panelOpen = value; },
        key(key, extra = {}, prevented = false) {
            const event = new Event('keydown', { cancelable: true });
            Object.assign(event, { key, ...extra });
            if (prevented) event.preventDefault();
            target.dispatchEvent(event);
            return event.defaultPrevented;
        }
    };
}

test('each shortcut dispatches its action once and prevents browser scrolling or activation', () => {
    const h = harness();
    for (const [key, action] of Object.entries(bindings)) {
        assert.equal(h.key(key), true);
        assert.equal(h.calls.pop(), action);
        assert.deepEqual(h.calls, []);
    }
});

test('panel shortcuts work with Caps Lock without requiring Shift', () => {
    const h = harness();
    h.key('S'); h.key('I');
    assert.deepEqual(h.calls, ['toggleSettings', 'toggleInfo']);
});

test('typing, sliders, and other focused input controls retain native behavior', () => {
    const h = harness();
    h.setControl(true);
    for (const key of Object.keys(bindings)) assert.equal(h.key(key), false);
    assert.deepEqual(h.calls, []);
});

test('focused buttons retain Enter/Space while still allowing panel and timeline shortcuts', () => {
    const h = harness();
    h.setControl('button');
    assert.equal(h.key('Enter'), false);
    assert.equal(h.key(' '), false);
    assert.deepEqual(h.calls, []);
    for (const key of ['s', 'i', ',', '.', 'Home', 'End']) assert.equal(h.key(key), true);
    assert.deepEqual(h.calls, ['toggleSettings', 'toggleInfo', 'stepBack', 'stepForward', 'skipStart', 'skipEnd']);
});

test('composition, modifiers, AltGr, and already handled events are ignored; repeat/Shift are reserved for stepping', () => {
    const h = harness();
    for (const key of [...Object.keys(bindings), 'Escape']) {
        for (const flag of ['repeat', 'isComposing', 'ctrlKey', 'altKey', 'metaKey', 'shiftKey']) {
            if ((key === ',' || key === '.') && (flag === 'repeat' || flag === 'shiftKey')) continue;
            assert.equal(h.key(key, { [flag]: true }), false);
        }
        assert.equal(h.key(key, { getModifierState: modifier => modifier === 'AltGraph' }), false);
        assert.equal(h.key(key, {}, true), true);
    }
    assert.deepEqual(h.calls, []);
});

test('held month shortcuts accept native key repeats and Shift uses twelve calendar months', () => {
    const h = harness();
    for (const key of [',', '.']) {
        assert.equal(h.key(key), true);
        assert.equal(h.key(key, { repeat: true }), true);
        assert.equal(h.key(key, { shiftKey: true, repeat: true }), true);
    }
    assert.deepEqual(h.calls, ['stepBack', 'stepBack', 'stepBack', 'stepForward', 'stepForward', 'stepForward']);
    assert.deepEqual(h.steps, [1, 1, 12, 1, 1, 12]);
});

test('Shift stepping recognizes US and German shifted punctuation through the physical comma/period keys', () => {
    const h = harness();
    for (const [key, code] of [['<', 'Comma'], [';', 'Comma'], ['>', 'Period'], [':', 'Period']]) {
        assert.equal(h.key(key, { shiftKey: true, code }), true);
    }
    assert.deepEqual(h.calls, ['stepBack', 'stepBack', 'stepForward', 'stepForward']);
    assert.deepEqual(h.steps, [12, 12, 12, 12]);
    h.setControl(true);
    assert.equal(h.key(':', { shiftKey: true, code: 'Period', repeat: true }), false);
});

test('Escape closes a panel from a focused input even during recording, but leaves unhandled Escape alone', () => {
    const h = harness();
    h.setControl(true); h.setBusy(true);
    assert.equal(h.key('Escape'), true);
    assert.deepEqual(h.calls, ['closePanels']);
    h.setPanelOpen(false);
    assert.equal(h.key('Escape'), false);
});

test('preview and recording locks block playback, layout, and opening panels', () => {
    const h = harness();
    h.setBusy(true);
    for (const key of Object.keys(bindings)) assert.equal(h.key(key), false);
    assert.deepEqual(h.calls, []);
});

test('an empty dataset blocks playback actions but still permits layouts and panels', () => {
    const h = harness();
    h.setData(false);
    for (const key of [' ', ',', '.', 'Home', 'End']) assert.equal(h.key(key), false);
    assert.deepEqual(h.calls, []);
    for (const key of ['Enter', 's', 'i']) assert.equal(h.key(key), true);
    assert.deepEqual(h.calls, ['toggleLayout', 'toggleSettings', 'toggleInfo']);
});

test('camera keys and unknown keys remain untouched and the listener can be removed', () => {
    const h = harness();
    for (const key of ['1', '2', '3', '4', '5', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'F1', '__proto__']) {
        assert.equal(h.key(key), false);
    }
    h.dispose();
    assert.equal(h.key('Enter'), false);
    assert.deepEqual(h.calls, []);
});
