# Data Sources and Methods

The spiral shows monthly measurements and model estimates. One turn represents a calendar year; radius and color encode the selected measurement. Different datasets use different units and display scales, so equal radii or colors across datasets do not imply equal climate effects.

| Dataset | Source | Local snapshot | Measurement |
| --- | --- | --- | --- |
| Global Temperature | [NASA GISTEMP v4](https://data.giss.nasa.gov/gistemp/), [monthly table](https://data.giss.nasa.gov/gistemp/tabledata_v4/GLB.Ts+dSST.txt) | [`GLB.Ts+dSST.txt`](../data/GLB.Ts+dSST.txt) | Combined land and ocean temperature anomaly, °C relative to 1951-1980 |
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

## Sea Ice Extent

The Arctic and Antarctic series begin in November 1978. Extent measures ocean area with at least 15% ice cover; it is not ice area, ice volume, or a temperature anomaly. Both hemispheres use a linear radius scale with zero at the center and a 0-20 million km² color scale. Less ice moves inward, but the area enclosed by the spiral is not proportional to extent.

The JSON snapshots preserve NSIDC's original records and source flags. Missing months, including December 1987 and January 1988, appear as breaks. Smoothing stays within contiguous runs and does not fill gaps. Month stepping moves between available observations.

Citation: Fetterer et al. (2025), *Sea Ice Index*, Version 4, NSIDC, [doi:10.7265/a98x-0f50](https://doi.org/10.7265/a98x-0f50). Monthly Northern and Southern Hemisphere extent; accessed 2026-09-27.

## Sea Ice Volume

The Arctic volume series uses the PIOMAS v2.1 monthly total-volume table, beginning in January 1979. Values are thousands of cubic kilometers (10³ km³), not ice-covered area or anomalies. PIOMAS combines an ocean/sea-ice model with observations; total volume is a model estimate, not a direct measurement. Radius is linear from zero, and the color scale is fixed at 0-40 thousand km³. The spiral's enclosed area is not proportional to volume.

The snapshot retains the source table unchanged. Its `-1` placeholders are omitted without shifting later months or predicting unavailable months. The updater accepts a complete history from January 1979 through the latest available month, accepts revisions, and rejects downloads that lose historical observations or shorten the record.

The [provider's March 24, 2026 notice](https://psc.apl.uw.edu/research/projects/arctic-sea-ice-volume-anomaly/) reports an interruption following the termination of its NCEP/NCAR R1 atmospheric forcing. At access on 2026-10-02, the monthly table ends in February 2026. The automated updater continues checking for provider releases; it does not append estimates from another model. See the provider's [data and citation guidance](https://psc.apl.uw.edu/research/projects/arctic-sea-ice-volume-anomaly/data/) for model methods and uncertainty.

Citation: Schweiger et al. (2011), *Uncertainty in modeled Arctic sea ice volume*, Journal of Geophysical Research, [doi:10.1029/2011JC007084](https://doi.org/10.1029/2011JC007084). Monthly PIOMAS v2.1 volume; accessed 2026-10-02.

### Optional ORAS5 Volume

The ORAS5 updater estimates Arctic and Antarctic sea ice volume by integrating monthly thickness times monthly ice concentration over native-grid ocean cell areas. These are model-based estimates, not direct observations or exact monthly mean volumes: multiplying monthly averages cannot recover within-month covariance. They remain separate from PIOMAS and use the same volume display scale.

The optional `data/oras5-sea-ice-volume.json` snapshot records both hemispheres, source/product metadata, units, method, and grid fingerprint. The browser enables the two choices only after this file has been published and validated. The consolidated product covers 1958-2014; the operational product from 2015 uses different forcing. See [ORAS5 setup and methods](oras5-setup.md) for the formula, source citations, limitations, and download instructions. ORAS5 imports use that JSON bundle; **Fetch Latest** refreshes the published bundle rather than accessing Copernicus directly.

## Greenhouse Gases

CO2 is the monthly atmospheric concentration measured at Mauna Loa, beginning in 1958. Methane is NOAA's globally averaged marine surface CH4 mole fraction in dry air, beginning in July 1983. These are concentrations, not emissions, and CO2 and methane use different units and display scales.

The methane series uses the source's `average` column, retaining its seasonal cycle, rather than its uncertainty or seasonally adjusted `trend` columns. Missing monthly means are not substituted. Recent values are preliminary and may be revised. Source comments, uncertainties, and trend values remain in the local text snapshot. Its spiral uses a 1500 ppb display offset, 200 ppb per reference-ring interval, and a fixed 1500-2100 ppb color scale. The display offset is not a preindustrial baseline or a change to the reported concentrations. Imported gaps remain gaps.

## Sea Level

The series uses CU's satellite estimates with seasonal signals retained and the source's GIA correction. The source observations are roughly ten days apart, not published monthly means. The app converts their decimal years into UTC calendar dates, including leap years, and takes the arithmetic mean of available estimates in each month. A month with one estimate keeps that observation: February 1997 uses its February 20 estimate rather than interpolation between January and March. Months without observations remain gaps, and the final source month is omitted because it may be incomplete.

These are sample means, not time-weighted integrations or independent daily measurements. The baseline is the equally weighted mean of the twelve monthly means in 1993, with at least two estimates required in each reference month. The displayed result is change in millimeters relative to 1993, not absolute ocean depth or local coastal sea level. Display precision is not an uncertainty estimate.

The radius has a -50 mm display origin so negative changes can be drawn. The color range is 0-150 mm; values beyond it retain their actual radius and label. The JSON snapshot retains the original source text and release URL. Import that bundle rather than the raw source text; its metadata identifies the exact release used.

## Local Imports

In **Data Source**, select **Fetch Latest**, load a supported local file, or drop one into the app. Land and ocean imports require the corresponding complete NOAA Climate at a Glance JSON download with source metadata and the full 1951-1980 reference period; files for the wrong surface type are rejected. Sea ice extent imports require the local JSON bundle with all twelve monthly NSIDC CSV files and hemisphere metadata, not an individual CSV. Arctic volume imports use the PIOMAS monthly text table (one year and twelve monthly volumes per row). Sea-level imports require the local JSON bundle rather than the raw text file.
