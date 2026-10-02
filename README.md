# Climate Spiral

Explore monthly climate measurements in an interactive 3D spiral. Each turn represents one year; distance from the center and color show the selected value. Switch to **Unwrapped** to compare the months of different years as stacked lines.

[Open the live app](https://betanumeric.github.io/climate_spiral/)

## Examples

### Global Temperature

<!-- README_VIDEO_TOP_START -->
https://github.com/user-attachments/assets/a1b27abe-cee2-45fc-9d3b-55ef09eccc6a
<!-- README_VIDEO_TOP_END -->
<!-- README_VIDEO_UPDATED: 2026-09 -->


<!-- README_VIDEO_BOTTOM_START -->
<!-- README_VIDEO_DATASET: co2 -->
**Global CO2**

https://github.com/user-attachments/assets/baa470a0-12b8-49a9-b5e6-a125154b423b
<!-- README_VIDEO_BOTTOM_END -->

## Datasets

| Dataset | Monthly measurement | Source | Starts |
| --- | --- | --- | --- |
| Global Temperature | Combined land and ocean temperature anomaly, °C | [NASA GISTEMP](https://data.giss.nasa.gov/gistemp/) | 1880 |
| Ocean Temperature | Sea surface temperature anomaly, °C | [NOAA NCEI](https://www.ncei.noaa.gov/access/monitoring/climate-at-a-glance/global/time-series) | 1850 |
| Land Temperature | Land surface air temperature anomaly, °C | [NOAA NCEI](https://www.ncei.noaa.gov/access/monitoring/climate-at-a-glance/global/time-series) | 1850 |
| Arctic Sea Ice Extent | Extent, million km² | [NOAA/NSIDC](https://nsidc.org/data/g02135/versions/4) | 1978 |
| Antarctic Sea Ice Extent | Extent, million km² | [NOAA/NSIDC](https://nsidc.org/data/g02135/versions/4) | 1978 |
| Arctic Sea Ice Volume (PIOMAS) | Model-estimated volume, 10³ km³ | [PIOMAS](https://psc.apl.uw.edu/research/projects/arctic-sea-ice-volume-anomaly/) | 1979 |
| Global CO2 | Atmospheric concentration at Mauna Loa, ppm | [NOAA GML](https://gml.noaa.gov/ccgg/trends/mlo.html) | 1958 |
| Global Methane | Globally averaged marine surface concentration, ppb | [NOAA GML](https://gml.noaa.gov/ccgg/trends_ch4/) | 1983 |
| Global Sea Level | Change in global mean sea level, mm | [CU Sea Level Research Group](https://sealevel.colorado.edu/) | 1993 |

Temperature values are anomalies relative to 1951-1980; the NOAA land and ocean series are rebased from their original reference period. Sea ice **extent** measures ice-covered ocean area, while PIOMAS **volume** includes thickness and is model-estimated. CO2 and methane show concentrations, not emissions. Sea level shows change relative to 1993. Units and display scales differ across dataset types, so equal radii or colors do not imply comparable climate effects. See [Data Sources and Methods](docs/data-methods.md) for sources, processing, missing-month handling, and scientific limitations.

Optional **Arctic and Antarctic ORAS5 sea ice volume** series can be generated from monthly reanalysis fields starting in 1958. They appear automatically after the first complete download; see [ORAS5 setup and methods](docs/oras5-setup.md) for Copernicus access and monthly automation.

## Using the App

The animation starts automatically. Use the controls and timeline at the bottom to pause, step through months, or jump to either end. Choose a dataset and switch between **Spiral** and **Unwrapped** at the top of Settings.

Drag to rotate and scroll or pinch to zoom. Enable **Free Camera** in Settings to pan with a right-button drag. Press `1`, `2`, or `3` for the top, front, or right view; double-click or double-tap to reset to the top view. A double right-click selects the front view. The camera also snaps into those orientations after a nearby rotational drag.

The app can be installed as a standalone web app from your mobile browser's **Add to Home Screen** command. After an initial online load, its service worker caches the app and local datasets for offline use.

## Exporting

Open **Export** to download a `.glb` model or record a video. Video is rendered locally in your browser and downloads automatically. The **Months per frame** control in **Animation** sets playback and export speed; the default is seven monthly observations per 30 fps frame. The Export section shows the estimated duration.

Advanced video settings offer Full HD landscape, portrait, square, current-window, and custom resolutions, plus an optional legend. You can build a camera path from top, front, and right views of either layout, insert timed pauses, and preview the path before recording. The browser pauses an export while its tab is hidden and resumes when you return. High resolutions need more GPU and encoding resources; keep the window size unchanged during recording.

## Running Locally

The app uses HTML, CSS, JavaScript modules, and Three.js, with no build step. Serve the repository over HTTP, for example with `python -m http.server 8000`, then open `http://127.0.0.1:8000/`. The first load needs network access for CDN assets.

For dataset processing and source citations, read [Data Sources and Methods](docs/data-methods.md). For tests, data updates, video automation, and contributor setup, read [Maintenance](docs/maintenance.md).

The project builds on the Climate Spiral concept introduced by [Ed Hawkins](https://en.wikipedia.org/wiki/Climate_spiral) in 2016; see also [NASA's visualization](https://svs.gsfc.nasa.gov/5190/). Licensed under the [MIT License](LICENSE).
