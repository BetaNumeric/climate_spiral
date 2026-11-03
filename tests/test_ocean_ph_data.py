import copy
from datetime import datetime, timezone
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
import xarray as xr

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import update_ocean_ph_data as ph


class OceanPhTests(unittest.TestCase):
    def setUp(self):
        self.latitude = [-67.5, -22.5, 22.5, 67.5]
        self.longitude = [-135, -45, 45, 135]
        self.areas = ph.cell_areas(self.latitude, self.longitude)

    def test_spherical_areas_cover_globe_and_weight_latitudes(self):
        self.assertAlmostEqual(float(self.areas.sum()), 4 * np.pi * ph.EARTH_RADIUS_KM ** 2)
        self.assertGreater(self.areas[1, 0], self.areas[0, 0])
        np.testing.assert_allclose(self.areas[0], self.areas[-1])

    def test_wrong_grids_are_rejected(self):
        for lat, lon in [([0], self.longitude), ([0, np.nan], self.longitude),
                         (self.latitude[::-1], self.longitude), ([-45, 0, 45], self.longitude),
                         (self.latitude, [-90, 0, 90]), ([-60, -20, 10, 60], self.longitude)]:
            with self.subTest(lat=lat, lon=lon), self.assertRaises(ValueError):
                ph.cell_areas(lat, lon)

    def test_mean_is_area_weighted_and_excludes_missing_land(self):
        values = np.tile(np.array([8.0, 8.3, 8.1, 8.0])[:, None], (1, 4))
        values[:, -1] = np.nan
        mean, area = ph.reduce_month(values, self.areas)
        expected = np.nansum(values * self.areas) / self.areas[:, :3].sum()
        self.assertEqual(mean, round(float(expected), 6))
        self.assertNotAlmostEqual(mean, float(np.nanmean(values)), places=3)
        self.assertEqual(area, round(float(self.areas.sum()) * 0.75, 1))
        masked = np.ma.masked_invalid(values)
        self.assertEqual(ph.reduce_month(masked, self.areas), (mean, area))

    def test_bad_fields_and_small_coverage_fail(self):
        values = np.full((4, 4), 8.1)
        values[:, -1] = np.nan
        invalid = values.copy()
        invalid[0, 0] = 9.96e36
        for data, areas in [(np.full((4, 4), np.nan), self.areas), (invalid, self.areas),
                            (np.full((4, 4), 8.1), self.areas), (values[:2], self.areas),
                            (values, -self.areas)]:
            with self.assertRaises(ValueError):
                ph.reduce_month(data, areas)

    def test_history_wins_overlap_and_current_month_is_omitted(self):
        selected = ph.choose_months({'my': ['1985-01', '1985-02'],
                                     'nrt': ['1985-02', '1985-03', '1985-04']}, '1985-04')
        self.assertEqual(selected, {'1985-01': ('my', 0), '1985-02': ('my', 1), '1985-03': ('nrt', 1)})
        for sources in [{'my': ['1985-02'], 'nrt': ['1985-03']},
                        {'my': ['1985-01'], 'nrt': ['1985-03']}]:
            with self.assertRaises(ValueError):
                ph.choose_months(sources, '1986-01')

    def fixture_sources(self):
        return {kind: {'dataset': f'cmems_obs-mob_glo_bgc-car_{kind}_irr-i', 'version': '202603',
                       'store': f'https://example.com/{kind}', 'gridSha256': 'a' * 64}
                for kind in ['my', 'nrt']}

    def fake_open(self, source):
        months = ['1985-01', '1985-02'] if source['store'].endswith('my') else ['1985-02', '1985-03']
        values = np.full((2, 4, 4), 8.1)
        values[:, :, -1] = np.nan
        dataset = xr.Dataset({'ph': (('time', 'latitude', 'longitude'), values)})
        return dataset, months, self.areas

    def test_incremental_updates_reuse_grids_and_detect_revisions(self):
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / 'ph.json'
            with patch.object(ph, 'discover_sources', side_effect=self.fixture_sources), \
                    patch.object(ph, 'open_source', side_effect=self.fake_open), \
                    patch.object(ph, 'fingerprint', return_value='unchanged'), \
                    patch.object(ph, 'reduce_month', wraps=ph.reduce_month) as reduce:
                ph.update(destination)
                self.assertEqual(reduce.call_count, 3)
                original = destination.read_bytes()
                reduce.reset_mock()
                ph.update(destination)
                self.assertEqual(reduce.call_count, 0)
                self.assertEqual(destination.read_bytes(), original)
            with patch.object(ph, 'discover_sources', side_effect=self.fixture_sources), \
                    patch.object(ph, 'open_source', side_effect=self.fake_open), \
                    patch.object(ph, 'fingerprint', side_effect=lambda url: 'revised' if url.endswith('nrt/ph/1.0.0') else 'unchanged'), \
                    patch.object(ph, 'reduce_month', wraps=ph.reduce_month) as reduce:
                ph.update(destination)
                self.assertEqual(reduce.call_count, 1)
                self.assertEqual(json.loads(destination.read_text())['records'][-1]['etag'], 'revised')

    def test_failed_or_changing_sources_never_replace_snapshot(self):
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / 'ph.json'
            with patch.object(ph, 'discover_sources', side_effect=self.fixture_sources), \
                    patch.object(ph, 'open_source', side_effect=self.fake_open), \
                    patch.object(ph, 'fingerprint', return_value='unchanged'):
                ph.update(destination, workers=1)
                original = destination.read_bytes()
                with patch.object(ph, 'fingerprint', return_value='new'), \
                        patch.object(ph, 'reduce_month', side_effect=ValueError('Damaged grid')):
                    with self.assertRaises(ValueError):
                        ph.update(destination, workers=1)
                self.assertEqual(destination.read_bytes(), original)
                with patch.object(ph, 'fingerprint', side_effect=['new', 'changed-again'] * 3):
                    with self.assertRaises(ValueError):
                        ph.update(destination, workers=1)
                self.assertEqual(destination.read_bytes(), original)

    def test_new_historical_release_replaces_provisional_month(self):
        def promoted(source):
            if not source['store'].endswith('my'):
                return self.fake_open(source)
            values = np.full((3, 4, 4), 8.12)
            values[:, :, -1] = np.nan
            return xr.Dataset({'ph': (('time', 'latitude', 'longitude'), values)}), \
                ['1985-01', '1985-02', '1985-03'], self.areas

        with tempfile.TemporaryDirectory() as directory, \
                patch.object(ph, 'discover_sources', side_effect=self.fixture_sources), \
                patch.object(ph, 'fingerprint', return_value='same'):
            destination = Path(directory) / 'ph.json'
            with patch.object(ph, 'open_source', side_effect=self.fake_open):
                ph.update(destination)
            with patch.object(ph, 'open_source', side_effect=promoted), \
                    patch.object(ph, 'reduce_month', wraps=ph.reduce_month) as reduce:
                ph.update(destination)
                self.assertEqual(reduce.call_count, 1)
            latest = json.loads(destination.read_text())['records'][-1]
            self.assertEqual(latest['product'], 'my')
            self.assertEqual(latest['ph'], 8.12)

    def test_discovery_selects_latest_public_native_resolution_stores(self):
        product = {'links': [{'rel': 'item', 'href': f'cmems_obs-mob_glo_bgc-car_{kind}_irr-i_{version}/dataset.stac.json'}
                             for kind in ['my', 'nrt'] for version in ['202501', '202603']]}
        def response(url):
            if url == ph.CATALOGUE:
                return product
            return {'assets': {'timeChunked': {'href': f'https://s3.example.cloudferro.com/arco/{ph.PRODUCT}/timeChunked.zarr',
                                               'type': 'application/vnd+zarr'}}}
        with patch.object(ph, 'get_json', side_effect=response) as request:
            sources = ph.discover_sources()
            self.assertTrue(all(source['version'] == '202603' for source in sources.values()))
            self.assertEqual(request.call_count, 3)
        with patch.object(ph, 'get_json', return_value={'links': []}), self.assertRaises(ValueError):
            ph.discover_sources()

    def test_shorter_history_and_provisional_downgrades_fail(self):
        with tempfile.TemporaryDirectory() as directory, \
                patch.object(ph, 'discover_sources', side_effect=self.fixture_sources), \
                patch.object(ph, 'open_source', side_effect=self.fake_open), \
                patch.object(ph, 'fingerprint', return_value='same'):
            destination = Path(directory) / 'ph.json'
            ph.update(destination)
            previous = json.loads(destination.read_text())
            for change in ['truncate', 'downgrade', 'duplicate', 'current-month', 'bad-units']:
                candidate = copy.deepcopy(previous)
                if change == 'truncate':
                    candidate['records'].pop()
                    candidate['through'] = candidate['records'][-1]['month']
                elif change == 'downgrade':
                    candidate['records'][0]['product'] = 'nrt'
                elif change == 'duplicate':
                    candidate['records'][1]['month'] = '1985-01'
                elif change == 'current-month':
                    candidate['records'][-1]['month'] = datetime.now(timezone.utc).strftime('%Y-%m')
                    candidate['through'] = candidate['records'][-1]['month']
                else:
                    candidate['units'] = 'C'
                with self.subTest(change=change), self.assertRaises(ValueError):
                    ph.validate_replacement(previous, candidate, datetime.now(timezone.utc).strftime('%Y-%m'))

    def test_real_snapshot_is_valid_and_complete(self):
        snapshot = json.loads((ph.ROOT / 'data/ocean-ph.json').read_text())
        ph.validate_snapshot(snapshot, datetime.now(timezone.utc).strftime('%Y-%m'))
        self.assertGreaterEqual(len(snapshot['records']), 480)


if __name__ == '__main__':
    unittest.main()
