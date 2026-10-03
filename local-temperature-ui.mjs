import { createLocalTemperatureCache, fetchLocalTemperature, localLocationKey, normalizeLocation,
    parseLocalTemperatureData, readLocalSnapshot, searchLocalPlaces } from './local-temperature-data.mjs';
import { fetchStationCatalog, fetchStationData, nearbyStations, readStationCatalog, readStationSnapshot,
    stationCoverage } from './station-temperature-data.mjs';

export function setupLocalTemperature({ isActive, onData, onClear }) {
    const cache = createLocalTemperatureCache();
    const form = document.getElementById('localSearchForm');
    const input = document.getElementById('localSearch');
    const results = document.getElementById('localResults');
    const status = document.getElementById('localStatus');
    const action = document.getElementById('localAction');
    const selected = document.getElementById('localSelected');
    const source = document.getElementById('localSource');
    const stationFields = document.getElementById('localStationFields');
    const stationSelect = document.getElementById('localStationSelect');
    const stationLabel = document.getElementById('localStationLabel');
    const radius = document.getElementById('localStationRadius');
    const stationDetails = document.getElementById('localStationDetails');
    let generation = 0, controller = null, searchController = null, location = null;
    let sourceRestored = false;
    const choiceKey = place => `station-choice:${place.latitude.toFixed(4)}:${place.longitude.toFixed(4)}`;
    const isCurrent = token => token === generation && isActive();

    function updateSourceControls() {
        stationFields.hidden = source.value !== 'station';
    }

    function message(text, retry = false) {
        status.textContent = text;
        action.hidden = !retry && !controller;
        action.textContent = controller ? 'Cancel' : 'Retry';
    }
    function cancel() {
        const pending = Boolean(controller || searchController);
        generation++;
        controller?.abort();
        controller = null;
        searchController?.abort();
        searchController = null;
        results.replaceChildren();
        if (pending) message(location ? 'Download paused.' : 'Choose a location.', Boolean(location));
    }
    async function loadStations(force, token, signal, restoreChoice) {
        selected.textContent = location.name;
        let savedCatalog = await cache.get('station-catalog');
        if (!isCurrent(token)) return;
        try {
            if (savedCatalog) {
                readStationCatalog(savedCatalog.data);
                if (!Number.isFinite(savedCatalog.checkedAt)) savedCatalog = null;
            }
        } catch { savedCatalog = null; }
        let catalog = savedCatalog?.data;
        let offlineCatalog = false;
        if (force || !catalog || Date.now() - savedCatalog.checkedAt >= 86400000) {
            message('Checking nearby stations...');
            try {
                catalog = await fetchStationCatalog({ signal });
                if (!isCurrent(token)) return;
                await cache.set('station-catalog', { data: catalog, checkedAt: Date.now() });
            } catch (error) {
                if (signal.aborted || !catalog) throw error;
                offlineCatalog = true;
            }
        }
        if (!isCurrent(token)) return;
        const choice = restoreChoice ? await cache.get(choiceKey(location)) : { id: stationSelect.value, radius: Number(radius.value) };
        if (!isCurrent(token)) return;
        if (restoreChoice) radius.value = [50, 100, 250, 500].includes(choice?.radius) ? String(choice.radius) : '100';
        const stations = nearbyStations(catalog, location, Number(radius.value));
        const previousStation = stationSelect.value;
        stationSelect.replaceChildren(...stations.map(station => {
            const option = document.createElement('option');
            option.value = station.id;
            option.textContent = `${station.name.replaceAll('_', ' ')} (${Math.round(station.distance)} km)`;
            return option;
        }));
        stationSelect.disabled = !stations.length;
        stationSelect.title = '';
        stationLabel.textContent = 'Station';
        if (!stations.length) {
            onClear();
            stationDetails.textContent = '';
            controller = null;
            message(`No station within ${radius.value} km has a complete 1951-1980 baseline.`);
            return;
        }
        const station = stations.find(station => station.id === choice?.id) ?? stations[0];
        if (previousStation !== station.id) { onClear(); stationDetails.textContent = ''; }
        stationSelect.value = station.id;
        stationSelect.title = station.name.replaceAll('_', ' ') + ' - ' + station.id;
        stationLabel.textContent = station.id === stations[0].id ? 'Station (recommended)' : 'Station';
        const key = 'station:v1:' + station.id;
        let saved = await cache.get(key);
        if (!isCurrent(token)) return;
        try { if (saved) readStationSnapshot(saved.data); } catch { saved = null; }
        const display = (snapshot, label) => {
            const coverage = stationCoverage(snapshot.records);
            onData(snapshot, label);
            const elevation = snapshot.station.elevation === null ? '' : `; ${snapshot.station.elevation} m elevation`;
            stationDetails.textContent = `${snapshot.station.id} - ${Math.round(station.distance)} km${elevation}\n`
                + `${coverage.first} to ${coverage.last}; ${coverage.coverage}% complete\nAdjusted observations; baseline 1951-1980.`;
        };
        await cache.set(choiceKey(location), { id: station.id, radius: Number(radius.value) });
        if (!isCurrent(token)) return;
        if (saved) display(readStationSnapshot(saved.data), 'Saved NOAA station observations');
        if (!saved || saved.hash !== station.hash || force) {
            message('Loading station observations...');
            const snapshot = await fetchStationData(station, { signal });
            if (!isCurrent(token)) return;
            await cache.set(key, { data: snapshot, hash: station.hash });
            if (!isCurrent(token)) return;
            display(snapshot, 'NOAA GHCN-Monthly v4 (adjusted)');
        }
        controller = null;
        message(offlineCatalog ? 'Using saved station data; catalog update unavailable.'
            : cache.persistent ? 'Saved on this device.' : 'Storage unavailable; saved for this session.', offlineCatalog);
    }

    async function load(place, force = false, restoreChoice = true) {
        cancel();
        if (location && localLocationKey(location) !== localLocationKey(place)) {
            onClear();
            stationSelect.replaceChildren();
            stationDetails.textContent = '';
            selected.textContent = '';
        }
        location = normalizeLocation(place);
        const token = generation;
        controller = new AbortController();
        const signal = controller.signal;
        message('Checking saved history...');
        const key = localLocationKey(location);
        try {
            await cache.set('last-location', location);
            if (!isCurrent(token)) return;
            if (source.value === 'station') {
                await loadStations(force, token, signal, restoreChoice);
                return;
            }
            let cached = await cache.get(key);
            if (token !== generation || !isActive()) return;
            try { if (cached) cached = readLocalSnapshot(cached); } catch { cached = null; }
            if (cached && parseLocalTemperatureData(cached).length) {
                onData(cached, 'Saved on this device');
                selected.textContent = cached.location.name;
            }
            const snapshot = await fetchLocalTemperature(location, { cached, force, signal,
                onProgress: progress => {
                    if (token !== generation || !isActive() || progress.fraction === 1) return;
                    message(`Loading ${progress.start.slice(0, 4)}-${progress.end.slice(0, 4)} (${Math.round(progress.fraction * 100)}%)`);
                },
                onCheckpoint: snapshot => cache.set(key, snapshot),
            });
            if (token !== generation || !isActive()) return;
            if (!cached || snapshot.fetchedAt !== cached.fetchedAt) onData(snapshot, 'Open-Meteo / ERA5-Land');
            selected.textContent = snapshot.location.name;
            controller = null;
            message(cache.persistent ? 'Saved on this device.' : 'Storage unavailable; saved for this session.');
        } catch (error) {
            if (token !== generation || !isActive()) return;
            controller = null;
            message(error.name === 'TypeError' ? 'Unable to connect. Any loaded data is still available.' : error.message, true);
        }
    }
    source.addEventListener('change', () => {
        sourceRestored = true;
        cancel();
        updateSourceControls();
        selected.textContent = '';
        stationDetails.textContent = '';
        onClear();
        void cache.set('local-source', source.value);
        if (location) void load(location);
        else message('Choose a location.');
    });
    radius.addEventListener('change', () => { if (location && isActive()) void load(location, false, false); });
    stationSelect.addEventListener('change', () => {
        if (!location || !isActive()) return;
        onClear();
        void load(location, false, false);
    });
    form.addEventListener('submit', async event => {
        event.preventDefault();
        if (!isActive()) return;
        searchController?.abort();
        const request = new AbortController();
        searchController = request;
        results.replaceChildren();
        message('Searching...');
        try {
            const places = await searchLocalPlaces(input.value, { signal: request.signal });
            if (searchController !== request || !isActive()) return;
            results.replaceChildren(...places.map(place => {
                const item = document.createElement('li');
                const button = document.createElement('button');
                button.type = 'button';
                button.textContent = place.name;
                button.addEventListener('click', () => { void load(place); });
                item.append(button);
                return item;
            }));
            message(places.length ? '' : 'No places found.');
        } catch (error) {
            if (!request.signal.aborted && isActive()) message(error.name === 'TypeError' ? 'Search unavailable. Please try again.' : error.message);
        } finally {
            if (searchController === request) searchController = null;
        }
    });
    input.addEventListener('input', () => { searchController?.abort(); results.replaceChildren(); });
    input.addEventListener('keydown', event => {
        if (event.key === 'ArrowDown') { results.querySelector('button')?.focus(); event.preventDefault(); }
        if (event.key === 'Escape') { searchController?.abort(); results.replaceChildren(); }
    });
    action.addEventListener('click', () => { if (controller) cancel(); else if (location) void load(location, true, false); });
    return {
        cancel,
        async activate() {
            cancel();
            const token = generation;
            if (!sourceRestored) {
                const savedSource = await cache.get('local-source');
                if (!isCurrent(token)) return;
                source.value = savedSource === 'station' ? 'station' : 'era5';
                sourceRestored = true;
                updateSourceControls();
                onClear();
            }
            const previous = location ?? await cache.get('last-location');
            if (token !== generation || !isActive()) return;
            if (previous) {
                try { await load(normalizeLocation(previous)); }
                catch { message('Choose a location.'); }
            } else message('Choose a location.');
        },
        refresh() { if (location) return load(location, true, false); message('Choose a location.'); },
        async importSnapshot(text) {
            try {
                if (source.value === 'station') {
                    const snapshot = readStationSnapshot(text);
                    cancel();
                    onData(snapshot, 'Imported NOAA station observations');
                    selected.textContent = snapshot.station.name.replaceAll('_', ' ');
                    stationSelect.replaceChildren();
                    stationSelect.disabled = true;
                    stationSelect.title = '';
                    stationLabel.textContent = 'Station';
                    stationDetails.textContent = 'Imported station record; baseline 1951-1980.';
                    message('Imported station record.');
                    return;
                }
                const snapshot = readLocalSnapshot(text);
                if (!parseLocalTemperatureData(snapshot).length) throw new Error('The 1951-1980 reference period is incomplete.');
                cancel();
                location = snapshot.location;
                onData(snapshot, 'Imported local data');
                selected.textContent = location.name;
                const token = generation;
                await cache.set(localLocationKey(location), snapshot);
                await cache.set('last-location', location);
                if (token !== generation || !isActive()) return;
                message(cache.persistent ? 'Saved on this device.' : 'Saved for this session.');
            } catch (error) { message(error.message); }
        },
    };
}
