import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDatasetLoader } from '../dataset-loader.mjs';
import { DATASET_CONFIG, parseDatasetData } from '../datasets.mjs';

const valid = '2025 123 130\n';
const response = (text = valid, status = 200) => ({ ok: status === 200, status, text: async () => text });
function deferred() {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
function harness(options = {}) {
    let key = 'temperature', hasData = false;
    const data = [], statuses = [], sources = [], requests = [], localCalls = [];
    const loader = createDatasetLoader({
        getActiveDatasetKey: () => key,
        onData: (...args) => { data.push(args); hasData = true; return true; },
        onStatus: (...args) => statuses.push(args),
        onSource: source => sources.push(source),
        hasData: () => hasData,
        localData: {
            activate: async () => { localCalls.push('activate'); },
            refresh: async () => { localCalls.push('refresh'); },
            importSnapshot: async text => { localCalls.push(['import', text]); }
        },
        ...options,
        fetchData: (url, settings) => {
            requests.push({ url, ...settings });
            return options.fetchData ? options.fetchData(url, settings) : Promise.resolve(response());
        }
    });
    return { loader, data, statuses, sources, requests, localCalls,
        select: next => { key = next; },
        status: () => statuses.at(-1)?.[0] };
}

test('bundled loading passes parsed data and source through one completion callback', async () => {
    const h = harness();
    await h.loader.loadBundled();
    assert.equal(h.requests[0].url, DATASET_CONFIG.temperature.localPath);
    assert.equal(h.requests[0].cache, 'no-store');
    assert.equal(h.requests[0].signal.aborted, false);
    assert.deepEqual(h.data, [[parseDatasetData(valid, 'temperature'), valid, 'Local Data', 'temperature']]);
    assert.deepEqual(h.statuses, [['Loading data...'], ['Local Data', '#2ecc71', 3000]]);
});

test('HTTP failures and invalid bundled data leave the empty viewer ready for manual loading', async () => {
    for (const fetchData of [async () => response('', 404), async () => response('<html>Error</html>'),
        async () => { throw new Error('Offline'); }]) {
        const h = harness({ fetchData });
        await h.loader.loadBundled();
        assert.equal(h.status(), 'Data unavailable');
        assert.equal(h.data.length, 0);
        assert.deepEqual(h.sources, ['Load File / Fetch']);
    }
});

test('a failed reload preserves existing data and its source', async () => {
    let failed = false;
    const h = harness({ fetchData: async () => failed ? response('', 503) : response() });
    await h.loader.loadBundled();
    failed = true;
    await h.loader.loadBundled();
    assert.equal(h.status(), 'Data unavailable');
    assert.equal(h.data.length, 1);
    assert.deepEqual(h.sources, []);
});

test('switching datasets ignores stale responses even if fetch ignores abort', async () => {
    for (const reject of [false, true]) {
        const pending = deferred();
        const h = harness({ fetchData: () => pending.promise });
        const load = h.loader.loadBundled();
        h.select('co2');
        if (reject) pending.reject(new Error('Late failure'));
        else pending.resolve(response());
        await load;
        assert.equal(h.data.length, 0);
        assert.deepEqual(h.statuses, [['Loading data...']]);
        assert.deepEqual(h.sources, []);
    }
});

test('a newer request aborts the old HTTP request and keeps its own completion intact', async () => {
    const pending = deferred();
    let first = true;
    const h = harness({ fetchData: () => { if (first) { first = false; return pending.promise; }
        return Promise.resolve(response('2026 150')); } });
    const older = h.loader.loadBundled();
    await h.loader.loadBundled();
    assert.equal(h.requests[0].signal.aborted, true);
    pending.resolve(response());
    await older;
    assert.equal(h.data.length, 1);
    assert.equal(h.data[0][1], '2026 150');
    assert.equal(h.status(), 'Local Data');
});

test('cancel invalidates a pending request without starting another one', async () => {
    const pending = deferred();
    const h = harness({ fetchData: () => pending.promise });
    const load = h.loader.loadBundled();
    h.loader.cancel();
    assert.equal(h.requests[0].signal.aborted, true);
    pending.resolve(response());
    await load;
    assert.equal(h.data.length, 0);
    assert.deepEqual(h.statuses, [['Loading data...']]);
});

test('remote fetch succeeds directly without trying the proxy', async () => {
    const h = harness();
    await h.loader.fetchLatest();
    assert.equal(h.requests.length, 1);
    assert.equal(h.requests[0].url, DATASET_CONFIG.temperature.remoteUrl);
    assert.equal(h.requests[0].cache, 'no-store');
    assert.equal(h.data[0][2], 'NASA GISS direct');
    assert.equal(h.status(), 'Success!');
});

test('remote HTTP errors and unusable responses retry the encoded source URL through the proxy', async () => {
    for (const badResponse of [response('', 403), response('<html>Error</html>')]) {
        let first = true;
        const h = harness({ fetchData: async () => { if (first) { first = false; return badResponse; }
            return response(); } });
        await h.loader.fetchLatest();
        assert.equal(h.requests.length, 2);
        assert.equal(h.requests[1].url, 'https://corsproxy.io/?' + encodeURIComponent(DATASET_CONFIG.temperature.remoteUrl));
        assert.equal(h.data[0][2], 'NASA GISS via proxy');
        assert.deepEqual(h.statuses.map(status => status[0]), ['Fetching Global Temperature...', 'Trying Proxy...', 'Success!']);
    }
});

test('a direct request timeout still permits the proxy retry', async () => {
    let first = true;
    const h = harness({ timeoutMs: 10, fetchData: (url, { signal }) => {
        if (!first) return Promise.resolve(response());
        first = false;
        return new Promise((resolve, reject) => signal.addEventListener('abort',
            () => reject(signal.reason), { once: true }));
    } });
    await h.loader.fetchLatest();
    assert.equal(h.requests[0].signal.aborted, true);
    assert.equal(h.requests[1].signal.aborted, false);
    assert.equal(h.status(), 'Success!');
});

test('failed direct and proxy requests preserve data and report failure', async () => {
    const h = harness({ fetchData: async () => response('', 500) });
    h.loader.applyText(valid, 'Existing data');
    await h.loader.fetchLatest();
    assert.equal(h.requests.length, 2);
    assert.equal(h.data.length, 1);
    assert.equal(h.status(), 'Fetch Failed');
});

test('cancelled remote requests neither retry nor report a failure', async () => {
    const pending = deferred();
    const h = harness({ fetchData: () => pending.promise });
    const load = h.loader.fetchLatest();
    h.loader.cancel();
    pending.reject(new Error('Aborted'));
    await load;
    assert.equal(h.requests.length, 1);
    assert.deepEqual(h.statuses.map(status => status[0]), ['Fetching Global Temperature...']);
});

test('multi-file remote helpers use the same cancellable no-store transport', async () => {
    const bundle = JSON.parse(await readFile(new URL('../data/sea-ice-north.json', import.meta.url), 'utf8'));
    let index = 0;
    const h = harness({ fetchData: async () => response(bundle.monthlyFiles[index++]) });
    h.select('arctic');
    await h.loader.fetchLatest();
    assert.equal(h.requests.length, 12);
    assert.ok(h.requests.every(request => request.cache === 'no-store' && !request.signal.aborted));
    assert.equal(h.data[0][2], 'NOAA/NSIDC direct');
    assert.deepEqual(h.data[0][0], parseDatasetData(JSON.stringify(bundle), 'arctic'));
});

test('cancelling a multi-file remote helper stops subsequent HTTP requests', async () => {
    const pending = deferred();
    const h = harness({ fetchData: () => pending.promise });
    h.select('arctic');
    const load = h.loader.fetchLatest();
    h.loader.cancel();
    pending.resolve(response());
    await load;
    assert.equal(h.requests.length, 1);
    assert.equal(h.data.length, 0);
});

test('file imports distinguish valid data, invalid data and file read failures', async () => {
    const h = harness();
    await h.loader.loadFile({ text: async () => valid });
    assert.equal(h.data[0][2], 'User File');
    assert.deepEqual(h.statuses.at(-1), ['User File', '#2ecc71', 3000]);
    await h.loader.loadFile({ text: async () => 'not data' });
    assert.equal(h.status(), 'Invalid Data');
    await h.loader.loadFile({ text: async () => { throw new Error('Read error'); } });
    assert.equal(h.status(), 'Read Failed');
    assert.equal(h.data.length, 1);
});

test('a pending file read cannot replace a later import or a different dataset', async () => {
    for (const switchDataset of [false, true]) {
        const pending = deferred();
        const h = harness();
        const older = h.loader.loadFile({ text: () => pending.promise });
        if (switchDataset) h.select('co2');
        else await h.loader.loadFile({ text: async () => '2026 150' });
        pending.resolve(valid);
        await older;
        assert.equal(h.data.length, switchDataset ? 0 : 1);
        if (!switchDataset) assert.equal(h.data[0][1], '2026 150');
    }
});

test('local activation, refresh and import remain delegated to the local-data controller', async () => {
    const h = harness();
    h.select('local');
    await h.loader.loadBundled();
    await h.loader.fetchLatest();
    await h.loader.loadFile({ text: async () => 'snapshot' });
    assert.deepEqual(h.localCalls, ['activate', 'refresh', ['import', 'snapshot']]);
    assert.equal(h.requests.length, 0);
    assert.equal(h.data.length, 0);
    assert.deepEqual(h.statuses, []);
});

test('parser failures are rejected but scene callback errors are not masked', () => {
    const h = harness();
    assert.equal(h.loader.applyText(null, 'Invalid input'), false);
    assert.equal(h.loader.applyText(valid, 'Wrong dataset', 'co2'), false);
    assert.equal(h.data.length, 0);
    const broken = harness({ onData: () => { throw new Error('Scene error'); } });
    assert.throws(() => broken.loader.applyText(valid, 'Valid input'), /Scene error/);
});

test('completion callbacks can start a newer load without older status or cleanup affecting it', async () => {
    const pending = deferred();
    let calls = 0, newer;
    const h = harness({ fetchData: () => ++calls === 1 ? Promise.resolve(response()) : pending.promise,
        onData: () => { if (!newer) newer = h.loader.loadBundled(); return true; } });
    await h.loader.loadBundled();
    assert.equal(h.status(), 'Loading data...');
    pending.resolve(response('2026 150'));
    await newer;
    assert.equal(h.status(), 'Local Data');
});
