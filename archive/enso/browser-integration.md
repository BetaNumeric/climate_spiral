# Former Browser Integration

These snippets preserve the inactive ENSO integration. Adjust file paths when restoring them. The active app does not load this document or the archived parser.

## Import and Registration

```js
import { ENSO_DATA_URL, ENSO_TICKS, parseENSOData, ensoAnomalyToRadius } from './enso-data.mjs';
```

Add this entry to `DATASET_CONFIG`:

```js
enso: {
    id: 'enso',
    title: 'El Ni\u00f1o / La Ni\u00f1a',
    metricLabel: 'Relative Ni\u00f1o 3.4',
    localPath: 'data/Rnino34.ascii.txt',
    remoteUrl: ENSO_DATA_URL,
    sourceLabel: 'NOAA CPC',
    sourceHref: 'https://www.cpc.ncep.noaa.gov/data/indices/',
    supportsInterpolation: false,
    preserveMonthlyGaps: true,
    parse: parseENSOData,
    description: 'Monthly relative Ni\u00f1o 3.4 (ERSSTv6), in \u00b0C relative to 1991-2020, adjusted for tropical-wide warming. Not the 3-month RONI or an official El Ni\u00f1o/La Ni\u00f1a classification. Recent values may be revised. Source: NOAA CPC.'
},
```

## Radius and Reference Values

In `getUnscaledSpiralRadius`:

```js
if (currentDatasetKey === 'enso') return ensoAnomalyToRadius(value);
```

In `getOuterRingValue`:

```js
if (currentDatasetKey === 'enso') return Math.max(maxValue, ENSO_TICKS.at(-1));
```

In `getReferenceValues`, select `ENSO_TICKS` for the ENSO dataset. Its temperature formatting uses the existing Celsius formatter.

## Legend

In `updateLegendLabels`, use:

```js
ENSO_TICKS.map(value => (value > 0 ? '+' : '') + value + '\u00b0C')
```

Toggle the legend class and restore its CSS rule:

```js
document.querySelector('.legend').classList.toggle('enso', currentDatasetKey === 'enso');
```

```css
.legend.enso { background: linear-gradient(to right, #0000ff, #ffffff 50%, #ff0000); }
```

In `updateTimelineState`, calculate the marker position with:

```js
percent = (currentDisplayValue - ENSO_TICKS[0]) / (ENSO_TICKS.at(-1) - ENSO_TICKS[0]) * 100;
```

In `getVideoLegendStops`:

```js
if (currentDatasetKey === 'enso') return [[0, '#0000ff'], [0.5, '#ffffff'], [1, '#ff0000']];
```

## Data Colors

In `createSpiral`, select this color mapping for ENSO:

```js
c.lerpColors(CONFIG.colors.neutral, colorValue < 0 ? CONFIG.colors.cold : CONFIG.colors.hot,
    Math.min(1, Math.abs(colorValue) / ENSO_TICKS.at(-1)));
```

The existing monthly-gap handling and layout interpolation can then be reused.
