"""Numerical checks for idealized 100-km-to-surface lunar descent."""
import unittest
import numpy as np
from lunar_descent import MU_M,R_M,settings,doi_to_pdi,solve,guidance

class LunarDescentTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cfg=settings()
        cls.t,cls.y,cls.u,cls.report=solve(cls.cfg)

    def test_deorbit_burn_positive_and_small(self):
        self.assertGreater(self.report['doi']['doi_delta_v_m_s'],10)
        self.assertLess(self.report['doi']['doi_delta_v_m_s'],40)

    def test_kepler_energy_at_pdi(self):
        d=self.report['doi'];rp=d['pdi_radius_m'];ra=R_M+100e3
        v_a=d['initial_circular_speed_m_s']-d['doi_delta_v_m_s'];v_p=d['pdi_tangential_speed_m_s']
        self.assertAlmostEqual(v_a*v_a/2-MU_M/ra,v_p*v_p/2-MU_M/rp,delta=1e-4)

    def test_coast_half_ellipse(self):
        ra=R_M+100e3;rp=R_M+15e3
        expected=np.pi*np.sqrt(((ra+rp)/2)**3/MU_M)
        self.assertAlmostEqual(self.report['doi']['doi_coast_s'],expected,places=8)

    def test_touchdown_and_speed(self):
        self.assertEqual(self.report['landing_status'],'PASS')
        self.assertLess(self.report['touchdown_speed_m_s'],1.5)
        self.assertAlmostEqual(self.y[-1,0],R_M,delta=.05)

    def test_mass_and_thrust(self):
        self.assertTrue(np.all(np.diff(self.y[:,4])<=1e-8))
        self.assertTrue(np.all(self.u[:,2]<=self.cfg['thrust_n']+1e-5))
        self.assertGreater(self.report['touchdown_propellant_remaining_kg'],20)

    def test_fuel_accounting(self):
        d=self.report
        self.assertAlmostEqual(d['total_DOI_plus_descent_propellant_used_kg'],
                               d['doi']['doi_propellant_kg']+d['descent_propellant_used_kg'],places=6)

    def test_bad_masses_rejected(self):
        with self.assertRaises(ValueError):settings(mass_kg=500,dry_mass_kg=600)

    def test_initial_speed(self):
        expected=np.sqrt(MU_M/(R_M+100e3))
        self.assertAlmostEqual(self.report['doi']['initial_circular_speed_m_s'],expected,places=6)

if __name__=='__main__': unittest.main()
