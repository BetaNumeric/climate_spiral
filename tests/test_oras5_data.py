from collections import defaultdict
from datetime import datetime, timezone
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
import zipfile

import netCDF4
import numpy as np

from scripts import update_oras5_data as oras5


def grid():
    return {'latitude': np.array([[70., 80.], [-70., -80.]]),
            'longitude': np.array([[0., 90.], [0., 90.]]), 'area': np.full((2, 2), 1e12)}


def rows(dates, value=10):
    return [{'year': year, 'month': month, 'north': value, 'south': 2,
             'product': oras5.product_type(year)} for year, month in dates]


def write_field(path, name, values, units=None, latitude=None):
    with netCDF4.Dataset(path, 'w') as data:
        data.source = 'ORAS5 - Ocean ReAnalysis System 5 (ECMWF)'
        for dimension, size in [('time_counter', 1), ('y', 2), ('x', 2)]:
            data.createDimension(dimension, size)
        for variable, key in [('nav_lat', 'latitude'), ('nav_lon', 'longitude')]:
            data.createVariable(variable, 'f4', ('y', 'x'))[:] = grid()[key]
        if latitude is not None:
            data['nav_lat'][:] = latitude
        time = data.createVariable('time_counter', 'f8', ('time_counter',))
        time.units = 'days since 1979-01-01 00:00:00'
        time.calendar = 'gregorian'
        time[:] = [15]
        field = data.createVariable(name, 'f4', ('time_counter', 'y', 'x'))
        field.units = units or ('m' if name == 'iicethic' else 'Fraction')
        field[:] = [values]


class VolumeTests(unittest.TestCase):
    def test_thickness_times_concentration_times_area(self):
        result = oras5.hemispheric_volumes([[2, 4], [3, 1]], [[.5, .25], [1, .5]],
                                          grid()['area'], grid()['latitude'])
        self.assertEqual(result, {'north': 2., 'south': 3.5})

    def test_land_and_ice_free_missing_thickness(self):
        result = oras5.hemispheric_volumes([[np.nan, np.nan], [3, 1]], [[np.nan, 0], [1, .5]],
                                          [[0, 1e12], [1e12, 1e12]], grid()['latitude'])
        self.assertEqual(result, {'north': 0., 'south': 3.5})

    def test_bad_ice_fields_are_not_silently_integrated(self):
        for h, c in [(np.nan, 1), (-1, .5), (101, 1), (1, np.nan), (1, -0.1), (1, 10)]:
            with self.subTest(h=h, c=c), self.assertRaises(ValueError):
                oras5.hemispheric_volumes(np.full((2, 2), h), np.full((2, 2), c),
                                          grid()['area'], grid()['latitude'])
        with self.assertRaises(ValueError):
            oras5.hemispheric_volumes([[1]], [[1]], grid()['area'], grid()['latitude'])

    def test_native_area_excludes_land_and_overlapping_cells(self):
        area = oras5.grid_weights([[2, 3], [4, 5]], [[10, 10], [10, 10]],
                                  [[1, 0], [1, 1]], [[1, 1], [0, 1]])
        np.testing.assert_array_equal(area, [[20, 0], [0, 50]])
        with self.assertRaises(ValueError):
            oras5.grid_weights([[0]], [[1]], [[1]], [[1]])

    def test_archive_coordinates_units_and_complete_field_pairs(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            h, c, archive = root / 'h.nc', root / 'c.nc', root / 'data.zip'
            write_field(h, 'iicethic', [[2, 4], [3, 1]])
            write_field(c, 'ileadfra', [[.5, .25], [1, .5]])
            with zipfile.ZipFile(archive, 'w') as output:
                output.write(h, 'nested/h.nc')
                output.write(c, '../c.nc')
            self.assertEqual(oras5.process_download(archive, grid(), [(1979, 1)]),
                             [{'year': 1979, 'month': 1, 'product': 'consolidated', 'north': 2., 'south': 3.5}])
            with self.assertRaises(ValueError):
                oras5.process_download(h, grid(), [(1979, 1)])
            with self.assertRaises(ValueError):
                oras5.process_download(archive, grid(), [(1979, 2)])
            for kwargs in [{'units': 'cm'}, {'latitude': [[0, 0], [0, 0]]}]:
                write_field(h, 'iicethic', [[2, 4], [3, 1]], **kwargs)
                with netCDF4.Dataset(h) as data, self.assertRaises(ValueError):
                    oras5.read_fields(data, grid(), [(1979, 1)], defaultdict(dict))


class UpdateTests(unittest.TestCase):
    def test_catalogue_intersection_and_current_month_exclusion(self):
        catalogue = {'extent': {'temporal': {'interval': [['1958-01-01', '2015-03-01']]}}}
        constraints = [
            {'vertical_resolution': ['single_level'], 'variable': list(oras5.VARIABLES.values()),
             'year': ['2014'], 'month': [str(n) for n in range(1, 13)], 'product_type': ['consolidated']},
            {'vertical_resolution': ['single_level'], 'variable': ['sea_ice_thickness'],
             'year': ['2015'], 'month': ['01', '02', '03'], 'product_type': ['operational']},
            {'vertical_resolution': ['single_level'], 'variable': ['sea_ice_concentration'],
             'year': ['2015'], 'month': ['01', '02'], 'product_type': ['operational']}
        ]
        dates = oras5.available_months(catalogue, constraints, 2014, datetime(2015, 4, 1, tzinfo=timezone.utc))
        self.assertEqual(len(dates), 14)
        self.assertEqual(dates[-1], (2015, 2))
        dates = oras5.available_months(catalogue, constraints, 2014, datetime(2015, 2, 1, tzinfo=timezone.utc))
        self.assertEqual(dates[-1], (2015, 1))
        constraints[0]['month'].remove('6')
        with self.assertRaises(ValueError):
            oras5.available_months(catalogue, constraints, 2014)

    def test_publishing_preserves_old_file_when_new_data_invalid(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'snapshot.json'
            dates = [(1979, 1), (1979, 2)]
            previous = rows(dates)
            header = oras5.metadata(grid())
            oras5.publish(path, header, previous, dates, [])
            original = path.read_bytes()
            mtime = path.stat().st_mtime_ns
            oras5.publish(path, header, previous, dates, previous)
            self.assertEqual(mtime, path.stat().st_mtime_ns)
            for records, expected in [(previous[:1], dates[:1]), (previous, dates + [(1979, 3)]),
                                      (rows(dates, float('nan')), dates), (previous[::-1], dates)]:
                with self.assertRaises(ValueError):
                    oras5.publish(path, header, records, expected, previous)
                self.assertEqual(path.read_bytes(), original)
            wrong = {**header, 'units': 'km3'}
            with self.assertRaises(ValueError):
                oras5.read_snapshot(path, wrong)

    def test_bootstrap_resumes_and_publishes_only_complete_history(self):
        dates = [(2014, month) for month in range(1, 13)] + [(2015, 1)]
        self.check_resume(dates, [])

    def test_revision_resume_does_not_repeat_the_same_year_or_lose_revisions(self):
        dates = [(2014, month) for month in range(1, 13)] + [(2015, 1)]
        self.check_resume(dates, rows(dates[:-1]))

    def check_resume(self, dates, previous):
        with tempfile.TemporaryDirectory() as directory:
            args = SimpleNamespace(cache=Path(directory) / 'cache', output=Path(directory) / 'out.json',
                                   max_years=1, refresh=False)
            if previous:
                oras5.publish(args.output, oras5.metadata(grid()), previous, dates[:-1], [])
            original = args.output.read_bytes() if args.output.exists() else None
            client = Mock()
            with patch.object(oras5, 'process_download', side_effect=lambda path, grid, expected: rows(expected, 12)):
                oras5.update_snapshot(args, client, grid(), dates)
                self.assertEqual(args.output.read_bytes() if args.output.exists() else None, original)
                self.assertTrue((args.cache / 'progress.json').exists())
                oras5.update_snapshot(args, client, grid(), dates)
                result = json.loads(args.output.read_text())['records']
                self.assertEqual(len(result), len(dates))
                self.assertEqual(result[-2]['north'], 12)
                self.assertEqual([call.args[1]['year'] for call in client.retrieve.call_args_list], [['2014'], ['2015']])
                self.assertEqual(client.retrieve.call_args_list[-1].args[1]['product_type'], ['operational'])
                oras5.update_snapshot(args, client, grid(), dates)
                self.assertEqual(client.retrieve.call_count, 2)
                self.assertFalse((args.cache / 'progress.json').exists())
                args.refresh = True
                args.max_years = 0
                oras5.update_snapshot(args, client, grid(), dates)
                self.assertEqual(client.retrieve.call_count, 4)
                oras5.update_snapshot(args, client, grid(), dates)
                self.assertEqual(client.retrieve.call_count, 6)


if __name__ == '__main__':
    unittest.main()
