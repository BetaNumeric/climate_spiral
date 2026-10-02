"""Reduce native ORAS5 monthly ice fields to hemispheric volume estimates."""

import argparse
from collections import defaultdict
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import tempfile
import zipfile

import netCDF4
import numpy as np
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry


ROOT = Path(__file__).resolve().parents[1]
CATALOGUE = 'https://cds.climate.copernicus.eu/api/catalogue/v1/collections/reanalysis-oras5'
SOURCE_URL = 'https://cds.climate.copernicus.eu/datasets/reanalysis-oras5'
GRID_URL = ('https://icdc.cen.uni-hamburg.de/thredds/dodsC/ftpthredds/'
            'EASYInit/oras5/ORCA025/mesh/mesh_mask.nc')
SAMPLE_ROOT = ('https://icdc.cen.uni-hamburg.de/thredds/fileServer/ftpthredds/'
               'EASYInit/oras5/ORCA025/')
GRID_SHAPE = (1021, 1442)
METHOD = 'monthly-mean-thickness-concentration-area-v1'
VARIABLES = {'iicethic': 'sea_ice_thickness', 'ileadfra': 'sea_ice_concentration'}


def session():
    client = requests.Session()
    client.mount('https://', HTTPAdapter(max_retries=Retry(
        total=3, backoff_factor=1, status_forcelist=[429, 500, 502, 503, 504])))
    return client


def atomic_json(path, payload):
    text = json.dumps(payload, indent=2, allow_nan=False) + '\n'
    if path.exists() and path.read_text(encoding='utf-8') == text:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    try:
        temporary.write_text(text, encoding='utf-8')
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def number_array(value):
    return np.ma.asarray(value, dtype=np.float64).filled(np.nan)


def grid_weights(e1t, e2t, wet, unique):
    arrays = [number_array(value) for value in [e1t, e2t, wet, unique]]
    if any(array.shape != arrays[0].shape for array in arrays) or arrays[0].ndim != 2:
        raise ValueError('Inconsistent grid dimensions.')
    e1t, e2t, wet, unique = arrays
    if not all(np.isfinite(value).all() for value in arrays):
        raise ValueError('Grid contains missing values.')
    if not np.isin(wet, [0, 1]).all() or not np.isin(unique, [0, 1]).all():
        raise ValueError('Invalid ocean or overlap mask.')
    ocean = (wet == 1) & (unique == 1)
    if not ocean.any() or np.any(e1t[ocean] <= 0) or np.any(e2t[ocean] <= 0):
        raise ValueError('Invalid grid-cell dimensions.')
    # tmaskutil excludes periodic and north-fold copies of physical grid cells.
    return np.where(ocean, e1t * e2t, 0)


def grid_fingerprint(grid):
    digest = hashlib.sha256()
    for name in ['latitude', 'longitude', 'area']:
        digest.update(np.asarray(grid[name], dtype='<f8').tobytes())
    return digest.hexdigest()


def load_grid(cache):
    path = cache / 'grid.npz'
    if path.exists():
        with np.load(path, allow_pickle=False) as stored:
            grid = {name: stored[name] for name in ['latitude', 'longitude', 'area']}
    else:
        print('Downloading native grid surface coordinates, cell dimensions and masks...', flush=True)
        with netCDF4.Dataset(GRID_URL) as dataset:
            grid = {
                'latitude': number_array(dataset['nav_lat'][:]),
                'longitude': number_array(dataset['nav_lon'][:]),
                'area': grid_weights(dataset['e1t'][0], dataset['e2t'][0],
                                     dataset['tmask'][0, 0], dataset['tmaskutil'][0]),
            }
    if any(array.shape != GRID_SHAPE or not np.isfinite(array).all() for array in grid.values()):
        raise ValueError('Unexpected native ORCA025 grid.')
    if np.any(np.abs(grid['latitude']) > 90) or np.any(grid['area'] < 0):
        raise ValueError('Invalid native grid coordinates or areas.')
    if not 3e14 < grid['area'].sum() < 4e14:
        raise ValueError('Native grid does not cover the global ocean once.')
    if not path.exists():
        cache.mkdir(parents=True, exist_ok=True)
        with path.with_suffix('.tmp').open('wb') as handle:
            np.savez_compressed(handle, **grid)
        path.with_suffix('.tmp').replace(path)
    return grid


def hemispheric_volumes(thickness, concentration, area, latitude):
    h, c, area, latitude = [number_array(value) for value in [thickness, concentration, area, latitude]]
    if any(value.shape != area.shape for value in [h, c, latitude]) or area.ndim != 2:
        raise ValueError('Ice fields and grid dimensions differ.')
    if not np.isfinite(area).all() or np.any(area < 0) or not np.isfinite(latitude).all():
        raise ValueError('Invalid integration grid.')
    ocean = area > 0
    if not np.isfinite(c[ocean]).all() or np.any(c[ocean] < -1e-6) or np.any(c[ocean] > 1 + 1e-6):
        raise ValueError('Missing or invalid concentration over ocean cells.')
    c = np.clip(c, 0, 1)
    ice = ocean & (c > 0)
    if not np.isfinite(h[ice]).all() or np.any(h[ice] < 0) or np.any(h[ice] > 100):
        raise ValueError('Missing or invalid thickness where ice is present.')
    volume = np.zeros(area.shape, dtype=np.float64)
    volume[ice] = h[ice] * c[ice] * area[ice]
    # Source metres and square metres become thousands of cubic kilometres.
    return {'north': float(volume[latitude >= 0].sum() / 1e12),
            'south': float(volume[latitude < 0].sum() / 1e12)}


def read_fields(dataset, grid, expected, fields):
    if 'ORAS5' not in getattr(dataset, 'source', ''):
        raise ValueError('Input is not identified as ORAS5.')
    for coordinate, key in [('nav_lat', 'latitude'), ('nav_lon', 'longitude')]:
        values = number_array(dataset[coordinate][:])
        if values.shape != grid[key].shape:
            raise ValueError('Source is not on the native grid.')
        difference = values - grid[key]
        if key == 'longitude':
            difference = (difference + 180) % 360 - 180
        if not np.isfinite(difference).all() or np.any(np.abs(difference) > 1e-4):
            raise ValueError('Source coordinates do not match the area grid.')
    time = dataset['time_counter']
    dates = netCDF4.num2date(time[:], time.units, calendar=getattr(time, 'calendar', 'standard'))
    for name in VARIABLES:
        if name not in dataset.variables:
            continue
        variable = dataset[name]
        units = getattr(variable, 'units', '').strip().lower()
        allowed_units = ['m', 'metre', 'meter'] if name == 'iicethic' else ['fraction', '1', 'dimensionless']
        if units not in allowed_units or variable.dimensions != ('time_counter', 'y', 'x'):
            raise ValueError('Unexpected units or dimensions for ' + name)
        for index, date in enumerate(dates):
            month = (date.year, date.month)
            if month not in expected or name in fields[month]:
                raise ValueError('Unexpected or duplicate month in downloaded fields.')
            fields[month][name] = number_array(variable[index])


def process_download(path, grid, expected):
    fields = defaultdict(dict)
    if zipfile.is_zipfile(path):
        with zipfile.ZipFile(path) as archive:
            for entry in archive.infolist():
                if entry.is_dir() or not entry.filename.lower().endswith('.nc'):
                    continue
                if entry.file_size > 512 * 1024 * 1024:
                    raise ValueError('Unexpectedly large source NetCDF file.')
                # Read in memory so archive paths never become filesystem paths.
                with netCDF4.Dataset('oras5.nc', memory=archive.read(entry)) as dataset:
                    read_fields(dataset, grid, expected, fields)
    else:
        with netCDF4.Dataset(path) as dataset:
            read_fields(dataset, grid, expected, fields)
    if set(fields) != set(expected) or any(set(value) != set(VARIABLES) for value in fields.values()):
        raise ValueError('Download does not contain both ice fields for every requested month.')
    records = []
    for (year, month), values in sorted(fields.items()):
        volumes = hemispheric_volumes(values['iicethic'], values['ileadfra'], grid['area'], grid['latitude'])
        records.append({'year': year, 'month': month, 'product': product_type(year),
                        **{key: round(value, 6) for key, value in volumes.items()}})
    validate_records(records)
    return records


def product_type(year):
    return 'consolidated' if year <= 2014 else 'operational'


def available_months(catalogue, constraints, start_year, now=None):
    latest = catalogue['extent']['temporal']['interval'][0][1]
    if not latest:
        raise ValueError('Catalogue does not specify its latest month.')
    endpoint = datetime.fromisoformat(latest.replace('Z', '+00:00'))
    now = now or datetime.now(timezone.utc)
    available = {name: set() for name in VARIABLES.values()}
    for constraint in constraints:
        if 'single_level' not in constraint.get('vertical_resolution', []):
            continue
        for variable in available:
            if variable not in constraint.get('variable', []):
                continue
            for year in map(int, constraint['year']):
                if year < start_year or product_type(year) not in constraint['product_type']:
                    continue
                for month in map(int, constraint['month']):
                    date = (year, month)
                    if date <= (endpoint.year, endpoint.month) and date < (now.year, now.month):
                        available[variable].add(date)
    dates = sorted(set.intersection(*available.values()))
    ordinals = [year * 12 + month - 1 for year, month in dates]
    if not dates or dates[0] != (start_year, 1) or any(b != a + 1 for a, b in zip(ordinals, ordinals[1:])):
        raise ValueError('Catalogue ice-field coverage is incomplete; local data was not changed.')
    return dates


def metadata(grid):
    return {'version': 1, 'source': 'ECMWF ORAS5', 'dataset': 'reanalysis-oras5',
            'sourceUrl': SOURCE_URL, 'license': 'CC-BY-4.0', 'units': '1000 km3', 'method': METHOD,
            'grid': {'name': 'ORCA025', 'shape': list(GRID_SHAPE), 'url': GRID_URL,
                     'sha256': grid_fingerprint(grid)}}


def validate_records(records):
    if not isinstance(records, list) or not records:
        raise ValueError('No ORAS5 volume records.')
    previous = -1
    for record in records:
        year, month = record.get('year'), record.get('month')
        if type(year) is not int or year < 1958 or type(month) is not int or not 1 <= month <= 12:
            raise ValueError('Invalid record date.')
        ordinal = year * 12 + month - 1
        if ordinal <= previous or record.get('product') != product_type(year):
            raise ValueError('Duplicate, unordered, or mismatched product records.')
        for key in ['north', 'south']:
            value = record.get(key)
            if type(value) not in [int, float] or not np.isfinite(value) or not 0 <= value <= 100:
                raise ValueError('Invalid hemispheric volume.')
        previous = ordinal


def read_snapshot(path, header):
    if not path.exists():
        return []
    payload = json.loads(path.read_text(encoding='utf-8'))
    if any(payload.get(key) != value for key, value in header.items()):
        raise ValueError('Snapshot grid or method differs. Use a fresh cache and review before replacing it.')
    records = payload.get('records')
    validate_records(records)
    return records


def publish(path, header, records, expected, previous):
    validate_records(records)
    dates = [(record['year'], record['month']) for record in records]
    if dates != expected or not {(r['year'], r['month']) for r in previous}.issubset(dates):
        raise ValueError('New series is incomplete or loses observations; local file was not changed.')
    atomic_json(path, {**header, 'records': records})


def download_file(client, url, path):
    temporary = path.with_suffix(path.suffix + '.tmp')
    try:
        with client.get(url, stream=True, timeout=(15, 120)) as response:
            response.raise_for_status()
            with temporary.open('wb') as handle:
                for block in response.iter_content(1024 * 1024):
                    handle.write(block)
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def check_sample(cache, http):
    grid = load_grid(cache)
    fields = defaultdict(dict)
    expected = [(1979, 1)]
    for name in VARIABLES:
        path = cache / (name + '-sample-197901.nc')
        if not path.exists():
            download_file(http, SAMPLE_ROOT + name + '/opa0/' + name + '_ORAS5_1m_197901_icemod_02.nc', path)
        with netCDF4.Dataset(path) as dataset:
            read_fields(dataset, grid, expected, fields)
    volume = hemispheric_volumes(fields[(1979, 1)]['iicethic'], fields[(1979, 1)]['ileadfra'],
                                grid['area'], grid['latitude'])
    print('Public ICDC native-grid sample, January 1979 (1000 km3): ' + json.dumps(volume))
    print('Grid ocean area (million km2): ' + str(grid['area'].sum() / 1e12))
    print('Sample validation only; no app snapshot was published.')


def update(args):
    with session() as http:
        if args.check_sample:
            check_sample(args.cache, http)
            return
        response = http.get(CATALOGUE, timeout=(15, 60))
        response.raise_for_status()
        catalogue = response.json()
        link = next(item['href'] for item in catalogue['links'] if item['rel'] == 'constraints')
        response = http.get(link, timeout=(15, 60))
        response.raise_for_status()
        dates = available_months(catalogue, response.json(), args.start_year)
    print(f'Available: {len(dates)} months, {dates[0][0]}-01 through {dates[-1][0]}-{dates[-1][1]:02d}.', flush=True)
    if args.dry_run:
        print('Required fields: monthly native-grid sea_ice_thickness and sea_ice_concentration.')
        print('First run downloads the history; later runs request missing months and revisit two recent months.')
        return

    import cdsapi
    try:
        client = cdsapi.Client(url='https://cds.climate.copernicus.eu/api',
                               timeout=120, retry_max=3, quiet=True, progress=False)
    except Exception as error:
        raise RuntimeError('Configure CDSAPI_KEY or ~/.cdsapirc, and accept the ORAS5 dataset terms. '
                           'See docs/oras5-setup.md.') from error
    grid = load_grid(args.cache)
    update_snapshot(args, client, grid, dates)


def update_snapshot(args, client, grid, dates):
    header = metadata(grid)
    previous = read_snapshot(args.output, header)
    records = {(row['year'], row['month']): row for row in previous}
    checkpoint_path = args.cache / 'progress.json'
    base_hash = hashlib.sha256(json.dumps(previous, sort_keys=True).encode()).hexdigest()
    completed = {}
    if checkpoint_path.exists():
        saved = read_snapshot(checkpoint_path, header)
        checkpoint = json.loads(checkpoint_path.read_text(encoding='utf-8'))
        # Only resume work based on this published snapshot, never supersede newer data.
        if checkpoint.get('baseRecordsSha256') == base_hash:
            completed = {(row['year'], row['month']): row for row in saved
                         if (row['year'], row['month']) in dates}
            records.update(completed)
    if previous and (dates[0] > (previous[0]['year'], previous[0]['month'])
                     or dates[-1] < (previous[-1]['year'], previous[-1]['month'])):
        raise ValueError('Requested range would shorten the published series.')
    missing = set(dates) - records.keys()
    # Revisit recent published months when extending the record, or on explicit refresh.
    if previous and (dates[-1] > (previous[-1]['year'], previous[-1]['month']) or args.refresh):
        missing.update((row['year'], row['month']) for row in previous[-2:])
    missing.difference_update(completed)
    requests_by_year = defaultdict(list)
    for year, month in sorted(missing):
        requests_by_year[year].append(month)
    print(f'Processing {len(missing)} months in {len(requests_by_year)} yearly requests.', flush=True)
    args.cache.mkdir(parents=True, exist_ok=True)
    for index, (year, months) in enumerate(sorted(requests_by_year.items())):
        if args.max_years and index >= args.max_years:
            print('Batch limit reached. Progress is saved; rerun to finish before publication.')
            return
        request = {'product_type': [product_type(year)], 'vertical_resolution': 'single_level',
                   'variable': list(VARIABLES.values()), 'year': [str(year)],
                   'month': [f'{month:02d}' for month in months]}
        print(f'Downloading and processing {year}: {len(months)} months...', flush=True)
        with tempfile.TemporaryDirectory(prefix='download-', dir=args.cache) as temporary:
            download = Path(temporary) / 'source.zip'
            client.retrieve('reanalysis-oras5', request, str(download))
            rows = process_download(download, grid, [(year, month) for month in months])
        for row in rows:
            records[(row['year'], row['month'])] = row
            completed[(row['year'], row['month'])] = row
        atomic_json(checkpoint_path, {**header, 'baseRecordsSha256': base_hash,
                                     'records': [completed[key] for key in sorted(completed)]})
    result = [records[date] for date in dates]
    publish(args.output, header, result, dates, previous)
    checkpoint_path.unlink(missing_ok=True)
    print(f'Published {len(result)} months for both hemispheres to {args.output}.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache', type=Path, default=ROOT / '.cache/oras5')
    parser.add_argument('--output', type=Path, default=ROOT / 'data/oras5-sea-ice-volume.json')
    parser.add_argument('--start-year', type=int, default=1958)
    parser.add_argument('--max-years', type=int, default=0, help='Limit requests per run; 0 processes all pending years.')
    parser.add_argument('--refresh', action='store_true', help='Re-fetch two recent published months even if no new month is available.')
    parser.add_argument('--dry-run', action='store_true', help='Check public catalogue coverage without downloading fields.')
    parser.add_argument('--check-sample', action='store_true', help='Validate against public ICDC January 1979 fields without a CDS key.')
    args = parser.parse_args()
    if not 1958 <= args.start_year <= datetime.now(timezone.utc).year or args.max_years < 0:
        parser.error('Invalid start year or batch limit.')
    update(args)


if __name__ == '__main__':
    main()
