import { createLocalTemperatureCache, fetchLocalTemperature, getDeviceLocation, localLocationKey, normalizeLocation,
    parseLocalTemperatureData, readLocalSnapshot, searchLocalPlaces } from './local-temperature-data.mjs';
import { fetchStationCatalog, fetchStationData, nearbyStations, readStationCatalog, readStationSnapshot,
    stationCoverage } from './station-temperature-data.mjs';
import { combineCountryPlaces, fetchCountryCatalog, fetchCountryData, findExactCountry,
    readCountryCatalog, readCountrySnapshot, searchCountries } from './country-temperature-data.mjs';

export function setupLocalTemperature({ isActive, onData, onClear }) {
    const cache = createLocalTemperatureCache();
    const form = document.getElementById('localSearchForm');
    const input = document.getElementById('localSearch');
    const locate = document.getElementById('localLocateBtn');
    const results = document.getElementById('localResults');
    const status = document.getElementById('localStatus');
    const action = document.getElementById('localAction');
    const selected = document.getElementById('localSelected');
    const source = document.getElementById('localSource');
    const sourceRow = source.closest('.local-source');
    const stationFields = document.getElementById('localStationFields');
    const stationSelect = document.getElementById('localStationSelect');
    const stationLabel = document.getElementById('localStationLabel');
    const radius = document.getElementById('localStationRadius');
    const stationDetails = document.getElementById('localStationDetails');
    const countryDetails = document.getElementById('localCountryDetails');
    let generation = 0, controller = null, searchController = null, location = null;
    let locateController = null;
    let countryCode = null;
    let mode = source.value;
    let sourceRestored = false;
    const choiceKey = place => `station-choice:${place.latitude.toFixed(4)}:${place.longitude.toFixed(4)}`;
    const isCurrent = token => token === generation && isActive();

    function updateSourceControls() {
        sourceRow.hidden = mode === 'country';
        stationFields.hidden = mode !== 'station';
        countryDetails.hidden = mode !== 'country' || !countryDetails.textContent;
    }
    function setMode(value) {
        mode = value;
        sourceRestored = true;
        if (value !== 'country') {
            source.value = value;
            void cache.set('local-point-source', value);
        }
        updateSourceControls();
        void cache.set('local-source', value);
    }
    const placeLabel = place => place.name + (place.isCountry ? ' (representative point)' : '');
    const prompt = 'Choose a location.';

    function message(text, retry = false) {
        status.textContent = text;
        action.hidden = !retry && !controller && !locateController;
        action.textContent = controller || locateController ? 'Cancel' : 'Retry';
    }
    function endLocationRequest() {
        locateController?.abort();
        locateController = null;
        locate.disabled = false;
        locate.removeAttribute('aria-busy');
    }
    function cancel() {
        const locating = Boolean(locateController);
        const pending = Boolean(controller || searchController || locating);
        generation++;
        controller?.abort();
        controller = null;
        searchController?.abort();
        searchController = null;
        endLocationRequest();
        results.replaceChildren();
        if (pending) message(locating ? 'Location request cancelled.' : 'Download paused.',
            !locating && (mode === 'country' ? Boolean(countryCode) : Boolean(location)));
    }

    async function countryCatalog(force, token, signal) {
        let saved = await cache.get('country-catalog');
        if (!isCurrent(token)) return null;
        try {
            if (saved) { readCountryCatalog(saved.data); if (!Number.isFinite(saved.checkedAt)) saved = null; }
        } catch { saved = null; }
        let catalog = saved?.data, offline = false;
        if (force || !catalog || Date.now() - saved.checkedAt >= 86400000) {
            try {
                catalog = await fetchCountryCatalog({ signal });
                if (!isCurrent(token)) return null;
                await cache.set('country-catalog', { data: catalog, checkedAt: Date.now() });
            } catch (error) {
                if (signal.aborted || !catalog) throw error;
                offline = true;
            }
        }
        return { catalog, offline };
    }

    async function loadCountry(code, force = false) {
        cancel();
        const changed = mode !== 'country' || countryCode !== code;
        setMode('country');
        if (changed) {
            selected.textContent = '';
            countryDetails.textContent = '';
            onClear();
        }
        countryCode = code;
        const token = generation;
        controller = new AbortController();
        const signal = controller.signal;
        updateSourceControls();
        message('Checking country data...');
        try {
            const result = await countryCatalog(force, token, signal);
            if (!result || !isCurrent(token)) return;
            const country = result.catalog.countries.find(country => country.code === code);
            if (!country) throw new Error('No country average is available for this region. Choose another country.');
            const key = 'country:v1:' + code;
            let saved = await cache.get(key);
            if (!isCurrent(token)) return;
            try {
                if (saved && readCountrySnapshot(saved.data).country.code !== code) saved = null;
            } catch { saved = null; }
            const display = snapshot => {
                onData(snapshot, `CRU-CY ${snapshot.release} / University of East Anglia`);
                selected.textContent = snapshot.location.name;
                countryDetails.textContent = `1901 to ${snapshot.through}; CRU-CY ${snapshot.release}. Area-weighted land average; baseline 1951-1980. Annual releases.`;
                updateSourceControls();
            };
            if (saved) display(readCountrySnapshot(saved.data));
            if (!saved || saved.hash !== country.hash || force) {
                message('Loading country average...');
                const snapshot = await fetchCountryData(country, { signal });
                if (!isCurrent(token)) return;
                await cache.set(key, { data: snapshot, hash: country.hash });
                if (!isCurrent(token)) return;
                display(snapshot);
            }
            await cache.set('last-country', code);
            if (!isCurrent(token)) return;
            controller = null;
            message(result.offline ? 'Using saved country data; catalog update unavailable.'
                : cache.persistent ? 'Saved on this device.' : 'Storage unavailable; saved for this session.', result.offline);
        } catch (error) {
            if (!isCurrent(token)) return;
            controller = null;
            message(error.name === 'TypeError' ? 'Unable to connect. Any loaded data is still available.' : error.message, true);
        }
    }

    async function activateSource() {
        const token = generation;
        if (mode === 'country') {
            const code = countryCode ?? await cache.get('last-country') ?? location?.countryCode;
            if (!isCurrent(token)) return;
            if (code) await loadCountry(code);
            else message(prompt);
        } else if (location) await load(location);
        else message(prompt);
    }
    async function loadStations(force, token, signal, restoreChoice) {
        selected.textContent = placeLabel(location);
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
        if (place.isCountry) {
            if (place.countryCode) return loadCountry(place.countryCode, force);
            onClear();
            message('Search for this country again to load its average.');
            return;
        }
        cancel();
        const changed = mode === 'country' || (location && localLocationKey(location) !== localLocationKey(place));
        setMode(source.value);
        if (changed) {
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
            if (mode === 'station') {
                await loadStations(force, token, signal, restoreChoice);
                return;
            }
            let cached = await cache.get(key);
            if (token !== generation || !isActive()) return;
            try { if (cached) cached = { ...readLocalSnapshot(cached), location }; } catch { cached = null; }
            if (cached && parseLocalTemperatureData(cached).length) {
                onData(cached, 'Saved on this device');
                selected.textContent = placeLabel(cached.location);
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
            selected.textContent = placeLabel(snapshot.location);
            controller = null;
            message(cache.persistent ? 'Saved on this device.' : 'Storage unavailable; saved for this session.');
        } catch (error) {
            if (token !== generation || !isActive()) return;
            controller = null;
            message(error.name === 'TypeError' ? 'Unable to connect. Any loaded data is still available.' : error.message, true);
        }
    }
    source.addEventListener('change', () => {
        cancel();
        setMode(source.value);
        selected.textContent = '';
        stationDetails.textContent = '';
        countryDetails.textContent = '';
        updateSourceControls();
        onClear();
        void activateSource();
    });
    radius.addEventListener('change', () => { if (location && isActive()) void load(location, false, false); });
    stationSelect.addEventListener('change', () => {
        if (!location || !isActive()) return;
        onClear();
        void load(location, false, false);
    });
    locate.addEventListener('click', async () => {
        if (!isActive()) return;
        cancel();
        const token = generation;
        const request = new AbortController();
        locateController = request;
        locate.disabled = true;
        locate.setAttribute('aria-busy', 'true');
        message('Getting your location...');
        try {
            const place = await getDeviceLocation({ signal: request.signal });
            if (locateController !== request || !isCurrent(token)) return;
            input.value = place.name;
            await load(place);
        } catch (error) {
            if (locateController !== request || !isCurrent(token)) return;
            endLocationRequest();
            message(error.message);
        } finally {
            if (locateController === request) endLocationRequest();
        }
    });
    form.addEventListener('submit', async event => {
        event.preventDefault();
        if (!isActive()) return;
        if (locateController) cancel();
        searchController?.abort();
        const request = new AbortController();
        searchController = request;
        results.replaceChildren();
        message('Searching...');
        try {
            const token = generation;
            const query = input.value;
            let catalog = null;
            try { catalog = await countryCatalog(false, token, request.signal); }
            catch (error) { if (request.signal.aborted) throw error; }
            if (searchController !== request || !isCurrent(token)) return;
            const exact = catalog && findExactCountry(catalog.catalog, query);
            let places = [];
            if (!exact) {
                try { places = await searchLocalPlaces(query, { signal: request.signal }); }
                catch (error) {
                    if (request.signal.aborted || !catalog || !searchCountries(catalog.catalog, query).length) throw error;
                }
            }
            if (searchController !== request || !isActive()) return;
            const matches = exact ? [exact] : combineCountryPlaces(catalog?.catalog, query, places);
            results.replaceChildren(...matches.map(place => {
                const item = document.createElement('li');
                const button = document.createElement('button');
                button.type = 'button';
                button.textContent = place.code ? `${place.name} (country average)` : place.name;
                button.addEventListener('click', () => { if (place.code) void loadCountry(place.code); else void load(place); });
                item.append(button);
                return item;
            }));
            message(matches.length ? '' : places.some(place => place.isCountry)
                ? 'No country average is available for this region.' : 'No places found.');
        } catch (error) {
            if (!request.signal.aborted && isActive()) message(error.name === 'TypeError' ? 'Search unavailable. Please try again.' : error.message);
        } finally {
            if (searchController === request) searchController = null;
        }
    });
    input.addEventListener('input', () => {
        if (locateController) cancel();
        searchController?.abort();
        results.replaceChildren();
    });
    input.addEventListener('keydown', event => {
        if (event.key === 'ArrowDown') { results.querySelector('button')?.focus(); event.preventDefault(); }
        if (event.key === 'Escape') {
            if (locateController) cancel();
            searchController?.abort();
            results.replaceChildren();
        }
    });
    action.addEventListener('click', () => {
        if (controller || locateController) cancel();
        else if (mode === 'country' && countryCode) void loadCountry(countryCode, true);
        else if (mode !== 'country' && location) void load(location, true, false);
    });
    return {
        cancel,
        get mode() { return mode; },
        async activate() {
            cancel();
            const token = generation;
            if (!sourceRestored) {
                const savedSource = await cache.get('local-source');
                if (!isCurrent(token)) return;
                const savedPointSource = await cache.get('local-point-source');
                if (!isCurrent(token)) return;
                source.value = savedPointSource === 'station' || (!savedPointSource && savedSource === 'station') ? 'station' : 'era5';
                mode = ['station', 'country'].includes(savedSource) ? savedSource : 'era5';
                if (mode !== 'country') source.value = mode;
                sourceRestored = true;
                updateSourceControls();
                onClear();
            }
            const previous = location ?? await cache.get('last-location');
            if (token !== generation || !isActive()) return;
            if (previous) {
                try { location = normalizeLocation(previous); }
                catch { location = null; }
            }
            await activateSource();
        },
        refresh() {
            if (mode === 'country' && countryCode) return loadCountry(countryCode, true);
            if (mode !== 'country' && location) return load(location, true, false);
            message(prompt);
        },
        async importSnapshot(text) {
            try {
                const data = JSON.parse(text);
                if (data.source === 'CRU-CY') {
                    const snapshot = readCountrySnapshot(text);
                    cancel();
                    setMode('country');
                    countryCode = snapshot.country.code;
                    onData(snapshot, 'Imported CRU-CY country average');
                    selected.textContent = snapshot.location.name;
                    countryDetails.textContent = `CRU-CY ${snapshot.release}; through ${snapshot.through}. Area-weighted land average; baseline 1951-1980.`;
                    updateSourceControls();
                    const token = generation;
                    await cache.set('country:v1:' + countryCode, { data: snapshot, hash: null });
                    await cache.set('last-country', countryCode);
                    if (!isCurrent(token)) return;
                    message('Imported country record.');
                    return;
                }
                if (data.adjustment === 'QCF') {
                    const snapshot = readStationSnapshot(text);
                    cancel();
                    setMode('station');
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
                setMode('era5');
                location = snapshot.location;
                onData(snapshot, 'Imported local data');
                selected.textContent = placeLabel(location);
                const token = generation;
                await cache.set(localLocationKey(location), snapshot);
                await cache.set('last-location', location);
                if (token !== generation || !isActive()) return;
                message(cache.persistent ? 'Saved on this device.' : 'Saved for this session.');
            } catch (error) { message(error.message); }
        },
    };
}
