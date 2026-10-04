# Data Sources and Methods

The spiral shows monthly measurements and model estimates. One turn represents a calendar year; radius and color encode the selected measurement. Different datasets use different units and display scales, so equal radii or colors across datasets do not imply equal climate effects.

| Dataset | Source | Local snapshot | Measurement |
| --- | --- | --- | --- |
| Global Temperature | [NASA GISTEMP v4](https://data.giss.nasa.gov/gistemp/), [monthly table](https://data.giss.nasa.gov/gistemp/tabledata_v4/GLB.Ts+dSST.txt) | [`GLB.Ts+dSST.txt`](../data/GLB.Ts+dSST.txt) | Combined land and ocean temperature anomaly, °C relative to 1951-1980 |
| Local Temperature | [Open-Meteo / ERA5-Land](https://open-meteo.com/en/docs/historical-weather-api) or [NOAA GHCN-Monthly v4](https://www.ncei.noaa.gov/products/land-based-station/global-historical-climatology-network-monthly) | On-device browser storage; [station catalog](../data/weather-stations/catalog.json) | Local monthly temperature anomaly, °C relative to each calendar month's 1951-1980 average |
| Ocean Temperature | [NOAA Climate at a Glance](https://www.ncei.noaa.gov/access/monitoring/climate-at-a-glance/global/time-series) | [`ocean-temperature.json`](../data/ocean-temperature.json) | Sea surface temperature anomaly, °C rebased to 1951-1980 |
| Land Temperature | [NOAA Climate at a Glance](https://www.ncei.noaa.gov/access/monitoring/climate-at-a-glance/global/time-series) | [`land-temperature.json`](../data/land-temperature.json) | Land surface air temperature anomaly, °C rebased to 1951-1980 |
| Arctic and Antarctic Sea Ice Extent | [NOAA/NSIDC Sea Ice Index v4](https://nsidc.org/data/g02135/versions/4), [monthly CSV archive](https://nsidc.org/data/seaice_index/data-and-image-archive) | [`sea-ice-north.json`](../data/sea-ice-north.json), [`sea-ice-south.json`](../data/sea-ice-south.json) | Monthly mean extent, million km² |
| Arctic Sea Ice Volume | [PIOMAS](https://psc.apl.uw.edu/research/projects/arctic-sea-ice-volume-anomaly/), [monthly table](https://psc.apl.uw.edu/wordpress/wp-content/uploads/schweiger/ice_volume/PIOMAS.2sst.monthly.Current.v2.1.txt) | [`piomas-monthly.txt`](../data/piomas-monthly.txt) | Monthly mean model-estimated volume, 10³ km³ |
| Global CO2 | [NOAA GML Mauna Loa trends](https://gml.noaa.gov/ccgg/trends/mlo.html), [monthly means](https://gml.noaa.gov/webdata/ccgg/trends/co2/co2_mm_mlo.txt) | [`co2_mm_mlo.txt`](../data/co2_mm_mlo.txt) | Atmospheric CO2 at Mauna Loa, ppm |
| Global Methane | [NOAA GML methane trends](https://gml.noaa.gov/ccgg/trends_ch4/), [monthly means](https://gml.noaa.gov/webdata/ccgg/trends/ch4/ch4_mm_gl.txt) | [`ch4_mm_gl.txt`](../data/ch4_mm_gl.txt) | Globally averaged marine surface CH4 mole fraction, ppb |
| Global Sea Level | [University of Colorado Sea Level Research Group](https://sealevel.colorado.edu/), [processing methods](https://sealevel.colorado.edu/data-processing-methods) | [`global-sea-level.json`](../data/global-sea-level.json) | Change in global mean sea level, mm relative to 1993 |

## Temperature

NASA's combined temperature series starts in 1880. The separate NOAA land and ocean series start in 1850 and are anomalies, not absolute temperatures or ocean heat content. NOAA publishes them relative to 1901-2000. The app subtracts each series' own 1951-1980 mean for each calendar month, placing them on the same reference period and Celsius scale as GISTEMP. This preserves changes within each calendar month's series; it does not make the datasets' coverage or methods identical. The combined series is NASA GISTEMP, not an average of the displayed NOAA land and ocean series.

The original NOAA values and metadata remain in the local JSON snapshots. Incomplete reference periods and unexpected source metadata are rejected rather than silently changing the baseline.

## Local Temperature

### Country Averages

**Country average (CRU)** uses UEA's [CRU-CY](https://crudata.uea.ac.uk/cru/data/hrg/) country-averaged monthly mean temperatures, calculated from the 0.5-degree CRU-TS land grid using area-weighted means. The initial snapshot is CRU-CY v4.10 (country-file run `2606161920`), covering January 1901 to December 2025. These are observation-based gridded estimates, not a single weather station or the temperature at a country's centre. Each calendar month's 1951-1980 mean is subtracted, as in the other local sources. The monthly JAN-DEC columns are used, never the seasonal or annual columns. Original tables and release metadata remain in each JSON record.

CRU's [documentation](https://crudata.uea.ac.uk/cru/data/hrg/cru_ts_4.10/crucy.2606161920.v4.10/Read_Me_CRU_CY.txt) explains that, where observations are unavailable, CRU-TS substitutes the 1961-1990 monthly climatology. This can produce repeated values and suppress variation in sparsely observed regions; complete months do not imply complete observational coverage. The app cannot distinguish these substituted cells from observations in the already aggregated country tables. It does not invent newer months or fill missing country values itself. A full 360-month baseline is required.

Country/territory names follow ISO region names, but boundaries follow **CRU's provider-defined regions**. Some islands and overseas territories have separate provider files. Ambiguous partial-island groups are not mapped as whole countries (for example, Grand Cayman is not offered as all of the Cayman Islands); regions without an equivalent published country file are unavailable. The unified location search resolves exact country names and codes from the local catalog, without geocoding, and also converts geocoded country results into country-average choices. It never offers a country's representative coordinates as a point estimate or silently substitutes point data for a missing country record. The point-source selector is hidden for country averages; selecting a city or coordinates restores the previous reanalysis/station preference. Country search works offline after the app has been cached.

CRU-CY releases have generally been annual, so their final month lags the near-current reanalysis and station series. A monthly GitHub Actions check discovers new releases and reuses unchanged files. On-device catalog checks are limited to once daily unless **Fetch Latest** is selected. Requested country records are cached and validated against catalog hashes. Citation: Harris et al. (2020), *Version 4 of the CRU TS monthly high-resolution gridded multivariate climate dataset*, Scientific Data, [doi:10.1038/s41597-020-0453-3](https://doi.org/10.1038/s41597-020-0453-3). See the [CRU release notes](https://crudata.uea.ac.uk/cru/data/hrg/cru_ts_4.10/crucy.2606161920.v4.10/Release_Notes_CRU_CY_4.10.txt) and provider documentation; accessed 2026-10-03.

### Reanalysis

The browser requests daily mean 2 m air temperatures from Open-Meteo's Historical Weather API, explicitly selecting **ERA5-Land** throughout the record from 1950. This is an approximately 11 km gridded reanalysis estimate, not a station measurement or a city's spatial average. It should not be interpreted as resolving street-level conditions. The selected coordinates and returned grid coordinates, elevation, timezone, model, and retrieval date are retained in the cached snapshot. Location search uses Open-Meteo's [GeoNames-based geocoding API](https://open-meteo.com/en/docs/geocoding-api); coordinates can also be entered directly.

The app averages all daily means in each complete calendar month in the returned local timezone. It then subtracts that calendar month's mean over 1951-1980. All 30 January means, 30 February means, and so on must be present before the series is displayed. This removes the usual seasonal cycle without changing the reference period between locations. Months with missing daily values are omitted, not filled; smoothing does not bridge them. Radius and color use a symmetric, zero-centered range covering that location's full history. This range differs from the global series, so compare labeled values rather than colors alone.

ERA5-Land is published with a delay. The app allows six days for publication and requests only completed months. The initial history is downloaded in five-year batches and saved incrementally. Later visits reuse it when the latest eligible month is present; otherwise updates recheck the last two covered months and append new months. If the newest eligible month is still incomplete, automatic retries are limited to once per day. **Fetch Latest** forces this recent-data check, not a full historical revision. Clearing the site's stored data triggers a fresh full download.

Attribution: [Open-Meteo](https://open-meteo.com/) weather data, based on ECMWF ERA5-Land; location search by [GeoNames](https://www.geonames.org/). Open-Meteo supplies data under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Its [free API](https://open-meteo.com/en/pricing) is for non-commercial use and has request limits; a commercial deployment needs an appropriate provider plan. No API key is needed for this app's public endpoint. Documentation accessed 2026-10-03.

### Weather Stations

The station source uses NOAA's [GHCN-Monthly v4 adjusted temperature archive (QCF)](https://www.ncei.noaa.gov/pub/data/ghcn/v4/ghcnm.tavg.latest.qcf.tar.gz). These are station observations with NOAA's homogenization adjustments for discontinuities such as station moves, instrumentation, and observing practices. A station identifier represents the provider's historical series, which can incorporate earlier sources and station changes; it does not imply an unchanged physical instrument or site throughout its history. The app does not combine nearby station records or fill their gaps.

The processor retains the original monthly rows and their measurement, quality, and source flags, together with station coordinates, elevation, identifier, and source release. Values are converted from hundredths of a degree Celsius. Missing values and quality-flagged values are omitted; the documented `A` flag for an alternative adjustment is accepted. Unknown quality flags are excluded. Estimated QFE data is not used. Months must have ended before both the source release and the current date, so a cached partial month cannot become a complete observation as the clock advances. See NOAA's [format and flag definitions](https://www.ncei.noaa.gov/pub/data/ghcn/v4/readme.txt).

Only stations with all 360 usable monthly values for 1951-1980 are published in the app's catalog. Each calendar month's mean over those 30 years is subtracted from the station record. This requirement substantially narrows the full network and leaves some locations without a suitable nearby station. A published monthly mean may itself have been calculated from incomplete daily observations according to NOAA's rules; monthly completeness here does not claim complete daily sampling.

Search starts within 100 km and can be changed to 50, 250, or 500 km. Candidates are ranked by a documented application heuristic: reporting within the last 12 months adds 100 points; overall monthly completeness adds up to 20; available record length adds up to 10, capped at 100 years; distance subtracts up to 10 at the selected radius. Up to eight candidates are offered. The user's selected station is remembered for that location. Completeness is the percentage of usable months between the first and last reported months; it does not measure geographic representativeness, daily completeness, or uncertainty. Elevation is displayed when available but is not part of the ranking. Users should consider mountains, coastal exposure, and other local differences when choosing a station.

Station and reanalysis modes share the same symmetric anomaly scale, layouts, and exports. The station name identifies the actual record in the legend, and exported video legends credit NOAA and state the adjustment and baseline. Station selection never silently falls back to reanalysis. Catalogs and selected station records are cached on the device; the catalog is checked at most daily on ordinary visits, and **Fetch Latest** forces a check against the app's published catalog. The publisher updates monthly, independently of NOAA's release frequency.

Citation: Menne et al. (2018), *The Global Historical Climatology Network Monthly Temperature Dataset, Version 4*, Journal of Climate, [doi:10.1175/JCLI-D-18-0094.1](https://doi.org/10.1175/JCLI-D-18-0094.1). Dataset: [doi:10.7289/V5XW4GTH](https://doi.org/10.7289/V5XW4GTH). The exact source release is retained in each station file and the catalog.

## Sea Ice Extent

The Arctic and Antarctic series begin in November 1978. Extent measures ocean area with at least 15% ice cover; it is not ice area, ice volume, or a temperature anomaly. Both hemispheres use a linear radius scale with zero at the center and a 0-20 million km² color scale. Less ice moves inward, but the area enclosed by the spiral is not proportional to extent.

The JSON snapshots preserve NSIDC's original records and source flags. Missing months, including December 1987 and January 1988, appear as breaks. Smoothing stays within contiguous runs and does not fill gaps. Month stepping moves between available observations.

Citation: Fetterer et al. (2025), *Sea Ice Index*, Version 4, NSIDC, [doi:10.7265/a98x-0f50](https://doi.org/10.7265/a98x-0f50). Monthly Northern and Southern Hemisphere extent; accessed 2026-09-27.

## Sea Ice Volume

The Arctic PIOMAS volume series uses its v2.1 monthly total-volume table, beginning in January 1979. Values are thousands of cubic kilometers (10³ km³), not ice-covered area or anomalies. PIOMAS combines an ocean/sea-ice model with observations; total volume is a model estimate, not a direct measurement. Radius is linear from zero, with a fixed 0-60 thousand km³ radius and color range. The spiral's enclosed area is not proportional to volume.

The snapshot retains the source table unchanged. Its `-1` placeholders are omitted without shifting later months or predicting unavailable months. The updater accepts a complete history from January 1979 through the latest available month, accepts revisions, and rejects downloads that lose historical observations or shorten the record.

The [provider's March 24, 2026 notice](https://psc.apl.uw.edu/research/projects/arctic-sea-ice-volume-anomaly/) reports an interruption following the termination of its NCEP/NCAR R1 atmospheric forcing. At access on 2026-10-02, the monthly table ends in February 2026. The automated updater continues checking for provider releases; it does not append estimates from another model. See the provider's [data and citation guidance](https://psc.apl.uw.edu/research/projects/arctic-sea-ice-volume-anomaly/data/) for model methods and uncertainty.

Citation: Schweiger et al. (2011), *Uncertainty in modeled Arctic sea ice volume*, Journal of Geophysical Research, [doi:10.1029/2011JC007084](https://doi.org/10.1029/2011JC007084). Monthly PIOMAS v2.1 volume; accessed 2026-10-02.

## Greenhouse Gases

CO2 is the monthly atmospheric concentration measured at Mauna Loa, beginning in 1958. Methane is NOAA's globally averaged marine surface CH4 mole fraction in dry air, beginning in July 1983. These are concentrations, not emissions, and CO2 and methane use different units and display scales.

The methane series uses the source's `average` column, retaining its seasonal cycle, rather than its uncertainty or seasonally adjusted `trend` columns. Missing monthly means are not substituted. Recent values are preliminary and may be revised. Source comments, uncertainties, and trend values remain in the local text snapshot. Its spiral uses a 1500 ppb display offset, 200 ppb per reference-ring interval, and a fixed 1500-2100 ppb color scale. The display offset is not a preindustrial baseline or a change to the reported concentrations. Imported gaps remain gaps.

## Sea Level

The series uses CU's satellite estimates with seasonal signals retained and the source's GIA correction. The source observations are roughly ten days apart, not published monthly means. The app converts their decimal years into UTC calendar dates, including leap years, and takes the arithmetic mean of available estimates in each month. A month with one estimate keeps that observation: February 1997 uses its February 20 estimate rather than interpolation between January and March. Months without observations remain gaps, and the final source month is omitted because it may be incomplete.

These are sample means, not time-weighted integrations or independent daily measurements. The baseline is the equally weighted mean of the twelve monthly means in 1993, with at least two estimates required in each reference month. The displayed result is change in millimeters relative to 1993, not absolute ocean depth or local coastal sea level. Display precision is not an uncertainty estimate.

The radius has a -50 mm display origin so negative changes can be drawn. The color range is 0-150 mm; values beyond it retain their actual radius and label. The JSON snapshot retains the original source text and release URL. Import that bundle rather than the raw source text; its metadata identifies the exact release used.

## Local Imports

In **Data Source**, select **Fetch Latest**, load a supported local file, or drop one into the app. Land and ocean imports require the corresponding complete NOAA Climate at a Glance JSON download with source metadata and the full 1951-1980 reference period; files for the wrong surface type are rejected. Sea ice extent imports require the local JSON bundle with all twelve monthly NSIDC CSV files and hemisphere metadata, not an individual CSV. PIOMAS volume imports use the monthly text table (one year and twelve monthly volumes per row). Sea-level imports require the local JSON bundle rather than the raw text file.

Local Temperature imports accept this app's version-1 JSON snapshot schema: `source: "Open-Meteo"`, `model: "era5_land"`, `units: "celsius"`, `location`, returned `grid` metadata, sorted `records` of `{month: "YYYY-MM", mean}`, `through`, and `fetchedAt`. The complete reference period is required. Arbitrary weather CSV files and raw daily API responses are not supported imports.

With **Weather station (NOAA)** selected, imports accept the generated station JSON files under `data/weather-stations/`, including their QCF source release and original annual rows. A station import is displayed for the current session; choosing a location or reloading restores the saved location selection.

Local Temperature imports recognize the generated country JSON files under `data/country-temperature/`, with their country metadata, release, run identifier, and original monthly table, and automatically select country-average mode. Arbitrary CSV files or unlabelled country averages are not accepted. A later catalog refresh restores the publisher's record for that country. Generated station and reanalysis snapshots likewise select their matching source on import.
