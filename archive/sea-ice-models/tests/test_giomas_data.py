from datetime import datetime, timezone
import gzip
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

import netCDF4
import numpy as np

from scripts import update_giomas_data as giomas


def snapshot(years=1):
    return {'version': 1, 'source': 'PSC GIOMAS', 'sourceUrl': giomas.SOURCE_URL,
            'method': giomas.METHOD, 'units': '1000 km3',
            'grid': {'shape': list(giomas.GRID_SHAPE), 'sha256': 'a' * 64},
            'releases': [{'year': year, 'url': giomas.BASE_URL + f'heff.H{year}.nc.gz',
                          'sha256': 'b' * 64} for year in range(1979, 1979 + years)],
            'records': [{'year': 1979 + index // 12, 'month': index % 12 + 1,
                         'north': 30, 'south': 10} for index in range(12 * years)]}


def write_field(path, year=1979):
    with netCDF4.Dataset(path, 'w') as data:
        data.Model = 'Global Ice/Ocean Modeling and Assimilation System (GIOMAS)'
        for dimension, size in [('n', 12), ('j', 2), ('i', 2)]:
            data.createDimension(dimension, size)
        data.createVariable('year', 'i4', ())[:] = year
        data.createVariable('month', 'i4', ('n',))[:] = np.arange(1, 13)
        for name, values in [('lat_scaler', [[70, 80], [-70, -80]]),
                             ('lon_scaler', [[0, 90], [0, 90]]),
                             ('dxt', np.full((2, 2), 9_000)),
                             ('dyt', np.full((2, 2), 10_000)),
                             ('kmt', np.full((2, 2), 1))]:
            variable = data.createVariable(name, 'f4', ('j', 'i'))
            variable[:] = values
            variable.long_name = 'length (km)' if name in ['dxt', 'dyt'] else name
        h = data.createVariable('heff', 'f4', ('n', 'j', 'i'))
        h.units = 'm'
        h.long_name = 'monthly mean sea ice thickness'
        h[:] = np.full((12, 2, 2), .1)


class VolumeTests(unittest.TestCase):
    def test_effective_thickness_already_includes_concentration(self):
        volumes = giomas.hemispheric_volumes([[2, 4], [3, 1]],
                                             np.full((2, 2), 1e6), [[70, 80], [-70, -80]])
        self.assertEqual(volumes, {'north': 6., 'south': 4.})

    def test_native_area_units_and_land_mask(self):
        area = giomas.grid_weights([[2, 3], [4, 5]], [[10, 10], [10, 10]], [[1, 0], [40, 1]])
        np.testing.assert_array_equal(area, [[20, 0], [40, 50]])
        result = giomas.hemispheric_volumes([[2, np.nan], [3, 1]], area, [[70, 80], [-70, -80]])
        self.assertAlmostEqual(result['north'], .00004)
        self.assertAlmostEqual(result['south'], .00017)
        for levels in [[[-1]], [[41]], [[1.5]], [[np.nan]]]:
            with self.assertRaises(ValueError):
                giomas.grid_weights([[1]], [[1]], levels)
        with self.assertRaises(ValueError):
            giomas.grid_weights([[0]], [[1]], [[1]])

    def test_invalid_ocean_fields_are_not_silently_integrated(self):
        for value in [np.nan, -1, 101]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                giomas.hemispheric_volumes([[value]], [[1e6]], [[70]])
        for area, latitude in [([[-1]], [[70]]), ([[1]], [[np.nan]]), ([[1]], [[91]])]:
            with self.assertRaises(ValueError):
                giomas.hemispheric_volumes([[1]], area, latitude)

    def test_monthly_netcdf_metadata_and_grid(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(giomas, 'GRID_SHAPE', (2, 2)):
            path = Path(directory) / 'sample.nc'
            write_field(path)
            records, fingerprint = giomas.process_year(gzip.compress(path.read_bytes()), 1979)
            self.assertEqual(len(records), 12)
            self.assertAlmostEqual(records[0]['north'], 18, places=5)
            self.assertEqual(len(fingerprint), 64)
            for name, value in [('year', 1980), ('month', np.arange(0, 12)),
                                ('dxt', np.zeros((2, 2))), ('heff', np.full((12, 2, 2), np.nan))]:
                write_field(path)
                with netCDF4.Dataset(path, 'a') as data:
                    data[name][:] = value
                with self.subTest(name=name), self.assertRaises(ValueError):
                    giomas.process_year(gzip.compress(path.read_bytes()), 1979)
            for name, attr, value in [('heff', 'units', 'cm'), ('heff', 'long_name', 'daily thickness'),
                                      ('dyt', 'long_name', 'length (m)')]:
                write_field(path)
                with netCDF4.Dataset(path, 'a') as data:
                    setattr(data[name], attr, value)
                with self.assertRaises(ValueError):
                    giomas.process_year(gzip.compress(path.read_bytes()), 1979)


class UpdateTests(unittest.TestCase):
    def test_release_discovery_excludes_raw_partial_current_and_foreign_links(self):
        html = ''.join(f'<a href="heff.H{year}.nc.gz">data</a>' for year in range(1979, 1982))
        html += '<a href="heff.H1982">partial binary</a><a href="heff.H1982.nc.gz">current</a>'
        html += '<a href="https://example.com/zhang/Global_seaice/heff.H1983.nc.gz">foreign</a>'
        self.assertEqual(giomas.available_years(html, datetime(1982, 10, 1, tzinfo=timezone.utc)),
                         [1979, 1980, 1981])
        for invalid in ['<html>Error</html>', html.replace('heff.H1980.nc.gz', 'missing')]:
            with self.assertRaises(ValueError):
                giomas.available_years(invalid, datetime(1982, 10, 1, tzinfo=timezone.utc))

    def test_download_reuses_http_validators_and_cached_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = Path(directory)
            response = Mock(status_code=200, headers={'ETag': 'test', 'Last-Modified': 'date'})
            response.iter_content.return_value = [b'public-data']
            client = Mock()
            client.get.return_value.__enter__ = Mock(return_value=response)
            client.get.return_value.__exit__ = Mock(return_value=False)
            self.assertEqual(giomas.download_year(client, 1979, cache), b'public-data')
            response.status_code = 304
            self.assertEqual(giomas.download_year(client, 1979, cache), b'public-data')
            self.assertEqual(client.get.call_args.kwargs['headers'],
                             {'If-None-Match': 'test', 'If-Modified-Since': 'date'})
            with patch.object(giomas, 'MAX_BYTES', 1), self.assertRaises(ValueError):
                response.status_code = 200
                response.iter_content.return_value = [b'oversized']
                giomas.download_year(client, 1979, cache)
            self.assertEqual((cache / 'heff.H1979.nc.gz').read_bytes(), b'public-data')

    def test_publishing_is_atomic_idempotent_and_never_shortens_history(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'snapshot.json'
            giomas.publish(path, snapshot(2))
            original, mtime = path.read_bytes(), path.stat().st_mtime_ns
            giomas.publish(path, snapshot(2))
            self.assertEqual(path.stat().st_mtime_ns, mtime)
            invalid = snapshot(2)
            invalid['records'][5]['north'] = float('nan')
            for data in [snapshot(), invalid, {**snapshot(2), 'units': 'km3'}]:
                with self.assertRaises(ValueError):
                    giomas.publish(path, data)
                self.assertEqual(path.read_bytes(), original)
            revised = snapshot(2)
            revised['records'][0]['north'] = 29
            giomas.publish(path, revised)
            self.assertEqual(json.loads(path.read_text())['records'][0]['north'], 29)

    def test_failed_processing_or_changed_grid_does_not_publish(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'snapshot.json'
            giomas.publish(path, snapshot())
            original = path.read_bytes()
            client = Mock()
            client.get.return_value.text = '<a href="heff.H1979.nc.gz">a</a><a href="heff.H1980.nc.gz">b</a>'
            with patch.object(giomas, 'download_year', return_value=b'source'), \
                    patch.object(giomas, 'process_year', side_effect=[([], 'a' * 64), ([], 'b' * 64)]), \
                    self.assertRaises(ValueError):
                giomas.update(client, Path(directory), path)
            self.assertEqual(path.read_bytes(), original)

    def test_cached_real_source_matches_published_snapshot(self):
        path = giomas.ROOT / 'data/giomas-sea-ice-volume.json'
        source = giomas.ROOT / '.cache/giomas/heff.H1980.nc.gz'
        if not path.exists() or not source.exists():
            self.skipTest('Local authentic source audit is not available')
        content = source.read_bytes()
        records, fingerprint = giomas.process_year(content, 1980)
        payload = json.loads(path.read_text(encoding='utf-8'))
        self.assertEqual(records, [row for row in payload['records'] if row['year'] == 1980])
        self.assertEqual(fingerprint, payload['grid']['sha256'])
        self.assertEqual(hashlib.sha256(content).hexdigest(), payload['releases'][1]['sha256'])


if __name__ == '__main__':
    unittest.main()
