import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const root = new URL('../', import.meta.url);

test('archived sea ice models are absent from the app, cache, docs and active workflows', async () => {
    const workflows = await readdir(new URL('.github/workflows/', root));
    assert(!workflows.some(name => /oras5|giomas/i.test(name)));
    for (const file of ['index.html', 'service-worker.js', 'scripts/readme-video.mjs',
        'README.md', 'docs/data-methods.md', 'docs/maintenance.md',
        ...workflows.map(name => '.github/workflows/' + name)]) {
        assert.doesNotMatch(await readFile(new URL(file, root), 'utf8'), /oras5|giomas/i, file);
    }
});

test('service worker caches the retained datasets and clears the previous app cache', async () => {
    const listeners = new Map();
    const stores = new Map([['climate-spiral-v35', new Map()], ['another-app', new Map()]]);
    const requests = [];
    let claimed = false;
    const origin = 'https://example.com/climate_spiral/';
    runInNewContext(await readFile(new URL('service-worker.js', root), 'utf8'), {
        URL, Request,
        self: {
            location: origin,
            addEventListener: (type, handler) => listeners.set(type, handler),
            skipWaiting: async () => {},
            clients: { claim: async () => { claimed = true; } },
        },
        fetch: async request => { requests.push(request.url); return { ok: true }; },
        caches: {
            open: async name => {
                if (!stores.has(name)) stores.set(name, new Map());
                return { put: async (request, response) => stores.get(name).set(request.url, response) };
            },
            keys: async () => [...stores.keys()],
            delete: async name => stores.delete(name),
        },
    });
    const dispatch = async type => {
        let completion;
        listeners.get(type)({ waitUntil: promise => { completion = promise; } });
        await completion;
    };
    await dispatch('install');
    assert.equal(requests.filter(url => url.startsWith(origin + 'data/')).length, 9);
    assert(requests.includes(origin + 'data/piomas-monthly.txt'));
    assert(requests.includes(origin + 'data/sea-ice-north.json'));
    assert(requests.includes(origin + 'data/sea-ice-south.json'));
    assert(requests.every(url => !/oras5|giomas|\/archive\//i.test(url)));
    await dispatch('activate');
    assert(!stores.has('climate-spiral-v35'));
    assert(stores.has('another-app'));
    assert.equal(stores.size, 2);
    assert(claimed);
});

test('archived code, snapshots, tests and workflow templates are retained outside active paths', async () => {
    for (const model of ['oras5', 'giomas']) {
        for (const file of [`${model}-data.mjs`, `data/${model}-sea-ice-volume.json`,
            `scripts/update_${model}_data.py`, `scripts/requirements-${model}.txt`,
            `scripts/check-${model}-data.cjs`, `tests/${model}-data.test.mjs`,
            `tests/test_${model}_data.py`, `docs/${model}-setup.md`,
            `.github/workflows/update-${model}-data.yml`]) {
            await assert.rejects(access(new URL(file, root)), { code: 'ENOENT' });
            await access(new URL('archive/sea-ice-models/' + file, root));
        }
    }
});
