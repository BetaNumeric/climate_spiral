const SHORTCUTS = {
    Enter: 'toggleLayout',
    ' ': 'togglePlayback',
    ',': 'stepBack',
    '.': 'stepForward',
    Home: 'skipStart',
    End: 'skipEnd',
    s: 'toggleSettings',
    i: 'toggleInfo'
};
const PLAYBACK_ACTIONS = new Set(['togglePlayback', 'stepBack', 'stepForward', 'skipStart', 'skipEnd']);
const CONTROL_SELECTOR = 'input, textarea, select, '
    + '[contenteditable]:not([contenteditable="false"]), [role="textbox"], '
    + '[role="slider"], [role="checkbox"], [role="switch"], [role="combobox"], [role="listbox"], [role="menuitem"]';
const ACTIVATION_SELECTOR = 'button, a[href], summary, [role="button"], [role="link"]';

export function setupKeyboardShortcuts({ target = document, actions, isBusy, hasData }) {
    const onKeyDown = event => {
        const stepKey = event.key === ',' || event.key === '.'
            || (event.shiftKey && (event.code === 'Comma' || event.code === 'Period'));
        if (event.defaultPrevented || event.isComposing
            || event.ctrlKey || event.altKey || event.metaKey
            || ((event.repeat || event.shiftKey) && !stepKey)
            || event.getModifierState?.('AltGraph')) return;

        // Escape can dismiss a panel even while its search field has focus.
        if (event.key === 'Escape') {
            if (actions.closePanels()) event.preventDefault();
            return;
        }
        if (event.target.closest?.(CONTROL_SELECTOR) || isBusy()) return;
        if (stepKey) {
            if (!hasData()) return;
            const backwards = event.key === ',' || (event.shiftKey && event.code === 'Comma');
            event.preventDefault();
            actions[backwards ? 'stepBack' : 'stepForward'](event.shiftKey ? 12 : 1);
            return;
        }
        if ((event.key === 'Enter' || event.key === ' ') && event.target.closest?.(ACTIVATION_SELECTOR)) return;
        const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
        if (!Object.hasOwn(SHORTCUTS, key)) return;
        const action = SHORTCUTS[key];
        if (PLAYBACK_ACTIONS.has(action) && !hasData()) return;
        event.preventDefault();
        actions[action]();
    };
    target.addEventListener('keydown', onKeyDown);
    return () => target.removeEventListener('keydown', onKeyDown);
}
