"""Reduce Copernicus's monthly surface pH grids to area-weighted means."""

import argparse
from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import threading
from urllib.parse import urljoin, urlparse

import aiohttp
import numpy as np
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
import xarray as xr


PRODUCT = 'MULTIOBS_GLO_BGC_CARBON_SURFACE_MYNRT_015_008'
CATALOGUE = f'https://stac.marine.copernicus.eu/metadata/{PRODUCT}/product.stac.json'
SOURCE_URL = f'https://data.marine.copernicus.eu/product/{PRODUCT}/description'
METHOD = 'cell-area-weighted-arithmetic-mean-ph-v1'
EARTH_RADIUS_KM = 6371.0
FIRST_MONTH = '1985-01'
ROOT = Path(__file__).resolve().parents[1]
_local = threading.local()


def client():
    if not hasattr(_local, 'client'):
        _local.client = requests.Session()
        _local.client.mount('https://', HTTPAdapter(max_retries=Retry(
            total=3, backoff_factor=1, status_forcelist=[429, 500, 502, 503, 504])))
    return _local.client


def get_json(url):
    response = client().get(url, timeout=120)
    response.raise_for_status()
    return response.json()


def ordinal(month):
    if not isinstance(month, str) or not re.fullmatch(r'(19|20|21)\d{2}-(0[1-9]|1[0-2])', month):
        raise ValueError('Invalid source month.')
    year, number = map(int, month.split('-'))
    return year * 12 + number - 1


def cell_areas(latitude, longitude):
    lat, lon = np.asarray(latitude, dtype=float), np.asarray(longitude, dtype=float)
    if any(a.ndim != 1 or a.size < 2 or not np.isfinite(a).all() for a in [lat, lon]):
        raise ValueError('Invalid grid coordinates.')
    dy, dx = lat[1] - lat[0], lon[1] - lon[0]
    if dy <= 0 or dx <= 0 or not np.allclose(np.diff(lat), dy) or not np.allclose(np.diff(lon), dx):
        raise ValueError('Expected a regular ascending latitude/longitude grid.')
    if not np.isclose(lat[0] - dy / 2, -90) or not np.isclose(lat[-1] + dy / 2, 90) \
            or not np.isclose(dx * len(lon), 360) or abs(lon[0]) > 180 or abs(lon[-1]) > 360:
        raise ValueError('Grid does not cover the globe exactly once.')
    strip = np.sin(np.deg2rad(lat + dy / 2)) - np.sin(np.deg2rad(lat - dy / 2))
    return np.broadcast_to(EARTH_RADIUS_KM ** 2 * np.deg2rad(dx) * strip[:, None], (len(lat), len(lon)))


def reduce_month(values, areas):
    values = np.ma.asarray(values, dtype=np.float64).filled(np.nan)
    if values.shape != areas.shape or not np.isfinite(areas).all() or np.any(areas <= 0):
        raise ValueError('pH grid and cell areas differ.')
    valid = np.isfinite(values)
    if np.any((values[valid] < 6) | (values[valid] > 9)):
        raise ValueError('Invalid pH over valid ocean cells.')
    area = float(areas[valid].sum())
    # Missing land/ice cells are not zeros. Reject small regional or damaged downloads.
    if not 0.5 <= area / float(areas.sum()) <= 0.8:
        raise ValueError('Unexpected valid ocean coverage.')
    mean = float(np.sum(values[valid] * areas[valid]) / area)
    if not 7.95 < mean < 8.5:
        raise ValueError('Unexpected global surface pH.')
    return round(mean, 6), round(area, 1)


def discover_sources():
    candidates = {'my': [], 'nrt': []}
    for link in get_json(CATALOGUE)['links']:
        if link.get('rel') != 'item':
            continue
        match = re.fullmatch(r'cmems_obs-mob_glo_bgc-car_(my|nrt)_irr-i_(\d{6})/dataset.stac.json', link['href'])
        if match:
            candidates[match[1]].append((match[2], urljoin(CATALOGUE, link['href'])))
    if not all(candidates.values()):
        raise ValueError('Historical or near-real-time pH dataset is missing from the catalogue.')
    sources = {}
    for kind, entries in candidates.items():
        version, url = max(entries)
        item = get_json(url)
        asset = item['assets']['timeChunked']
        store = asset['href']
        parsed = urlparse(store)
        if parsed.scheme != 'https' or not (parsed.hostname or '').endswith('.cloudferro.com') \
                or f'/{PRODUCT}/' not in parsed.path or asset['type'] != 'application/vnd+zarr':
            raise ValueError('Unexpected published pH data service.')
        sources[kind] = {'dataset': f'cmems_obs-mob_glo_bgc-car_{kind}_irr-i',
                         'version': version, 'store': store, 'catalogue': url}
    return sources


def open_source(source):
    metadata = get_json(source['store'] + '/.zmetadata')['metadata']
    shape = metadata['ph/.zarray']
    if shape['chunks'] != [1, 720, 1440] or shape['shape'][1:] != [720, 1440] \
            or shape.get('dimension_separator', '.') != '.':
        raise ValueError('Published pH chunk layout changed; review the updater before replacing data.')
    dataset = xr.open_zarr(source['store'], consolidated=True, chunks=None, zarr_format=2,
                           storage_options={'client_kwargs': {'timeout': aiohttp.ClientTimeout(total=120)}})
    try:
        ph = dataset['ph']
        if ph.dims != ('time', 'latitude', 'longitude') or ph.attrs.get('units') != '1' \
                or ph.attrs.get('standard_name') != 'sea_water_ph_reported_on_total_scale':
            raise ValueError('Wrong pH variable, dimensions, units or scale.')
        lat, lon = dataset.latitude.values, dataset.longitude.values
        areas = cell_areas(lat, lon)
        if not np.allclose(np.diff(lat), 0.25) or not np.allclose(np.diff(lon), 0.25):
            raise ValueError('Expected the native 0.25-degree grid, not a downsampled product.')
        digest = hashlib.sha256()
        for coordinate in [lat, lon]:
            digest.update(np.asarray(coordinate, dtype='<f8').tobytes())
        source['gridSha256'] = digest.hexdigest()
        months = [np.datetime_as_string(time, unit='M') for time in dataset.time.values]
        numbers = [ordinal(month) for month in months]
        if not numbers or any(b != a + 1 for a, b in zip(numbers, numbers[1:])):
            raise ValueError('Duplicate, unordered or missing source months.')
        return dataset, months, areas
    except Exception:
        dataset.close()
        raise


def choose_months(months_by_source, current_month):
    chosen = {}
    # Reprocessed history takes precedence over provisional months in any overlap.
    for kind in ['nrt', 'my']:
        for index, month in enumerate(months_by_source[kind]):
            if ordinal(FIRST_MONTH) <= ordinal(month) < ordinal(current_month):
                chosen[month] = (kind, index)
    months = sorted(chosen)
    numbers = [ordinal(month) for month in months]
    if not numbers or months[0] != FIRST_MONTH or any(b != a + 1 for a, b in zip(numbers, numbers[1:])):
        raise ValueError('pH history is incomplete or has a gap at the historical/recent join.')
    return {month: chosen[month] for month in months}


def fingerprint(url):
    response = client().head(url, timeout=120)
    response.raise_for_status()
    etag = response.headers.get('ETag')
    if not etag:
        raise ValueError('Source does not publish a monthly ETag; cannot safely reuse previous means.')
    return etag


def validate_snapshot(snapshot, current_month):
    if snapshot.get('version') != 1 or snapshot.get('source') != 'Copernicus Marine / LSCE' \
            or snapshot.get('product') != PRODUCT or snapshot.get('method') != METHOD \
            or snapshot.get('units') != 'pH' or snapshot.get('scale') != 'total':
        raise ValueError('Unsupported pH snapshot metadata.')
    records = snapshot.get('records', [])
    if not records or records[0].get('month') != FIRST_MONTH or snapshot.get('through') != records[-1].get('month'):
        raise ValueError('Incomplete pH snapshot.')
    previous = ordinal(FIRST_MONTH) - 1
    for record in records:
        number = ordinal(record['month'])
        if number != previous + 1 or number >= ordinal(current_month) \
                or record.get('product') not in ['my', 'nrt'] or not isinstance(record.get('etag'), str) \
                or not record['etag'] or type(record.get('ph')) not in [int, float] \
                or not 7.95 < record['ph'] < 8.5 or type(record.get('validAreaKm2')) not in [int, float] \
                or not 250e6 < record['validAreaKm2'] < 410e6:
            raise ValueError('Invalid pH month, value, coverage or provenance.')
        previous = number


def validate_replacement(previous, candidate, current_month):
    validate_snapshot(candidate, current_month)
    if previous is None:
        return
    validate_snapshot(previous, current_month)
    if ordinal(candidate['through']) < ordinal(previous['through']):
        raise ValueError('Source has lost previously published months.')
    by_month = {record['month']: record for record in candidate['records']}
    if any(record['product'] == 'my' and by_month[record['month']]['product'] != 'my'
           for record in previous['records']):
        raise ValueError('Source would replace reprocessed history with provisional estimates.')


def save_snapshot(destination, payload):
    text = json.dumps(payload, indent=2, allow_nan=False) + '\n'
    if destination.exists() and destination.read_text(encoding='utf-8') == text:
        return False
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix('.json.tmp')
    try:
        temporary.write_text(text, encoding='utf-8')
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)
    return True


def update(destination, workers=4):
    current_month = datetime.now(timezone.utc).strftime('%Y-%m')
    previous = json.loads(destination.read_text(encoding='utf-8')) if destination.exists() else None
    if previous is not None:
        validate_snapshot(previous, current_month)
    sources = discover_sources()
    with ExitStack() as stack:
        datasets, months, areas = {}, {}, {}
        for kind, source in sources.items():
            datasets[kind], months[kind], areas[kind] = open_source(source)
            stack.callback(datasets[kind].close)
        if sources['my']['gridSha256'] != sources['nrt']['gridSha256']:
            raise ValueError('Historical and recent pH grids differ.')
        chosen = choose_months(months, current_month)
        cached = {record['month']: record for record in previous['records']} if previous else {}

        def process(item):
            month, (kind, index) = item
            source = sources[kind]
            url = f"{source['store']}/ph/{index}.0.0"
            etag = fingerprint(url)
            old_source = previous.get('sources', {}).get(kind) if previous else None
            record = cached.get(month)
            if old_source == source and record and record['product'] == kind and record['etag'] == etag:
                return record, False
            values = datasets[kind]['ph'].isel(time=index).values
            mean, area = reduce_month(values, areas[kind])
            if fingerprint(url) != etag:
                raise ValueError('Source changed while being read; retry after publication finishes.')
            return {'month': month, 'ph': mean, 'validAreaKm2': area, 'product': kind, 'etag': etag}, True

        print(f'Checking {len(chosen)} monthly pH grids...', flush=True)
        results = []
        with ThreadPoolExecutor(max_workers=workers) as pool:
            for index, result in enumerate(pool.map(process, chosen.items()), 1):
                results.append(result)
                if index % 60 == 0:
                    print(f'  {index}/{len(chosen)} months checked', flush=True)
    records = [record for record, downloaded in results]
    payload = {'version': 1, 'source': 'Copernicus Marine / LSCE', 'product': PRODUCT,
               'sourceUrl': SOURCE_URL, 'doi': '10.48670/moi-00047', 'units': 'pH', 'scale': 'total',
               'method': METHOD, 'sources': sources, 'through': records[-1]['month'], 'records': records}
    validate_replacement(previous, payload, current_month)
    changed = save_snapshot(destination, payload)
    downloaded = sum(downloaded for record, downloaded in results)
    print(f"Ocean surface pH: {len(records)} months through {payload['through']}; "
          f"{downloaded} grids downloaded; {'snapshot updated' if changed else 'unchanged'}.")


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'data/ocean-ph.json')
    parser.add_argument('--workers', type=int, choices=range(1, 9), default=4)
    args = parser.parse_args()
    update(args.output, args.workers)
