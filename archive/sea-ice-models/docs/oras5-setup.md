# ORAS5 Sea Ice Volume

Archived implementation notes. These describe the former app integration and workflow, neither of which is active. Run local processing commands from `archive/sea-ice-models`; browser checks require restoring the integration. See [Archive](../README.md).

ORAS5 adds separate **Arctic Sea Ice Volume (ORAS5)** and **Antarctic Sea Ice Volume (ORAS5)** choices. A Python updater downloads monthly ice thickness and concentration, integrates them on the native ocean grid, and writes one small file: `data/oras5-sea-ice-volume.json`. The browser and README video rotation enable both datasets automatically when that file is present and valid. PIOMAS remains a separate dataset.

The first run processes the history from January 1958. This is the expensive part: hundreds of global fields, potentially many gigabytes and hours of download/queue time. Requests are grouped by year, raw downloads are discarded after reduction, and progress is saved after each completed year. Subsequent runs download missing months and revisit the last two published months when extending the series. Nothing new is published until the requested history is complete.

## GitHub Setup

1. Create a free account at the [Copernicus Climate Data Store](https://cds.climate.copernicus.eu/).
2. While logged in, open the [ORAS5 download page](https://cds.climate.copernicus.eu/datasets/reanalysis-oras5?tab=download) and accept its dataset terms. This is required even for API downloads.
3. Open [API setup](https://cds.climate.copernicus.eu/how-to-api) and find your personal access token. This is a Copernicus token, not a GitHub token.
4. In the GitHub repository, open **Settings > Secrets and variables > Actions > New repository secret**. Name it `CDSAPI_KEY` and enter only the token as its value. Keep the token out of code, commits, and chat.
5. Commit and push this implementation. In **Actions > Update ORAS5 sea ice volume**, select **Run workflow**. Leave `max_years` at `0` to process all pending years, or set a small number to split the initial download into batches.
6. If a batch stops before completion, rerun it to resume. A download step times out after 150 minutes; the following cache step saves completed work when possible. Rerun within a week: GitHub may evict inactive caches after seven days. A hard cancellation or lost cache may require repeating unfinished initial work.
7. Once the workflow reports **Published**, it commits the JSON snapshot. After your normal site deployment, reload the app to see both choices. The workflow subsequently checks on the 18th of each month at 06:43 UTC. It skips cleanly when no secret is configured.

The workflow uses the built-in `GITHUB_TOKEN` to commit data; it does not need the README video token or permission to create pull requests. Branch protection may require adapting the commit step. As with the existing data workflow, a commit made by `GITHUB_TOKEN` does not trigger other workflows on `push`; use your existing scheduled/manual deployment if your Pages setup relies on one.

## Local Setup

Use Python 3.12 or newer. From the repository root on Windows:

```powershell
python -m venv .venv-oras5
.\.venv-oras5\Scripts\python.exe -m pip install -r scripts/requirements-oras5.txt
```

Configure `%USERPROFILE%\.cdsapirc` as shown on the CDS API setup page:

```yaml
url: https://cds.climate.copernicus.eu/api
key: <YOUR_COPERNICUS_TOKEN>
```

Alternatively supply the `CDSAPI_KEY` environment variable. Then run:

```powershell
.\.venv-oras5\Scripts\python.exe scripts/update_oras5_data.py
```

On Linux/macOS, use `.venv-oras5/bin/python` instead. The grid and reduced progress live in `.cache/oras5/`, which is ignored by Git. Do not run two updaters concurrently against the same cache/output. To resume, run the same command again. `--max-years 5` limits a run to five yearly requests. `--refresh` revisits the last two published months even when there are no new months. For an intentionally shorter initial series, `--start-year 1979` starts in January 1979; continue using that same start year for later updates. The supplied workflow always uses 1958.

The following checks do not need an API key:

```powershell
.\.venv-oras5\Scripts\python.exe scripts/update_oras5_data.py --dry-run
.\.venv-oras5\Scripts\python.exe scripts/update_oras5_data.py --check-sample
.\.venv-oras5\Scripts\python.exe -m unittest discover -s tests -p 'test_oras5*.py'
node --test tests/oras5-data.test.mjs
```

`--dry-run` checks public catalogue coverage. `--check-sample` downloads the native grid surface fields and a public January 1979 sample from ICDC, then checks the integration. It does **not** publish a partial app dataset. The published CDS history has been processed by the configured workflow, and its totals have been checked locally against independent ICDC files for January 1979 and January/September 1980.

## Scientific Method

For each hemisphere, the updater calculates:

```text
estimated volume (1000 km3) = sum(monthly thickness * monthly concentration * cell area) / 1e12
```

Thickness is metres of ice within the ice-covered portion of a cell. Concentration is its ice-covered fraction, not percent. Cell area uses the native ORCA025 grid's `e1t * e2t` metrics. The surface ocean mask excludes land, and `tmaskutil` excludes duplicated periodic/north-fold cells. Northern and Southern Hemisphere totals are separated by the sign of cell latitude. Grid coordinates must match the downloaded fields; the updater does not mix a regridded product with native cell areas. The grid fingerprint, integration method, source, units, and per-month product are saved with the series.

**These are estimates derived from monthly fields, not exact monthly mean volumes.** The product of mean thickness and mean concentration differs from the mean of their product when thickness and concentration covary within a month. The app does not have daily fields with which to recover that covariance. Source precision and six decimal places in the JSON do not represent uncertainty.

ORAS5 is a model-based reanalysis constrained by observations, not a direct volume measurement. CDS publishes one ensemble member. The updater uses the consolidated product through 2014 and the operational product from 2015; their atmospheric forcing and observation inputs differ. The system paper identifies 1958-1978 as a spin-up/backward extension. Early records are less observationally constrained and deserve particular care when interpreting trends. ORAS5 is kept separate from PIOMAS and GIOMAS, without splicing or calibrating their totals together. All volume datasets share the same display scale, zero at the center and a 0-60 thousand km3 radius and color range. This covers the published Arctic ORAS5 peak of 50.789613 thousand km3 in April 1968; equal volume reference values therefore have equal radii. Enclosed spiral area is not proportional to volume.

Source metadata, coordinates, units, field pairs, monthly continuity, and numerical ranges are checked. Missing ocean concentration or thickness where ice is present causes a failure, rather than being treated as zero. An incomplete or shorter update cannot replace the existing snapshot. **Fetch Latest** in the app refreshes the published JSON, not the authenticated gridded source.

## Sources

- [ECMWF/Copernicus ORAS5 catalogue](https://cds.climate.copernicus.eu/datasets/reanalysis-oras5), [dataset DOI](https://doi.org/10.24381/cds.67e8eeb7), CC-BY-4.0. Operational data are normally updated monthly on the 15th. Catalogue checked 2026-10-02: January 1958 through August 2026.
- Zuo et al. (2019), [The ECMWF operational ensemble reanalysis-analysis system for ocean and sea ice](https://doi.org/10.5194/os-15-779-2019).
- [University of Hamburg ICDC ORAS5 archive](https://www.cen.uni-hamburg.de/icdc/data/ocean/easy-init-ocean/ecmwf-oras5.html) and [native grid file](https://icdc.cen.uni-hamburg.de/thredds/catalog/ftpthredds/EASYInit/oras5/ORCA025/mesh/catalog.html). The grid is retrieved through OPeNDAP so unused depth fields are not downloaded. The historical ICDC sample validates processing only; production ice fields come from CDS.
