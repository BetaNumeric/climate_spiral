# Former Browser Integration

Historical snippets only; these are not loaded by the app. The registrations below used the active PIOMAS volume scale. Restoring them also requires snapshot refresh/reuse handling in `fetchData` and `loadLocalData`, registering the optional choices in `setupUI`, restoring cache assets, and adjusting module/data paths.

## Imports

```js
import { ORAS5_DATA_PATH, ORAS5_SOURCE_URL, parseOras5VolumeData } from './oras5-data.mjs';
        import { GIOMAS_DATA_PATH, GIOMAS_SOURCE_URL, parseGiomasVolumeData } from './giomas-data.mjs';
```

## Dataset Registrations

Insert these entries in `DATASET_CONFIG` when deliberately restoring the datasets:

```js
            ...Object.fromEntries([
                ['arcticgiomas', 'Arctic', 'north'],
                ['antarcticgiomas', 'Antarctic', 'south']
            ].map(([id, region, hemisphere]) => [id, {
                id,
                title: `${region} Sea Ice Volume (GIOMAS)`,
                metricLabel: "Volume (10\u00b3 km\u00b3)",
                localPath: GIOMAS_DATA_PATH,
                sourceLabel: "GIOMAS / Polar Science Center",
                sourceHref: GIOMAS_SOURCE_URL,
                requiresSnapshot: true,
                supportsInterpolation: false,
                preserveMonthlyGaps: true,
                kind: "sea-ice",
                seaIceScale: SEA_ICE_VOLUME_SCALE,
                fileExtension: ".json",
                parse: text => parseGiomasVolumeData(text, hemisphere),
                description: `${region} monthly mean sea ice volume since January 1979, in thousands of km\u00b3. Calculated from GIOMAS effective thickness and native grid-cell areas. A model-based reconstruction, not a direct measurement. Uses completed annual releases, so recent months may not yet be available. GIOMAS and PIOMAS share related modeling methods. Source: Polar Science Center / University of Washington.`
            }])),
            ...Object.fromEntries([
                ['arcticoras5', 'Arctic', 'north'],
                ['antarcticoras5', 'Antarctic', 'south']
            ].map(([id, region, hemisphere]) => [id, {
                id,
                title: `${region} Sea Ice Volume (ORAS5)`,
                metricLabel: "Volume (10\u00b3 km\u00b3)",
                localPath: ORAS5_DATA_PATH,
                sourceLabel: "ECMWF / Copernicus ORAS5",
                sourceHref: ORAS5_SOURCE_URL,
                requiresSnapshot: true,
                supportsInterpolation: false,
                preserveMonthlyGaps: true,
                kind: "sea-ice",
                seaIceScale: SEA_ICE_VOLUME_SCALE,
                fileExtension: ".json",
                parse: text => parseOras5VolumeData(text, hemisphere),
                description: `${region} sea ice volume estimated from ORAS5 monthly mean thickness and ice concentration on the native ocean grid, in thousands of km\u00b3. A model-based estimate, not a direct measurement or an exact monthly mean volume. Atmospheric forcing changes in 2015. Source: ECMWF / Copernicus Climate Change Service.`
            }])),
```

## Optional Snapshot Loader

`setupUI` originally added non-optional choices first, then called this loader:

```js
        async function enableOptionalDatasets(select) {
            const optional = Object.values(DATASET_CONFIG).filter(dataset => dataset.requiresSnapshot);
            const paths = [...new Set(optional.map(dataset => dataset.localPath))];
            await Promise.all(paths.map(async path => {
                try {
                    const response = await fetch(path, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
                    if (response.status === 404) return; // Not published until the first complete download.
                    if (!response.ok) throw new Error('Snapshot request failed');
                    const text = await response.text();
                    const datasets = optional.filter(dataset => dataset.localPath === path);
                    if (datasets.some(dataset => !dataset.parse(text).length)) throw new Error('Invalid snapshot');
                    datasets.forEach(dataset => {
                        dataset.snapshotText = text;
                        select.add(new Option(dataset.title, dataset.id));
                    });
                } catch (error) {
                    console.warn('Optional datasets unavailable: ' + path, error);
                }
            }));
        }
```
