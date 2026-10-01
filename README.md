# **Climate Spiral**

 
[**Live Demo**](https://betanumeric.github.io/climate_spiral/)


<!-- README_VIDEO_TOP_START -->
https://github.com/user-attachments/assets/a1b27abe-cee2-45fc-9d3b-55ef09eccc6a
<!-- README_VIDEO_TOP_END -->
<!-- README_VIDEO_UPDATED: 2026-09 -->



An interactive 3D web visualization of global temperature anomalies from 1880 to the present. This project creates a spiraling "time-volume" where each volution represents one orbit of the earth and the radius represents the temperature deviation from the 1951-1980 baseline, helping to visualize the accelerating trend of global warming.

It can also visualize separate global land-only and ocean surface temperature anomalies from 1850, atmospheric CO2 measured at Mauna Loa from 1958, global atmospheric methane from July 1983, Arctic and Antarctic sea ice extent from November 1978, and global mean sea-level change from January 1993.

## **Controls and Usage**

The animation plays automatically upon loading. You can control the playback using the timeline and buttons at the bottom of the screen.

* **Rotate:** Left-click and drag to rotate the spiral.  
* **Zoom:** Use the mouse scroll wheel.  
* **Move:** Right-click and drag (requires "Free Camera" to be enabled in the settings).
* **Top-down:** Press **1**, double-click, or double-tap the visualization.
* **Front:** Press **2** or double right-click the visualization.
* **Right side:** Press **3** to look along the monthly axis and compare values across years.

Camera shortcuts smoothly return to the centered, default zoom in either layout. After a rotational drag ends within 10 degrees of Top, Front, or Right, the orientation gently snaps into alignment while preserving the current zoom and pan position. It does not snap after zooming or panning alone. Camera motion respects reduced motion, and shortcuts are inactive while editing settings fields or exporting video. Right-dragging to pan does not count as a double right-click.

Click the gear icon to access settings. Controls are grouped into collapsible **View**, **Animation**, **Data Source**, and **Export** sections. All sections start collapsed and can be opened independently.

Use the **Spiral / Unwrapped** control at the top of Settings to switch layouts. The rings smoothly unfold into horizontal value guides, with one line per year. Each data line rises continuously through the year, just like the spiral; its right-hand year-boundary endpoint has the same height and value as the next line's left-hand January endpoint. Twelve month labels are centered within their months; the complete December-to-January data interval is retained at the year boundary. No future month is invented for an incomplete year, and actual missing observations remain gaps. Unwrapped month labels face the camera as you tilt the view and gradually fade as their overlap increases near an edge-on angle. Rotating to the side shows the years stacked vertically, retaining their data colors; year labels follow the camera around the outside of the graph. The spiral's paired vertical value guides converge into one labeled set during the transition, fading the duplicate as they merge. In the Unwrapped layout they sit on the far edge from the camera, becoming visible from the side and smoothly fading as their spacing compresses toward the front. They use each dataset's scale and units, follow the annotations toggle, and also appear in video exports. Switching layouts preserves the current month and playback state. Video and model exports use the selected layout unless an export animation overrides it. The viewport transition respects the system's reduced-motion preference.

**Line Thickness**, below **Year Spacing**, ranges from **Line** (a one-pixel centerline without a tube surface) to **150%**, with **100%** retaining the original thickness. It applies to both layouts and exports. At the minimum, GLB exports contain line primitives rather than a solid mesh. Changing thickness or spacing preserves playback position and play/pause state.

Use the **Dataset** selector at the top of Settings to switch between **Global Temperature**, **Ocean Temperature**, **Land Temperature**, **Arctic Sea Ice**, **Antarctic Sea Ice**, **CO2**, **Global Sea Level**, and **Global Methane**. Each dataset retains its playback position and play/pause state while switching. The selector's options are generated from `DATASET_CONFIG`, so future supported datasets can appear without adding another toggle.

To save an animation, open **Export** and select **Export video**. The completed video downloads automatically. The **Months per frame** slider in **Animation** controls both viewport playback and export; the default is seven available monthly observations per 30 fps frame. Larger values skip observations to shorten the animation. Export shows the calculated video duration, including brief holds and camera moves. The full timeline is recorded, including visible annotations but excluding the interface. The collapsed **Advanced video settings** section offers landscape (1920 x 1080), portrait (1080 x 1920), square (1080 x 1080), current-window, and custom resolutions. Custom width and height must be even numbers from 128 to 3840 pixels, with a maximum of 3840 x 2160 total pixels. **Current window** retains the window's proportions with a maximum long edge of 1920 pixels. The scene is rendered at the chosen resolution without stretching; the preview is letterboxed when needed. **Include legend** adds the live date, value, color scale, and marker without a panel border. It automatically reserves space beside the spiral in landscape video and below it in square or portrait video.

**Camera animation** starts with a chosen view, then follows an ordered path of up to 20 steps after the monthly drawing finishes. Add a view at the Spiral or Unwrapped Top, Front, or Right angle, or add a Pause to hold the preceding view for 0.5 to 30 seconds. Steps can be reordered or removed; with no steps, the camera stays still. The default path is Spiral Top to Spiral Front. **Seconds per move** sets the duration of view transitions, while each Pause has its own duration. The video duration estimate includes the complete path and brief endpoint holds. **Preview** plays the camera path over the fully drawn spiral in the viewport without recording; Stop preview, Escape, or completion restores the camera, layout, and playback position. **Current view** can be used as the starting angle. Export completion or cancellation also restores the original state.

The shared `CONFIG.sceneScale` value in `index.html` controls the default spiral size in both the viewer and video exports. Its default is `1.12`; larger values frame the visualization more tightly, while smaller values leave more space around it.

Recording runs locally at a constant 30 fps, without uploading data. Every frame is advanced explicitly and the final file receives exact `n / 30` timestamps, so slower hardware makes exporting take longer rather than producing a variable-rate or choppy timeline. High resolutions require more GPU and encoding resources and may fail on some devices.

Browsers suspend or heavily throttle WebGL rendering in hidden tabs, so reliable background export is not available. When the page becomes hidden, export pauses at its current frame and resumes when the page is visible again; the resulting video contains no pause or timing gap. Keep the window size unchanged while recording. You can collapse Export while recording; its heading shows **Recording**, **Paused**, or **Ready**. Completion or cancellation restores your camera, playback position, and play/pause state. **Export .glb** remains available for the 3D model.

The recorder requests a keyframe every 0.5 seconds and records without periodic chunk requests. Before download, [Mediabunny](https://mediabunny.dev/) losslessly remuxes the recording, verifies keyframes, and rebuilds the seek index. MP4 output uses a regular, non-fragmented container with its index at the start; WebM output also receives finalized metadata and an index. This improves seeking compatibility with desktop players such as VLC. Keyframe scheduling remains browser-dependent. The H.264 level is negotiated by the browser rather than fixed to level 3.0, and the target bitrate scales with resolution. These changes apply to newly exported videos, not existing downloads.

To update the selected dataset, open **Data Source** and select **Fetch Latest** (with a proxy fallback) or **Load .txt** (**Load .json** for land/ocean temperature, sea ice and sea level). You can also drag and drop a supported data file into the browser window. Land and ocean imports use the corresponding complete NOAA Climate at a Glance JSON download, including its source metadata and the full 1951-1980 reference period. Files for the wrong surface type are rejected. Sea ice imports use the corresponding local JSON bundle, containing all twelve monthly NSIDC CSV files and the hemisphere metadata, not an individual month's CSV.

## **Mobile / PWA**

This app includes a web app manifest and service worker, so it can be installed to iPhone and Android home screens and run in **standalone** mode (click "Add to Home Screen" in Settings).

## **Background and Inspiration**

This project is a 3D implementation of the "Climate Spiral" concept originally visualized by climate scientist Ed Hawkins from the University of Reading in 2016\.

* Original Concept: [Wikipedia: Climate Spiral](https://en.wikipedia.org/wiki/Climate_spiral)  
* NASA Visualization: [Scientific Visualization Studio](https://svs.gsfc.nasa.gov/5190/)



<!-- README_VIDEO_BOTTOM_START -->
<!-- README_VIDEO_DATASET: co2 -->
**Global CO2**

https://github.com/user-attachments/assets/baa470a0-12b8-49a9-b5e6-a125154b423b
<!-- README_VIDEO_BOTTOM_END -->



## **Data Source**

The data used in this visualization comes from:

* **NASA GISS Surface Temperature Analysis (GISTEMP v4)**  
  Source: [NASA GISS Surface Temperature Analysis](https://data.giss.nasa.gov/gistemp/)  
  Raw Data File: [GLB.Ts+dSST.txt](https://data.giss.nasa.gov/gistemp/tabledata_v4/GLB.Ts+dSST.txt)
* **NOAA GML Mauna Loa CO2 trend (monthly mean)**  
  Source: [NOAA GML CO2 Trends](https://gml.noaa.gov/ccgg/trends/mlo.html)  
  Raw Data File: [co2_mm_mlo.txt](https://gml.noaa.gov/webdata/ccgg/trends/co2/co2_mm_mlo.txt)
* **NOAA GML globally averaged marine surface methane (monthly mean)**
  Source: [NOAA GML Methane Trends](https://gml.noaa.gov/ccgg/trends_ch4/)
  Raw Data File: [ch4_mm_gl.txt](https://gml.noaa.gov/webdata/ccgg/trends/ch4/ch4_mm_gl.txt)
* **University of Colorado Sea Level Research Group: global mean sea level, seasonal signals retained**
  Source: [CU Sea Level Research Group](https://sealevel.colorado.edu/), [processing methods](https://sealevel.colorado.edu/data-processing-methods)
  Local source bundle: [global-sea-level.json](data/global-sea-level.json)
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

Methane is NOAA's globally averaged marine surface **CH4 mole fraction in dry air**, in **ppb** (parts per billion), not emissions or a temperature anomaly. The spiral uses the `average` column, retaining its seasonal cycle, not `average_unc` or the seasonally adjusted `trend`. Missing means are not replaced with either column. The monthly series begins in July 1983; recent months are preliminary and can be revised, and publication lags the temperature datasets. Original source comments, uncertainties, and trend values are retained in the local text file. The radius uses a **1500 ppb display offset** and 200 ppb per reference-ring interval, with a fixed 1500-2100 ppb color scale. This offset is not a preindustrial reference or a rebasing of the displayed values. Imported gaps remain gaps in the curve. Methane and CO2 use different units and display scales, so their radii and colors do not compare warming effects.

Sea level uses CU's **seasonal-signals-retained** satellite series, including the source's GIA correction. These are roughly ten-day estimates, not published monthly means. The app converts decimal years to UTC calendar dates (including leap years) and takes the arithmetic mean of available estimates within each month. Months with a single estimate retain that observation, with less temporal coverage than other months: February 1997 uses the February 20 estimate, not interpolation between January and March. It omits the final source month as potentially incomplete; months with no observations remain gaps. These are sample means, not time-weighted integrations or independent daily measurements. No missing observations are forecast or filled. A single reference value, the equally weighted mean of the twelve 1993 monthly means, is subtracted from every month; this baseline still requires at least two estimates in each reference month. The result is **change in mm relative to 1993**, not absolute ocean depth or local coastal sea level. Display precision is not an uncertainty estimate. The radius has a -50 mm display origin so negative changes can be drawn; color runs from 0 to 150 mm, with values outside that range retaining their actual radius and label. The original source text and release URL are retained in `global-sea-level.json`. Import that JSON bundle, not the raw text file. The bundled 2026_rel2 release yields monthly values through May 2026; June is withheld. [Release notes](https://sealevel.colorado.edu/data/2026rel2-0).

ENSO is **disabled**, with its `DATASET_CONFIG` registration and workflow step commented out. Its parser, rendering branches, raw snapshot, updater and tests remain available. To restore it, uncomment the registration and workflow step, add `data/Rnino34.ascii.txt` to the workflow's commit paths and service worker's data assets, and bump the cache version. The retained series is NOAA CPC's [monthly relative Nino 3.4 index](https://www.cpc.ncep.noaa.gov/data/indices/Rnino34.ascii.txt), not the three-month ONI/RONI or an official event classification.

The weekly GitHub workflow refreshes all eight active local datasets, including historical revisions. For land and ocean data, it requests all individual months through the current UTC year. For sea ice, it downloads the twelve calendar-month files per hemisphere and validates both complete bundles before writing either. For methane, it validates the global CH4 metadata and requires a complete monthly series from July 1983. For sea level, it discovers the newest release on CU's homepage and downloads its paired seasonal-signals-retained file. A missing link, unexpected format, incomplete reference period, excessive gaps, lost previously available months, fewer samples, or an older endpoint causes the updater to fail without replacing the snapshot. No annual URL edits or credentials are needed. The service worker pre-caches active datasets and parsers for offline use and checks the local data files over the network when online.

The separate **Refresh README videos** workflow runs monthly on the 22nd at 08:37 UTC and can also be started manually from Actions. It renders Global Temperature for the first video and randomly chooses another active dataset for the second, excluding the previous selection. The clips use the checked-in monthly data and the app's default video settings, including Full HD landscape resolution. They are attached to one dedicated GitHub issue so the README retains inline video players without committing large binaries. The workflow verifies both videos, updates the two README links, and skips a scheduled run if that month's videos were already published. Each upload must stay below GitHub's [10 MB free-plan video attachment limit](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/attaching-files). Standard GitHub-hosted runners are [free for this public repository](https://docs.github.com/en/billing/concepts/product-billing/github-actions); the workflow does not use AI tokens.

**One-time setup:** Enable Issues for the repository. Create a [fine-grained personal access token](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens) restricted to this repository with **Contents: Read and write** and **Issues: Read and write**, and add it as an [Actions repository secret](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets) named `README_VIDEO_TOKEN`. The built-in `GITHUB_TOKEN` handles the README commit, but [cannot upload video attachments](https://github.com/cli/cli/issues/14309), so this separate token is needed for the inline players. The "Allow GitHub Actions to create and approve pull requests" setting is not needed. After pushing the workflow, run it once manually to replace the existing examples; renew the secret if the token expires.

To update land data locally, run `node scripts/update-land-data.mjs`; for ocean data, run `node scripts/update-ocean-data.mjs`; for both sea ice datasets, run `node scripts/update-sea-ice-data.mjs`; for methane, run `node scripts/update-methane-data.mjs`; for sea level, run `node scripts/update-sea-level-data.mjs`. To run all parser, updater, and video-setting tests, use `node --test tests/*.test.mjs` (Node.js 20 or newer).

For video browser checks, serve the app at `http://127.0.0.1:8000` and run `node scripts/check-video-export.cjs` with Playwright and Chrome installed. An optional argument specifies the Playwright package path. This records sample videos, checks decoded dimensions and nonblank frames, verifies camera/playback restoration and mobile layouts, and saves screenshots to the system temporary directory under `climate-video-export`.

## **Technologies**

This project is built using HTML5, CSS3, and JavaScript (ES6). The 3D rendering logic is handled by the Three.js library. Sea ice CSV parsing uses the vendored, ISC-licensed [d3-dsv](vendor/d3-dsv/README.md) parser; no package installation or build step is required.

## **License**

This project is licensed under the MIT License. Feel free to modify and share.
