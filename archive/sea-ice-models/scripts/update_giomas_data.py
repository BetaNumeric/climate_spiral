"""Reduce public GIOMAS monthly effective thickness to hemispheric volumes."""

import argparse
from datetime import datetime, timezone
import gzip
import hashlib
from html.parser import HTMLParser
import io
import json
from pathlib import Path
import re
from urllib.parse import urljoin, urlparse

import netCDF4
import numpy as np
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry


BASE_URL = 'https://pscfiles.apl.washington.edu/zhang/Global_seaice/'
SOURCE_URL = 'https://psc.apl.uw.edu/data/global-sea-ice-giomas-data-sets/'
METHOD = 'monthly-mean-effective-thickness-area-v1'
GRID_SHAPE = (276, 360)
ROOT = Path(__file__).resolve().parents[1]
MAX_BYTES = 16 * 1024 * 1024


class ReleaseLinks(HTMLParser):
    def __init__(self):
        super().__init__()
        self.years = set()

    def handle_starttag(self, tag, attrs):
        if tag != 'a':
            return
        href = dict(attrs).get('href', '')
        url = urlparse(urljoin(BASE_URL, href))
        match = re.fullmatch(r'/zhang/Global_seaice/heff\.H(\d{4})\.nc\.gz', url.path)
        if match and url.scheme == 'https' and url.netloc == urlparse(BASE_URL).netloc:
            self.years.add(int(match[1]))


def available_years(html, now=None):
    links = ReleaseLinks()
    links.feed(html)
    now = now or datetime.now(timezone.utc)
    # Only completed annual NetCDF releases; raw current-year fields can be partial months.
    years = sorted(year for year in links.years if 1979 <= year < now.year)
    if not years or years != list(range(1979, years[-1] + 1)):
        raise ValueError('GIOMAS annual release history is incomplete.')
    return years


def atomic_bytes(path, content):
    if path.exists() and path.read_bytes() == content:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    try:
        temporary.write_bytes(content)
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def atomic_json(path, payload):
    atomic_bytes(path, (json.dumps(payload, indent=2, allow_nan=False) + '\n').encode('utf-8'))


def session():
    client = requests.Session()
    client.mount('https://', HTTPAdapter(max_retries=Retry(
        total=3, backoff_factor=1, status_forcelist=[429, 500, 502, 503, 504])))
    return client


def download_year(client, year, cache):
    filename = f'heff.H{year}.nc.gz'
    path = cache / filename
    validators = path.with_suffix('.http.json')
    headers = {}
    if path.exists() and validators.exists():
        stored = json.loads(validators.read_text(encoding='utf-8'))
        for key in ['ETag', 'Last-Modified']:
            if stored.get(key):
                headers['If-None-Match' if key == 'ETag' else 'If-Modified-Since'] = stored[key]
    with client.get(BASE_URL + filename, headers=headers, stream=True, timeout=(20, 90)) as response:
        if response.status_code == 304:
            if not path.exists():
                raise ValueError('Source returned 304 without a cached file.')
            return path.read_bytes()
        response.raise_for_status()
        buffer = io.BytesIO()
        for chunk in response.iter_content(64 * 1024):
            buffer.write(chunk)
            if buffer.tell() > MAX_BYTES:
                raise ValueError('Unexpectedly large GIOMAS download.')
        content = buffer.getvalue()
        atomic_bytes(path, content)
        atomic_json(validators, {key: response.headers[key] for key in ['ETag', 'Last-Modified']
                                 if key in response.headers})
        return content


def number_array(value):
    return np.ma.asarray(value, dtype=np.float64).filled(np.nan)


def grid_weights(dx, dy, levels):
    dx, dy, levels = [number_array(value) for value in [dx, dy, levels]]
    if dx.ndim != 2 or any(value.shape != dx.shape for value in [dy, levels]):
        raise ValueError('Inconsistent GIOMAS grid dimensions.')
    if not all(np.isfinite(value).all() for value in [dx, dy, levels]):
        raise ValueError('Missing GIOMAS grid metrics.')
    if np.any(levels < 0) or np.any(levels > 40) or np.any(levels != np.floor(levels)):
        raise ValueError('Invalid GIOMAS ocean mask.')
    ocean = levels > 0
    if not ocean.any() or np.any(dx[ocean] <= 0) or np.any(dy[ocean] <= 0):
        raise ValueError('Invalid GIOMAS grid-cell lengths.')
    return np.where(ocean, dx * dy, 0)  # Source lengths are km, so areas are km2.


def hemispheric_volumes(thickness, area, latitude):
    h, area, latitude = [number_array(value) for value in [thickness, area, latitude]]
    if area.ndim != 2 or any(value.shape != area.shape for value in [h, latitude]):
        raise ValueError('GIOMAS fields and grid dimensions differ.')
    if not np.isfinite(area).all() or np.any(area < 0) or not np.isfinite(latitude).all() \
            or np.any(np.abs(latitude) > 90):
        raise ValueError('Invalid integration grid.')
    ocean = area > 0
    if not np.isfinite(h[ocean]).all() or np.any(h[ocean] < 0) or np.any(h[ocean] > 100):
        raise ValueError('Missing or invalid effective thickness over ocean.')
    volume = np.zeros(area.shape)
    # heff is already volume per grid-cell area: applying concentration again would undercount.
    volume[ocean] = h[ocean] * area[ocean] / 1e6  # m * km2 -> thousands of km3.
    return {'north': float(volume[latitude >= 0].sum()),
            'south': float(volume[latitude < 0].sum())}


def grid_fingerprint(grid):
    digest = hashlib.sha256()
    for name in ['latitude', 'longitude', 'area']:
        digest.update(np.asarray(grid[name], dtype='<f8').tobytes())
    return digest.hexdigest()


def process_year(content, year):
    with gzip.GzipFile(fileobj=io.BytesIO(content)) as compressed:
        raw = compressed.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES:
        raise ValueError('Unexpectedly large decompressed GIOMAS file.')
    with netCDF4.Dataset('giomas.nc', memory=raw) as data:
        if 'GIOMAS' not in getattr(data, 'Model', ''):
            raise ValueError('Source is not identified as GIOMAS.')
        if data['year'].shape != () or data['year'][...].item() != year \
                or not np.array_equal(data['month'][:], np.arange(1, 13)):
            raise ValueError('Source year or complete monthly coverage does not match the release.')
        h = data['heff']
        if h.dimensions != ('n', 'j', 'i') or h.shape != (12, *GRID_SHAPE) \
                or getattr(h, 'units', '') != 'm' \
                or 'monthly mean' not in getattr(h, 'long_name', '').lower():
            raise ValueError('Unexpected GIOMAS thickness units, averaging, or dimensions.')
        for name in ['lat_scaler', 'lon_scaler', 'dxt', 'dyt', 'kmt']:
            if data[name].dimensions != ('j', 'i') or data[name].shape != GRID_SHAPE:
                raise ValueError('Unexpected GIOMAS native grid.')
        for name in ['dxt', 'dyt']:
            if '(km)' not in getattr(data[name], 'long_name', ''):
                raise ValueError('Unexpected grid-cell length units.')
        grid = {'latitude': number_array(data['lat_scaler'][:]),
                'longitude': number_array(data['lon_scaler'][:]),
                'area': grid_weights(data['dxt'][:], data['dyt'][:], data['kmt'][:])}
        if not all(np.isfinite(value).all() for value in grid.values()) \
                or not 3e8 < grid['area'].sum() < 4e8:
            raise ValueError('Native grid does not cover the global ocean once.')
        records = []
        for month in range(1, 13):
            volumes = hemispheric_volumes(h[month - 1], grid['area'], grid['latitude'])
            records.append({'year': year, 'month': month,
                            **{key: round(value, 6) for key, value in volumes.items()}})
    return records, grid_fingerprint(grid)


def validate_snapshot(payload):
    if not isinstance(payload, dict) or payload.get('version') != 1 \
            or payload.get('source') != 'PSC GIOMAS' or payload.get('method') != METHOD \
            or payload.get('units') != '1000 km3' or payload.get('sourceUrl') != SOURCE_URL:
        raise ValueError('Invalid GIOMAS snapshot metadata.')
    grid = payload.get('grid', {})
    if grid.get('shape') != list(GRID_SHAPE) or not re.fullmatch(r'[a-f0-9]{64}', grid.get('sha256', '')):
        raise ValueError('Invalid GIOMAS grid provenance.')
    records, releases = payload.get('records'), payload.get('releases')
    if not isinstance(records, list) or not records or len(records) % 12 \
            or not isinstance(releases, list) or len(releases) != len(records) // 12:
        raise ValueError('GIOMAS requires complete annual releases.')
    for index, row in enumerate(records):
        if not isinstance(row, dict) or type(row.get('year')) is not int \
                or type(row.get('month')) is not int \
                or (row['year'], row['month']) != (1979 + index // 12, index % 12 + 1):
            raise ValueError('GIOMAS history must be continuous from January 1979.')
        for key in ['north', 'south']:
            value = row.get(key)
            if type(value) not in [int, float] or not np.isfinite(value) or not 0 <= value <= 100:
                raise ValueError('Invalid hemispheric volume.')
    for index, release in enumerate(releases):
        year = 1979 + index
        if not isinstance(release, dict) or release.get('year') != year \
                or release.get('url') != BASE_URL + f'heff.H{year}.nc.gz' \
                or not re.fullmatch(r'[a-f0-9]{64}', release.get('sha256', '')):
            raise ValueError('Invalid annual source provenance.')
    return records


def publish(path, payload):
    records = validate_snapshot(payload)
    if path.exists():
        old = validate_snapshot(json.loads(path.read_text(encoding='utf-8')))
        if len(records) < len(old):
            raise ValueError('GIOMAS release would shorten the local history.')
    atomic_json(path, payload)


def update(client, cache, output, now=None):
    response = client.get(BASE_URL, timeout=(20, 60))
    response.raise_for_status()
    years = available_years(response.text, now)
    records, releases = [], []
    fingerprint = None
    for year in years:
        content = download_year(client, year, cache)
        annual, digest = process_year(content, year)
        if fingerprint is not None and digest != fingerprint:
            raise ValueError('GIOMAS native grid changed between annual releases.')
        fingerprint = digest
        records.extend(annual)
        releases.append({'year': year, 'url': BASE_URL + f'heff.H{year}.nc.gz',
                         'sha256': hashlib.sha256(content).hexdigest()})
        print(f'Validated GIOMAS {year}', flush=True)
    payload = {'version': 1, 'source': 'PSC GIOMAS', 'sourceUrl': SOURCE_URL,
               'method': METHOD, 'units': '1000 km3',
               'grid': {'shape': list(GRID_SHAPE), 'sha256': fingerprint},
               'releases': releases, 'records': records}
    publish(output, payload)
    print(f'GIOMAS: {len(records)} months in each hemisphere, through {years[-1]}-12.', flush=True)
    return payload


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache', type=Path, default=ROOT / '.cache/giomas')
    parser.add_argument('--output', type=Path, default=ROOT / 'data/giomas-sea-ice-volume.json')
    args = parser.parse_args()
    with session() as client:
        update(client, args.cache, args.output)


if __name__ == '__main__':
    main()
