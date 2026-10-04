# Archived ENSO Dataset

This dataset uses NOAA CPC's [monthly relative Nino 3.4 index](https://www.cpc.ncep.noaa.gov/data/indices/Rnino34.ascii.txt), based on ERSSTv6 and relative to 1991-2020, with tropical-wide warming removed. It is not the three-month ONI/RONI or an official event classification. Recent values may be revised.

The dataset was removed from the app because the alternating values were less useful in the spiral view. Its parser, last snapshot, updater, tests, and [former browser integration](browser-integration.md) remain here. Nothing in this archive is imported, cached, or updated by the active app and workflows.

## Optional Checks

From the repository root:

```sh
node --test archive/enso/tests/*.test.mjs
node archive/enso/scripts/update-enso-data.mjs
```

The updater writes only this archive's `data/Rnino34.ascii.txt`. The tests use local fixtures and mocked downloads.

## Restoration

Move the parser, snapshot, updater, and tests back to their former root paths, or adjust their relative paths to the chosen integration. Reconnect the registration and rendering branches in `browser-integration.md`. Include the parser and snapshot in the service worker and bump its cache version.

The current app centralizes units, legend gradients and ranges, and reference labels in `dataset-display.mjs`. Add an ENSO display entry there using the archived ticks and gradient; the historical browser snippets describe the original branches before this extraction. Styles now live in `styles.css`.

For automatic updates, add `node scripts/update-enso-data.mjs` to the main data workflow and include `data/Rnino34.ascii.txt` in its diff and commit paths. Add a README video choice only when intentionally enabling automated examples for this dataset.
