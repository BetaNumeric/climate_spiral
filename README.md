# Climate Spiral

Explore monthly climate measurements in an interactive 3D spiral. Each turn represents one year; distance from the center and color show the selected value. Switch to **Unwrapped** to compare the months of different years as stacked lines.

[Open the live app](https://betanumeric.github.io/climate_spiral/)

## Examples

### Global Temperature

<!-- README_VIDEO_TOP_START -->
https://github.com/user-attachments/assets/573bf0c3-925c-4a84-acd5-b3e06c3a851a
<!-- README_VIDEO_TOP_END -->
<!-- README_VIDEO_UPDATED: 2026-10 -->


<!-- README_VIDEO_BOTTOM_START -->
<!-- README_VIDEO_DATASET: sealevel -->
**Global Sea Level**

https://github.com/user-attachments/assets/2027cfb0-9b29-441b-9bac-b7b8c7af7d9d
<!-- README_VIDEO_BOTTOM_END -->

## Datasets

| Dataset | Monthly measurement | Source | Starts |
| --- | --- | --- | --- |
| Global Temperature | Combined land and ocean temperature anomaly, °C | [NASA GISTEMP](https://data.giss.nasa.gov/gistemp/) | 1880 |
| Local Temperature | Temperature anomaly for a location, station, or country, °C | [Open-Meteo](https://open-meteo.com/en/docs/historical-weather-api), [NOAA GHCN-Monthly](https://www.ncei.noaa.gov/products/land-based-station/global-historical-climatology-network-monthly), [CRU-CY](https://crudata.uea.ac.uk/cru/data/hrg/) | 1950 / station-dependent / 1901 |
| Ocean Temperature | Sea surface temperature anomaly, °C | [NOAA NCEI](https://www.ncei.noaa.gov/access/monitoring/climate-at-a-glance/global/time-series) | 1850 |
| Land Temperature | Land surface air temperature anomaly, °C | [NOAA NCEI](https://www.ncei.noaa.gov/access/monitoring/climate-at-a-glance/global/time-series) | 1850 |
| Arctic Sea Ice Extent | Extent, million km² | [NOAA/NSIDC](https://nsidc.org/data/g02135/versions/4) | 1978 |
| Antarctic Sea Ice Extent | Extent, million km² | [NOAA/NSIDC](https://nsidc.org/data/g02135/versions/4) | 1978 |
| Arctic Sea Ice Volume (PIOMAS) | Model-estimated volume, 10³ km³ | [PIOMAS](https://psc.apl.uw.edu/research/projects/arctic-sea-ice-volume-anomaly/) | 1979 |
| Global CO2 | Atmospheric concentration at Mauna Loa, ppm | [NOAA GML](https://gml.noaa.gov/ccgg/trends/mlo.html) | 1958 |
| Global Methane | Globally averaged marine surface concentration, ppb | [NOAA GML](https://gml.noaa.gov/ccgg/trends_ch4/) | 1983 |
| Global Sea Level | Change in global mean sea level, mm | [CU Sea Level Research Group](https://sealevel.colorado.edu/) | 1993 |

Temperature values are anomalies relative to 1951-1980; the NOAA land and ocean series are rebased from their original reference period. Sea ice **extent** measures ice-covered ocean area, while PIOMAS **volume** includes thickness and is model-estimated. CO2 and methane show concentrations, not emissions. Sea level shows change relative to 1993. Units and display scales differ across dataset types, so equal radii or colors do not imply comparable climate effects. See [Data Sources and Methods](docs/data-methods.md) for sources, processing, missing-month handling, and scientific limitations.

## Using the App

The animation starts automatically. Use the controls and timeline at the bottom to pause, step through months, or jump to either end. Choose a dataset and switch between **Spiral** and **Unwrapped** at the top of Settings.

Press **Enter** to wrap/unwrap, **Space** to play/pause, **comma / period** to step backward/forward one month (pausing playback), or **Home / End** to jump to either end. **S / I** toggle Settings / Info, and **Escape** closes an open panel or stops a camera preview. Typing and focused controls keep their normal keys; playback/layout shortcuts are disabled during preview or recording.

Hold a month button or comma/period to keep stepping. Add **Shift** to step by 12 calendar months, including Shift-clicking or holding either button. If the target month is missing, year steps use the next available observation in the chosen direction; they never invent data.

Choose **Local Temperature** and search for a city, country, or `latitude, longitude`, or press the location icon to use your device's location with permission. Selecting a country automatically opens its CRU country average, with no source switch needed; country names and codes can be searched offline. For cities and coordinates, **Local estimate (ERA5-Land)** is the default, with **Weather station (NOAA)** available as a separate source. Station search recommends a nearby record and offers alternatives with distance, history, and completeness. All three sources use 1951-1980 and save data on your device. Country averages begin in 1901 and receive annual releases. The first reanalysis download takes longer.

Drag to rotate and scroll or use a two-finger pinch to zoom. Enable **Free Camera** in Settings to pan with a right-button drag. Press `1` for top, `2` for front, `3` for right, `4` for left, or `5` for back; double-click or double-tap to reset to top. Arrow Up selects top and Arrow Down selects front; Arrow Left/Right rotate by a quarter turn from a side view. Double-right-click moves from top to front, then cycles right, back, left, and front in quarter turns. The camera also snaps into those orientations after a nearby rotational drag.

On mobile, double-tap with two fingers to move from top to front, then cycle right, back, left, and front. Spread three fingers to unwrap the spiral and pinch them together to wrap it again. Tap outside Settings to close it. Some system gestures (including [VoiceOver's two-finger double-tap](https://support.apple.com/en-gb/guide/iphone/iph3e2e2281/ios)) can take precedence; Settings provides **View → Camera View** and the layout toggle as alternatives.

The app can be installed as a standalone web app from your mobile browser's **Add to Home Screen** command. After an initial online load, its service worker caches the app and local datasets for offline use.

## Exporting

Open **Export** to download a `.glb` model or record a video. Video is rendered locally in your browser and downloads automatically. The **Months per frame** control in **Animation** sets playback and export speed; the default is seven monthly observations per 30 fps frame. The Export section shows the estimated duration.

Advanced video settings offer Full HD landscape, portrait, square, current-window, and custom resolutions, plus an optional legend. You can build a camera path from top, front, and right views of either layout, insert timed pauses, and preview the path before recording. The browser pauses an export while its tab is hidden and resumes when you return. High resolutions need more GPU and encoding resources; keep the window size unchanged during recording.

The default path draws in Spiral Top, pauses for one second, moves to Spiral Front over two seconds, and pauses again. All camera steps remain editable.

## Running Locally

The app uses HTML, CSS, JavaScript modules, and Three.js, with no build step. Serve the repository over HTTP, for example with `python -m http.server 8000`, then open `http://127.0.0.1:8000/`. The first load needs network access for CDN assets.

For dataset processing and source citations, read [Data Sources and Methods](docs/data-methods.md). For tests, data updates, video automation, and contributor setup, read [Maintenance](docs/maintenance.md).

The project builds on the Climate Spiral concept introduced by [Ed Hawkins](https://en.wikipedia.org/wiki/Climate_spiral) in 2016; see also [NASA's visualization](https://svs.gsfc.nasa.gov/5190/). Licensed under the [MIT License](LICENSE).
