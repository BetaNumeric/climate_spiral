# **Climate Spiral**

 
[**Live Demo**](https://betanumeric.github.io/climate_spiral/)


https://github.com/user-attachments/assets/4862e111-25a3-417e-994f-fd50bbe4f3ba



An interactive 3D web visualization of global temperature anomalies from 1880 to the present. This project creates a spiraling "time-volume" where each volution represents one orbit of the earth and the radius represents the temperature deviation from the 1951-1980 baseline, helping to visualize the accelerating trend of global warming.

It can also visualize global ocean surface temperature anomalies from 1850 and atmospheric CO2 data measured at Mauna Loa from 1958 to the present.

## **Controls and Usage**

The animation plays automatically upon loading. You can control the playback using the timeline and buttons at the bottom of the screen.

* **Rotate:** Left-click and drag to rotate the spiral.  
* **Zoom:** Use the mouse scroll wheel.  
* **Move:** Right-click and drag (requires "Free Camera" to be enabled in the settings).

Click the gear icon to access settings. Controls are grouped into collapsible **View**, **Animation**, **Data Source**, and **Export** sections. View starts expanded; each section can be opened independently.

Use the **Dataset** selector at the top of Settings to switch between **Temperature** (land and ocean), **Ocean Temperature**, and **CO2 Monthly**. Each dataset retains its playback position and play/pause state while switching. The selector's options are generated from `DATASET_CONFIG`, so future supported datasets can appear without adding another toggle.

To save an animation, open **Export**, set **Video Length (s)**, and select **Export video**. The full timeline is recorded from the current camera view, including visible annotations but excluding the interface. Recording runs in real time at up to 30 fps, with a maximum long edge of 1920 pixels. Keep the page visible and its window size unchanged until **Download .mp4** or **Download .webm** appears; the format is selected from those supported by your browser. You can collapse Export while recording; its heading shows **Recording** or **Ready**. You can cancel the export, and your original playback position and play/pause state are restored afterward. The video is generated locally without uploading data. **Export .glb** remains available for the 3D model.

To update the selected dataset, open **Data Source** and select **Fetch Latest** (with a proxy fallback) or **Load .txt** (**Load .json** for ocean temperature). You can also drag and drop a supported raw data file into the browser window. Ocean imports use the complete NOAA Climate at a Glance JSON download, including its source metadata and the full 1951-1980 reference period.

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

Ocean values are temperature **anomalies**, not absolute water temperatures or ocean heat content. The NOAA download uses a 1901-2000 baseline. The app subtracts the 1951-1980 mean for each calendar month separately, putting the ocean spiral on the same reference period and degrees-Celsius scale as GISTEMP. Rebasing preserves changes within each calendar month's series; it does not make the two products' coverage or methods identical. The original NOAA values and metadata are retained unchanged in the local JSON file. Incomplete reference periods and unexpected source metadata are rejected rather than silently using another baseline.

The weekly GitHub workflow refreshes all three local files, including historical revisions. For ocean data, it requests all individual months through the current UTC year, validates the response, and refuses incomplete or older downloads. No annual URL edits are needed. The service worker pre-caches the ocean data and parser for offline use and checks the local data file over the network when online.

To update only the ocean file locally, run `node scripts/update-ocean-data.mjs`. To run the parser and updater tests, use `node --test tests/ocean-data.test.mjs` (Node.js 20 or newer).

## **Technologies**

This project is built using HTML5, CSS3, and JavaScript (ES6). The 3D rendering logic is handled by the Three.js library.

## **License**

This project is licensed under the MIT License. Feel free to modify and share.
