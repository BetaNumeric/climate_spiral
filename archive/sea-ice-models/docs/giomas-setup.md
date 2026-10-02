# GIOMAS Sea Ice Volume

Archived implementation notes. These describe the former app integration and workflow, neither of which is active. Run local processing commands from `archive/sea-ice-models`; browser checks require restoring the integration. See [Archive](../README.md).

The app includes separate **Arctic Sea Ice Volume (GIOMAS)** and **Antarctic Sea Ice Volume (GIOMAS)** choices. They use the same units, reference rings, and 0-60 thousand km3 display scale as PIOMAS and ORAS5. The checked-in snapshot covers January 1979 through December 2025. The browser enables both choices after validating the bundle, and both can be selected by the README video rotation.

## Automatic Updates

The [Update GIOMAS sea ice volume](../.github/workflows/update-giomas-data.yml) workflow checks monthly on the 20th at 06:31 UTC and supports **Run workflow**. Push the workflow with the rest of these changes and leave GitHub Actions enabled. No secret, account, or personal token is required: PSC publishes the source files openly. The workflow's `contents: write` permission allows it to commit an updated snapshot.

The first run downloads roughly 60 MB of annual NetCDF archives. Later runs use cached files and conditional HTTP requests (`ETag` and `Last-Modified`) to detect revisions without downloading unchanged files again. Each run validates all releases and publishes only a complete history; a failed download, invalid field, missing year, inconsistent grid, or shorter history leaves the existing snapshot intact.

The provider does not necessarily release data monthly. This updater uses completed annual NetCDF files (`heff.HYYYY.nc.gz`) and excludes the current year. Raw current-year binary files can be written before a month is complete, so their presence is not enough to establish a valid monthly mean. A monthly workflow will discover newly published annual files and revisions, but it cannot make the provider's data more current. At access on 2026-10-02, the newest completed NetCDF release is 2025. [Source archive](https://pscfiles.apl.washington.edu/zhang/Global_seaice/)

## Local Processing

With Python 3.12 or newer:

```sh
python -m pip install -r scripts/requirements-giomas.txt
python -m unittest discover -s tests -p 'test_giomas*.py'
python scripts/update_giomas_data.py
node --test tests/giomas-data.test.mjs
```

The updater writes `data/giomas-sea-ice-volume.json`. Downloaded archives and HTTP validators remain in the ignored `.cache/giomas/` directory, not in git. `--cache PATH` and `--output PATH` override those locations. The snapshot retains each release URL and SHA-256 hash, units, integration method, and a native-grid fingerprint. Unchanged results do not rewrite the file.

Serve the app locally and run `node scripts/check-dataset-framing.cjs` for desktop/mobile checks of the actual published datasets, including equal volume-reference positions and both layouts. Run `node scripts/check-giomas-data.cjs` to check missing/invalid snapshots, refresh, imports, and animation using intercepted responses; those tests never modify the production data. **Fetch Latest** in the browser reloads the published snapshot; processing happens in Python, not on the viewer's device. The service worker caches the bundle for offline use.

## Scientific Method

GIOMAS `heff` is **effective thickness**: ice volume per unit grid-cell area, already accounting for ice concentration. We integrate it once:

```text
cell area (km2) = dxt (km) * dyt (km), where kmt > 0
hemispheric volume (1000 km3) = sum(heff (m) * cell area (km2)) / 1,000,000
```

Cells with scalar latitude at or above zero belong to the north; those below zero belong to the south. Coordinates, grid dimensions, cell-length units, ocean mask, dates, monthly averaging, and thickness values are validated. The grid weights are constant, so summing monthly mean effective thickness preserves monthly mean volume. Applying concentration a second time would incorrectly reduce the result. [Thickness definition, Liao et al. (2022)](https://tc.copernicus.org/articles/16/1807/2022/)

GIOMAS is a model reconstruction with assimilated concentration observations, not a direct volume measurement. Its modeling methods are related to PIOMAS, so agreement between them is not independent confirmation. Native domains, resolution, assimilation, and biases can differ across GIOMAS, PIOMAS, and ORAS5; these series are not calibrated to make their shapes match. [GIOMAS model description](https://psc.apl.washington.edu/zhang/Global_seaice/model.html)

PSC requests citation of Zhang and Rothrock (2003), *Modeling global sea ice with a thickness and enthalpy distribution model in generalized curvilinear coordinates*, Monthly Weather Review, 131(5), 681-697. See [GIOMAS data and attribution](https://psc.apl.uw.edu/data/global-sea-ice-giomas-data-sets/). Additional evaluation: [Liao et al. (2022)](https://doi.org/10.5194/tc-16-1807-2022).
