# **Climate Spiral**

 
[**Live Demo**](https://betanumeric.github.io/climate_spiral/)


https://github.com/user-attachments/assets/4862e111-25a3-417e-994f-fd50bbe4f3ba



An interactive 3D web visualization of global temperature anomalies from 1880 to the present. This project creates a spiraling "time-volume" where each volution represents one orbit of the earth and the radius represents the temperature deviation from the 1951-1980 baseline, helping to visualize the accelerating trend of global warming.

It can also visualize separate global land-only and ocean surface temperature anomalies from 1850, atmospheric CO2 measured at Mauna Loa from 1958, and Arctic and Antarctic sea ice extent from November 1978.

## **Controls and Usage**

The animation plays automatically upon loading. You can control the playback using the timeline and buttons at the bottom of the screen.

* **Rotate:** Left-click and drag to rotate the spiral.  
* **Zoom:** Use the mouse scroll wheel.  
* **Move:** Right-click and drag (requires "Free Camera" to be enabled in the settings).

Click the gear icon to access settings. Controls are grouped into collapsible **View**, **Animation**, **Data Source**, and **Export** sections. View starts expanded; each section can be opened independently.

Use the **Dataset** selector at the top of Settings to switch between **Global Temp: Land + Ocean**, **Ocean Temperature**, **Land Temperature**, **Arctic Sea Ice**, **Antarctic Sea Ice**, and **CO2**. All three temperature datasets represent global averages. Each dataset retains its playback position and play/pause state while switching. The selector's options are generated from `DATASET_CONFIG`, so future supported datasets can appear without adding another toggle.

To save an animation, open **Export**, set **Video Length (s)**, and select **Export video**. The full timeline is recorded from the current camera view, including visible annotations but excluding the interface. Recording runs in real time at up to 30 fps, with a maximum long edge of 1920 pixels. Keep the page visible and its window size unchanged until **Download .mp4** or **Download .webm** appears; the format is selected from those supported by your browser. You can collapse Export while recording; its heading shows **Recording** or **Ready**. You can cancel the export, and your original playback position and play/pause state are restored afterward. The video is generated locally without uploading data. **Export .glb** remains available for the 3D model.

To update the selected dataset, open **Data Source** and select **Fetch Latest** (with a proxy fallback) or **Load .txt** (**Load .json** for land/ocean temperature and sea ice). You can also drag and drop a supported data file into the browser window. Land and ocean imports use the corresponding complete NOAA Climate at a Glance JSON download, including its source metadata and the full 1951-1980 reference period. Files for the wrong surface type are rejected. Sea ice imports use the corresponding local JSON bundle, containing all twelve monthly NSIDC CSV files and the hemisphere metadata, not an individual month's CSV.

## **Mobile / PWA**

This app includes a web app manifest and service worker, so it can be installed to iPhone and Android home screens and run in **standalone** mode (click "Add to Home Screen" in Settings).

## **Background and Inspiration**

This project is a 3D implementation of the "Climate Spiral" concept originally visualized by climate scientist Ed Hawkins from the University of Reading in 2016\.

* Original Concept: [Wikipedia: Climate Spiral](https://en.wikipedia.org/wiki/Climate_spiral)  
* NASA Visualization: [Scientific Visualization Studio](https://svs.gsfc.nasa.gov/5190/)



https://github.com/user-attachments/assets/5eb3508c-af42-4f4c-8416-544912cfbda7



## **Data Source**

The data used in this visualization comes from:

* **NASA GISS Surface Temperature Analysis (GISTEMP v4)**  
  Source: [NASA GISS Surface Temperature Analysis](https://data.giss.nasa.gov/gistemp/)  
  Raw Data File: [GLB.Ts+dSST.txt](https://data.giss.nasa.gov/gistemp/tabledata_v4/GLB.Ts+dSST.txt)
* **NOAA GML Mauna Loa CO2 trend (monthly mean)**  
  Source: [NOAA GML CO2 Trends](https://gml.noaa.gov/ccgg/trends/mlo.html)  
  Raw Data File: [co2_mm_mlo.txt](https://gml.noaa.gov/webdata/ccgg/trends/co2/co2_mm_mlo.txt)
* **NOAA NCEI Climate at a Glance: global ocean temperature (monthly)**
  Source: [Climate at a Glance](https://www.ncei.noaa.gov/access/monitoring/climate-at-a-glance/global/time-series)
  Local source file: [ocean-temperature.json](data/ocean-temperature.json)
* **NOAA NCEI Climate at a Glance: global land-only temperature (monthly)**
  Source: [Climate at a Glance](https://www.ncei.noaa.gov/access/monitoring/climate-at-a-glance/global/time-series)
  Local source file: [land-temperature.json](data/land-temperature.json)
* **NOAA/NSIDC Sea Ice Index v4: monthly Arctic and Antarctic extent**
  Source: [Sea Ice Index](https://nsidc.org/data/g02135/versions/4), [monthly CSV archive](https://nsidc.org/data/seaice_index/data-and-image-archive)
  Local source files: [sea-ice-north.json](data/sea-ice-north.json), [sea-ice-south.json](data/sea-ice-south.json)

Land and ocean values are temperature **anomalies**, not absolute temperatures or ocean heat content. Land represents surface air temperature over land; ocean represents sea surface temperature. Both NOAA downloads use a 1901-2000 baseline. The app subtracts each dataset's own 1951-1980 mean for each calendar month separately, putting both spirals on the same reference period and degrees-Celsius scale as GISTEMP. Rebasing preserves changes within each calendar month's series; it does not make the products' coverage or methods identical. The combined series remains NASA GISTEMP, not a simple average of the NOAA land and ocean series. The original NOAA values and metadata are retained unchanged in the local JSON files. Incomplete reference periods and unexpected source metadata are rejected rather than silently using another baseline.

Sea ice values are monthly mean **extent** in million square kilometres (shown as **M km2**), not ice area, ice volume, or anomalies. Extent measures the area covered by at least 15% sea ice. Both hemispheres share a linear radius scale with zero at the center and a 0-20 million km2 color scale; less ice moves inward. The polar plot's enclosed area is not proportional to extent. NSIDC's original records and source flags are retained in each JSON bundle. Missing observations, including December 1987 and January 1988, are excluded and shown as breaks in the curve. Smoothing stays within contiguous monthly runs and does not fill these gaps; month stepping moves between available observations.

Sea ice data citation: Fetterer et al. (2025), *Sea Ice Index*, Version 4, NSIDC. [doi:10.7265/a98x-0f50](https://doi.org/10.7265/a98x-0f50). Monthly Northern and Southern Hemisphere extent; accessed 2026-09-27.

The weekly GitHub workflow refreshes all six local files, including historical revisions. For land and ocean data, it requests all individual months through the current UTC year. For sea ice, it downloads the twelve calendar-month files per hemisphere and validates both complete bundles before writing either. The updaters refuse incomplete or older downloads. No annual URL edits are needed. The service worker pre-caches the datasets and parsers for offline use and checks the local data files over the network when online.

To update land data locally, run `node scripts/update-land-data.mjs`; for ocean data, run `node scripts/update-ocean-data.mjs`; for both sea ice datasets, run `node scripts/update-sea-ice-data.mjs`. To run all parser and updater tests, use `node --test tests/*.test.mjs` (Node.js 20 or newer).

## **Technologies**

This project is built using HTML5, CSS3, and JavaScript (ES6). The 3D rendering logic is handled by the Three.js library. Sea ice CSV parsing uses the vendored, ISC-licensed [d3-dsv](vendor/d3-dsv/README.md) parser; no package installation or build step is required.

## **License**

This project is licensed under the MIT License. Feel free to modify and share.
