# Archived Sea Ice Models

GIOMAS and ORAS5 are retained here for reference, not offered in the active app. Their parsers, Python processing scripts and requirements, tests, reduced data snapshots, scientific notes, and original workflow templates are preserved. PIOMAS and both sea ice extent series remain active.

The app does not import these modules, fetch these snapshots, or cache them for offline use. README video selection excludes them. The templates under this directory's `.github/workflows` are outside the repository-root workflow directory and therefore do not run in GitHub Actions.

## Contents

- [GIOMAS processing and scientific notes](docs/giomas-setup.md)
- [ORAS5 processing and scientific notes](docs/oras5-setup.md)
- [Former browser registration and loading snippets](browser-integration.md)
- `data/`: the last reduced snapshots, not raw gridded downloads
- `scripts/`: processing scripts and historical browser/README video integration
- `tests/`: opt-in parser and Python processing tests
- `.github/workflows/`: inactive workflow templates

The setup notes describe the former app integration; statements about active choices, scheduled updates, and browser checks are historical. Archived parsers reuse the active PIOMAS scale helper without being imported by the app.

## Optional Checks

From the repository root, check the archived JavaScript code with:

```sh
node --test archive/sea-ice-models/tests/*.test.mjs
```

Python processing and its tests are independent of the app. From this directory, use a Python environment with the corresponding `scripts/requirements-*.txt` dependencies installed:

```sh
python -m unittest discover -s tests -p 'test_*.py'
```

The updaters now default to this archive's `data/` and ignored `.cache/` folders. Running them manually does not enable the datasets. The historical browser checks require restoring the app integration first.

## Restoration

Restoring these datasets is a deliberate code change: reconnect their registrations and snapshot loading, include their modules and snapshots in the service worker, and restore their README video choices if desired. Module imports and data paths must match their chosen locations. Only move a workflow template into the repository-root `.github/workflows` after adjusting its script, test, dependency, and output paths. Leaving this archive in place does not enable anything automatically.
