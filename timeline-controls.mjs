const HOLD_DELAY_MS = 450;
const HOLD_REPEAT_MS = 120;

export function remapTimelinePosition(position, previousStops, nextStops) {
    if (!previousStops.length || !nextStops.length) return 0;
    let ordinal = 0;
    while (ordinal + 1 < previousStops.length && previousStops[ordinal + 1] <= position) ordinal++;
    if (ordinal >= nextStops.length - 1) return nextStops.at(-1);
    const start = previousStops[ordinal];
    const end = previousStops[ordinal + 1] ?? start;
    const fraction = end > start ? Math.max(0, Math.min(1, (position - start) / (end - start))) : 0;
    return nextStops[ordinal] + fraction * (nextStops[ordinal + 1] - nextStops[ordinal]);
}

export function getCalendarStepIndex(stops, currentMonth, direction, months = 12) {
    if (!stops.length) return 0;
    const target = currentMonth + direction * months;
    if (direction > 0) {
        for (const stop of stops) if (stop.month >= target) return stop.index;
        return stops[stops.length - 1].index;
    }
    for (let i = stops.length - 1; i >= 0; i--) if (stops[i].month <= target) return stops[i].index;
    return stops[0].index;
}

export function setupStepButtons({ buttons, step, isBusy, document: ownerDocument = document, window: ownerWindow = window }) {
    let active = null;
    let timer = null;
    let suppressedClick = null;
    const listeners = [];
    const listen = (target, type, handler) => {
        target.addEventListener(type, handler);
        listeners.push([target, type, handler]);
    };
    const stop = () => {
        clearTimeout(timer);
        timer = null;
        active = null;
    };
    const repeat = () => {
        if (!active) return;
        const { button, direction, shift } = active;
        if (ownerDocument.hidden || isBusy() || button.disabled || !button.isConnected
            || !button.getClientRects().length || !step(direction, shift ? 12 : 1)) {
            stop();
            return;
        }
        timer = setTimeout(repeat, HOLD_REPEAT_MS);
    };
    for (const { button, direction } of buttons) {
        listen(button, 'pointerdown', event => {
            if (event.button !== 0 || event.isPrimary === false || button.disabled || isBusy()) return;
            stop();
            suppressedClick = button;
            active = { button, direction, pointerId: event.pointerId, shift: event.shiftKey };
            // Step immediately, then repeat only after a deliberate hold.
            if (!step(direction, event.shiftKey ? 12 : 1)) { stop(); return; }
            if (button.setPointerCapture) button.setPointerCapture(event.pointerId);
            timer = setTimeout(repeat, HOLD_DELAY_MS);
        });
        listen(button, 'click', event => {
            if (suppressedClick === button && (event.detail > 0 || event.pointerType)) {
                suppressedClick = null;
                event.preventDefault();
                return;
            }
            if (!button.disabled && !isBusy()) step(direction, event.shiftKey ? 12 : 1);
        });
        listen(button, 'pointermove', event => {
            if (active?.button !== button || active.pointerId !== event.pointerId) return;
            const bounds = button.getBoundingClientRect();
            if (event.clientX < bounds.left || event.clientX > bounds.right
                || event.clientY < bounds.top || event.clientY > bounds.bottom) stop();
            else active.shift = event.shiftKey;
        });
        listen(button, 'pointerleave', () => { if (active?.button === button) stop(); });
        listen(button, 'lostpointercapture', () => { if (active?.button === button) stop(); });
    }
    const endPointer = event => { if (active?.pointerId === event.pointerId) stop(); };
    listen(ownerDocument, 'pointerup', endPointer);
    listen(ownerDocument, 'pointercancel', endPointer);
    listen(ownerDocument, 'pointerdown', event => {
        if (active && active.pointerId !== event.pointerId) stop();
    });
    listen(ownerDocument, 'visibilitychange', () => { if (ownerDocument.hidden) stop(); });
    listen(ownerWindow, 'blur', stop);
    listen(ownerDocument, 'keydown', event => {
        if (event.key === 'Shift' && active) active.shift = true;
        else stop();
    });
    listen(ownerDocument, 'keyup', event => { if (event.key === 'Shift' && active) active.shift = false; });
    return () => {
        stop();
        listeners.forEach(([target, type, handler]) => target.removeEventListener(type, handler));
    };
}
