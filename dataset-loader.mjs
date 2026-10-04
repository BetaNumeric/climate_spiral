import { getDatasetByKey, hasUsableData, parseDatasetData } from './datasets.mjs';

const SUCCESS_COLOR = '#2ecc71';
const ERROR_COLOR = '#e74c3c';

export function createDatasetLoader({
    getActiveDatasetKey, onData, onStatus, onSource, hasData, localData,
    fetchData = fetch, timeoutMs = 30000
}) {
    let activeRequest = null;

    function cancel() {
        activeRequest?.controller.abort();
        activeRequest = null;
    }

    function begin() {
        cancel();
        activeRequest = { key: getActiveDatasetKey(), controller: new AbortController() };
        return activeRequest;
    }

    function isCurrent(request) {
        return activeRequest === request && request.key === getActiveDatasetKey()
            && !request.controller.signal.aborted;
    }

    function finish(request) {
        if (activeRequest === request) activeRequest = null;
    }

    function applyText(text, source, key = getActiveDatasetKey()) {
        if (key !== getActiveDatasetKey()) return false;
        let data;
        try { data = parseDatasetData(text, key); }
        catch { return false; }
        if (!hasUsableData(data)) return false;
        return onData(data, text, source, key);
    }

    async function fetchText(url, request, timed = false) {
        request.controller.signal.throwIfAborted();
        const controller = new AbortController();
        const abort = () => controller.abort(request.controller.signal.reason);
        request.controller.signal.addEventListener('abort', abort, { once: true });
        // A timeout belongs to one HTTP request, not the session: the proxy can still retry.
        const timer = timed ? setTimeout(() => controller.abort(), timeoutMs) : null;
        try {
            const response = await fetchData(url, { cache: 'no-store', signal: controller.signal });
            if (!response.ok) throw new Error('Fetch failed: ' + response.status);
            const text = await response.text();
            controller.signal.throwIfAborted();
            return text;
        } finally {
            clearTimeout(timer);
            request.controller.signal.removeEventListener('abort', abort);
        }
    }

    async function loadBundled() {
        const request = begin();
        try {
            if (request.key === 'local') return await localData.activate();
            onStatus('Loading data...');
            const dataset = getDatasetByKey(request.key);
            const text = await fetchText(dataset.localPath, request);
            if (!isCurrent(request)) return;
            if (!applyText(text, 'Local Data', request.key)) throw new Error('No usable records');
            if (isCurrent(request)) onStatus('Local Data', SUCCESS_COLOR, 3000);
        } catch {
            if (!isCurrent(request)) return;
            onStatus('Data unavailable', ERROR_COLOR);
            if (!hasData()) onSource('Load File / Fetch');
        } finally {
            finish(request);
        }
    }

    async function fetchLatest() {
        const request = begin();
        try {
            if (request.key === 'local') return await localData.refresh();
            const dataset = getDatasetByKey(request.key);
            onStatus('Fetching ' + dataset.title + '...');
            const directUrl = typeof dataset.remoteUrl === 'function' ? dataset.remoteUrl() : dataset.remoteUrl;
            for (const proxy of [false, true]) {
                try {
                    const fetchSource = url => fetchText(
                        proxy ? 'https://corsproxy.io/?' + encodeURIComponent(url) : url, request, true);
                    const text = await (dataset.fetchRemote ? dataset.fetchRemote(fetchSource) : fetchSource(directUrl));
                    if (!isCurrent(request)) return;
                    const source = dataset.sourceLabel + (proxy ? ' via proxy' : ' direct');
                    if (!applyText(text, source, request.key)) throw new Error('No usable records');
                    if (isCurrent(request)) onStatus('Success!', SUCCESS_COLOR, 3000);
                    return;
                } catch {
                    if (!isCurrent(request)) return;
                    onStatus(proxy ? 'Fetch Failed' : 'Trying Proxy...', proxy ? ERROR_COLOR : undefined);
                }
            }
        } finally {
            finish(request);
        }
    }

    async function loadFile(file) {
        const request = begin();
        try {
            let text;
            try { text = await file.text(); }
            catch {
                if (isCurrent(request)) onStatus('Read Failed', ERROR_COLOR);
                return;
            }
            if (!isCurrent(request)) return;
            if (request.key === 'local') return await localData.importSnapshot(text);
            const applied = applyText(text, 'User File', request.key);
            if (isCurrent(request)) onStatus(applied ? 'User File' : 'Invalid Data',
                applied ? SUCCESS_COLOR : ERROR_COLOR, applied ? 3000 : 0);
        } finally {
            finish(request);
        }
    }

    return { applyText, loadBundled, fetchLatest, loadFile, cancel };
}
