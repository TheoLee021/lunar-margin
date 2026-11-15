"""Unit tests for geometric (not operational) launch/parking-orbit screening."""
import math
import unittest

from launch_geometry import (
    OMEGA_E, R_E, SITES, allowed_inertial_azimuths,
    analyze, circular_speed_km_s, comparison,
    inferred_inclination_deg,
)


class LaunchGeometryTests(unittest.TestCase):

    def test_four_site_presets(self):
        self.assertEqual(set(SITES), {"kennedy", "vandenberg", "kourou", "tanegashima"})

    def test_due_east_inclination_equals_site_latitude(self):
        for key, site in SITES.items():
            with self.subTest(site=key):
                i = inferred_inclination_deg(site.latitude_deg, 90)
                self.assertAlmostEqual(i, abs(site.latitude_deg), places=8)

    def test_westward_insertion_is_retrograde(self):
        lat = SITES["kennedy"].latitude_deg
        self.assertAlmostEqual(inferred_inclination_deg(lat, 270),
                               180-abs(lat), places=8)

    def test_low_inclination_cannot_launch_directly_from_high_latitude(self):
        r=analyze("vandenberg", 200, 20, None)
        self.assertEqual(r["status"], "NO_DIRECT_INSERTION_OR_INCONSISTENT_INPUT")
        self.assertEqual(r["geometry"]["two_inertial_azimuth_solutions_deg"], [])

    def test_four_sites_share_target_inclination(self):
        rows=comparison(200,40)
        self.assertEqual(len(rows),4)
        self.assertTrue(all(r["geometry"]["input_consistency_pass"] for r in rows))
        for r in rows:
            self.assertAlmostEqual(r["geometry"]["inferred_inclination_deg"],40,places=8)

    def test_spin_projection_invariant_for_fixed_inclination(self):
        rows=comparison(200,40)
        projections=[r["geometry"]["earth_rotational_velocity_along_heading_km_s"] for r in rows]
        expected=OMEGA_E*R_E*math.cos(math.radians(40))
        for p in projections:
            self.assertAlmostEqual(p, expected, places=10)

    def test_vandenberg_real_range_not_claimed(self):
        r=analyze("vandenberg",200,40)
        self.assertFalse(r["limitations"]["range_safety_checked"])
        self.assertFalse(r["limitations"]["lunar_transfer_plane_coupled"])
        self.assertFalse(r["limitations"]["site_specific_launch_delta_v_computed"])

    def test_inconsistent_inclination_and_azimuth(self):
        r=analyze("kennedy",200,40,90)
        self.assertFalse(r["geometry"]["input_consistency_pass"])
        self.assertGreater(r["geometry"]["inclination_mismatch_deg"],10)

    def test_altitude_changes_circular_speed(self):
        self.assertGreater(circular_speed_km_s(200), circular_speed_km_s(400))

    def test_azimuth_pair_is_valid(self):
        for az in allowed_inertial_azimuths(SITES["kennedy"].latitude_deg,40):
            self.assertAlmostEqual(inferred_inclination_deg(SITES["kennedy"].latitude_deg,az),40,places=8)


if __name__=="__main__":
    unittest.main()
