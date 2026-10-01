# Maintenance

## Local Development

The app uses HTML, CSS, JavaScript modules, and [Three.js](https://threejs.org/). It has no build step. Serve the repository over HTTP so module and data requests work; for example, run `python -m http.server 8000` and open `http://127.0.0.1:8000/`. The first load needs network access for CDN assets. Sea ice CSV parsing uses the vendored, ISC-licensed [d3-dsv](../vendor/d3-dsv/README.md) parser.

With Node.js 20 or newer, run all parser, updater, layout, and export-setting tests with `node --test tests/*.test.mjs`.

For browser export checks, install dependencies with `npm ci`, install Chrome for Playwright, serve the app at `http://127.0.0.1:8000`, then run `node scripts/check-video-export.cjs`. The script records and decodes sample videos, checks dimensions and visible frames, verifies camera and playback restoration, and saves screenshots under `climate-video-export` in the system temporary directory. An optional argument specifies a Playwright package path.

The shared `CONFIG.sceneScale` setting in [`index.html`](../index.html) controls the default framing in the viewer and video exports. Its default is `1.12`; larger values make the visualization larger within the frame.

## Data Updates

The [Update climate data](../.github/workflows/update-climate-data.yml) workflow runs weekly on Fridays at 07:23 UTC and can be started manually. It refreshes the eight active datasets, runs the tests, and commits changed snapshots. The service worker caches the active data and parsers for offline use and checks local data files over the network when online.

The land and ocean updaters request individual months through the current UTC year and validate the baseline and source metadata. The sea ice updater downloads twelve calendar-month files per hemisphere and validates both bundles before replacing either. The methane updater validates global CH4 metadata and the complete series since July 1983. The sea-level updater discovers the latest paired seasonal-signals-retained release and checks its data before replacing the snapshot. Invalid formats, missing links, incomplete reference periods, lost observations, or older endpoints stop the relevant updater without replacing its local file.

To run an updater locally:

| Dataset | Command |
| --- | --- |
| Ocean temperature | `node scripts/update-ocean-data.mjs` |
| Land temperature | `node scripts/update-land-data.mjs` |
| Arctic and Antarctic sea ice | `node scripts/update-sea-ice-data.mjs` |
| Global methane | `node scripts/update-methane-data.mjs` |
| Global sea level | `node scripts/update-sea-level-data.mjs` |

NASA GISTEMP and Mauna Loa CO2 are downloaded directly by the workflow. The other updaters validate their source downloads before saving local snapshots. No credentials are needed for data updates.

ENSO remains disabled in the selector and workflow. Its parser, raw snapshot, updater, rendering branches, and tests are retained. To restore it, uncomment its `DATASET_CONFIG` registration and workflow step, add `data/Rnino34.ascii.txt` to the workflow commit paths and service worker assets, and bump the cache version. The retained source is NOAA CPC's [monthly relative Nino 3.4 index](https://www.cpc.ncep.noaa.gov/data/indices/Rnino34.ascii.txt), not the three-month ONI/RONI or an official event classification.

## README Videos

The [Refresh README videos](../.github/workflows/refresh-readme-videos.yml) workflow runs monthly on the 22nd at 08:37 UTC and can be started manually. It renders Global Temperature and one randomly chosen other active dataset, excluding the prior secondary choice. It uses checked-in data and the app's default Full HD landscape export settings. Videos are attached to a dedicated GitHub issue, keeping large binaries out of the repository. The workflow validates the uploads, updates the two README links, and skips a scheduled run when the month's videos have already been published.

Keep each upload below GitHub's [10 MB free-plan attachment limit](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/attaching-files). Standard GitHub-hosted runners are [free for this public repository](https://docs.github.com/en/billing/concepts/product-billing/github-actions). The workflow does not use AI tokens.

One-time setup: enable Issues for the repository. Create a [fine-grained personal access token](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens) restricted to this repository with **Contents: Read and write** and **Issues: Read and write**. Add it as an [Actions repository secret](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets) named `README_VIDEO_TOKEN`. The built-in `GITHUB_TOKEN` handles the README commit but [cannot upload video attachments](https://github.com/cli/cli/issues/14309). The "Allow GitHub Actions to create and approve pull requests" setting is unnecessary. Run the workflow once manually after setup, and renew the secret if the token expires.

The video updater relies on the exact `README_VIDEO_TOP_*`, `README_VIDEO_BOTTOM_*`, `README_VIDEO_DATASET`, and `README_VIDEO_UPDATED` markers in the README. Keep each marker once when editing or moving the example videos. The metadata and replacement logic live in [`scripts/readme-video.mjs`](../scripts/readme-video.mjs).

## Video Export Implementation

The browser records locally at a constant 30 fps. Each frame is advanced explicitly, then [Mediabunny](https://mediabunny.dev/) remuxes the file with `n / 30` timestamps and rebuilds its seek index. The recorder requests a keyframe every 0.5 seconds; exact scheduling depends on the browser. MP4 output uses a regular, non-fragmented container with its index at the start, while WebM receives finalized metadata and an index. The target bitrate scales with resolution, and the browser negotiates the H.264 level. Slower hardware lengthens export time rather than changing the video timeline. These properties apply to newly exported videos, not previously downloaded files.
