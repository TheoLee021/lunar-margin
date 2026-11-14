#!/usr/bin/env python3
"""
Earth -> Moon direct transfer demonstrator (preliminary mission design).

Model:
 - Earth-centered 3-D inertial coordinates (km, seconds) with Earth fixed at origin.
 - Moon on a self-consistent circular two-body orbit, inclined 5.145 deg.
 - Spacecraft integrated under Earth and Moon gravity; indirect lunar acceleration
   is included because the coordinates are Earth-centered.
 - A tangential impulsive TLI from a prescribed circular Earth parking orbit.
 - Lunar departure phase chosen by a scalar shooting method so that the first
   lunar periapsis has the requested altitude.
 - Instantaneous LOI at that perilune, circularizing in the incoming orbital plane.

Not a flight-design trajectory, not an actual dated ephemeris, not a polar lunar
orbit design. Launch-site and parking-orbit geometry can be SCREENED using
four user inputs, but are NOT coupled to the current fixed-plane lunar transfer.
Solar gravity, Sun/Moon eclipse, nonspherical gravity, plane changes,
actual ascent trajectories and finite-duration burns are outside this model.

Usage:
    python lunar_transfer.py --output output
    python lunar_transfer.py --parking-km 400 --perilune-km 100 --output output400
    python lunar_transfer.py --launch-site kennedy --parking-km 200 --parking-inc-deg 40 --output output40

Dependencies: numpy, scipy, matplotlib. Optional: plotly for 3D HTML.
"""
from __future__ import annotations

import argparse
import csv
import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from scipy.integrate import solve_ivp
from scipy.optimize import brentq

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import Circle

from launch_geometry import SITES, analyze as analyze_launch, comparison as compare_launch_sites, export as export_launch

# Units: km, km/s, s. Rounded benchmark constants.
MU_E = 398600.435436                 # km^3/s^2
MU_M = 4902.800066                   # km^3/s^2
R_E = 6378.1363                      # km, equatorial reference
R_M = 1737.4                         # km, mean lunar radius
A_MOON = 384400.0                    # km, circular-orbit approximation
LUNAR_I = np.deg2rad(5.145)          # model orbital plane vs reference xy
DAY = 86400.0
N_MOON = np.sqrt((MU_E + MU_M) / A_MOON**3)
MOON_PERIOD_DAYS = 2 * np.pi / N_MOON / DAY

# Unit vectors spanning the circular lunar-orbit plane.
E1 = np.array([1.0, 0.0, 0.0])
E2 = np.array([0.0, np.cos(LUNAR_I), np.sin(LUNAR_I)])


@dataclass
class Transfer:
    parking_km: float
    perilune_km: float
    apogee_design_km: float
    phase_deg: float
    t_peri: float
    y_peri: np.ndarray
    tli_dv: float
    loi_dv: float
    v_leo: float
    v_tli: float
    v_lunar_peri: float
    v_circ_moon: float
    pre: object
    post: object
    min_post_altitude: float
    max_post_altitude: float


def moon_state(t: float, phase_rad: float) -> tuple[np.ndarray, np.ndarray]:
    a = phase_rad + N_MOON * t
    p = A_MOON * (np.cos(a) * E1 + np.sin(a) * E2)
    v = A_MOON * N_MOON * (-np.sin(a) * E1 + np.cos(a) * E2)
    return p, v


def spacecraft_rhs(t: float, y: np.ndarray, phase_rad: float) -> np.ndarray:
    r, v = y[:3], y[3:]
    rm, _ = moon_state(t, phase_rad)
    d = r - rm
    rr = np.linalg.norm(r)
    dd = np.linalg.norm(d)
    if rr == 0.0 or dd == 0.0:
        raise FloatingPointError('Singular central-body distance')
    # Third-body acceleration includes indirect term to compensate for the
    # acceleration of the Earth-centered origin toward the Moon.
    a = -MU_E * r / rr**3 - MU_M * (d / dd**3 + rm / A_MOON**3)
    return np.concatenate([v, a])


def apsis_event(t: float, y: np.ndarray, phase_rad: float) -> float:
    rm, vm = moon_state(t, phase_rad)
    # d/dt (|r-rmoon|^2)/2. Negative on lunar approach, positive when leaving.
    return float(np.dot(y[:3] - rm, y[3:] - vm))

apsis_event.direction = +1
apsis_event.terminal = False


def injection_state(parking_km: float, apogee_design_km: float):
    r0 = R_E + parking_km
    if apogee_design_km <= r0:
        raise ValueError('Design apogee must exceed parking orbit radius')
    a = (r0 + apogee_design_km) / 2.0
    v_leo = np.sqrt(MU_E / r0)
    v_tli = np.sqrt(MU_E * (2.0 / r0 - 1.0 / a))
    y0 = np.concatenate((r0 * E1, v_tli * E2))
    t_hohmann = np.pi * np.sqrt(a**3 / MU_E)
    return y0, v_leo, v_tli, t_hohmann


def propagate_to_perilune(phase_deg, parking_km, apogee_design_km):
    y0, _, _, _ = injection_state(parking_km, apogee_design_km)
    phase = np.deg2rad(phase_deg)
    sol = solve_ivp(
        spacecraft_rhs, (0.0, 6.8 * DAY), y0, args=(phase,),
        events=apsis_event, dense_output=True,
        rtol=4e-10, atol=2e-11, max_step=3600.0,
    )
    if not sol.success:
        raise RuntimeError(sol.message)
    # Lunar periapsis, not a possible early dynamical radial turning point.
    candidates = [t for t in sol.t_events[0] if 2.0 * DAY < t < 6.7 * DAY]
    if not candidates:
        return np.inf, np.nan, None, sol
    values = []
    for t in candidates:
        state = sol.sol(t)
        moon_pos, _ = moon_state(t, phase)
        dist = np.linalg.norm(state[:3] - moon_pos)
        values.append((dist, t, state))
    dist, t, state = min(values, key=lambda item: item[0])
    return dist, t, state, sol


def target_phase(parking_km: float, perilune_km: float, apogee_design_km: float):
    _, _, _, t_half = injection_state(parking_km, apogee_design_km)
    # In an unperturbed Hohmann-like transfer, the spacecraft's apogee is
    # opposite the injection longitude. Moon is moving during the flight.
    lead_guess = 180.0 - np.rad2deg(N_MOON * t_half)
    target_radius = R_M + perilune_km
    # Search the earlier-phase branch of the close-approach geometry.
    phases = np.linspace(lead_guess - 25.0, lead_guess + 12.0, 45)
    vals = []
    for ph in phases:
        r, _, _, _ = propagate_to_perilune(ph, parking_km, apogee_design_km)
        vals.append(r - target_radius)
    brackets = [(phases[i], phases[i + 1]) for i in range(len(phases)-1)
                if np.isfinite(vals[i]) and np.isfinite(vals[i+1])
                and vals[i] > 0.0 and vals[i+1] <= 0.0]
    if not brackets:
        raise RuntimeError('No lunar encounter bracket found; adjust design apogee or phase sweep.')
    left, right = brackets[0]
    def objective(ph):
        return propagate_to_perilune(ph, parking_km, apogee_design_km)[0] - target_radius
    return float(brentq(objective, left, right, xtol=1e-9))


def solve_transfer(parking_km=200.0, perilune_km=100.0,
                   apogee_design_km=A_MOON, post_hours=14.0) -> Transfer:
    phase_deg = target_phase(parking_km, perilune_km, apogee_design_km)
    dist, t_peri, state, pre_full = propagate_to_perilune(
        phase_deg, parking_km, apogee_design_km)
    if state is None:
        raise RuntimeError('Perilune event missing')
    moon_r, moon_v = moon_state(t_peri, np.deg2rad(phase_deg))
    r_rel = state[:3] - moon_r
    v_rel = state[3:] - moon_v
    er = r_rel / np.linalg.norm(r_rel)
    v_tan = v_rel - np.dot(v_rel, er) * er
    et = v_tan / np.linalg.norm(v_tan)
    v_moon_circ = np.sqrt(MU_M / np.linalg.norm(r_rel))
    v_goal = moon_v + v_moon_circ * et
    loi_dv = float(np.linalg.norm(state[3:] - v_goal))
    capture_y = state.copy()
    capture_y[3:] = v_goal
    phase = np.deg2rad(phase_deg)
    post = solve_ivp(
        spacecraft_rhs, (t_peri, t_peri + post_hours * 3600.0), capture_y,
        args=(phase,), dense_output=True, rtol=3e-10, atol=3e-11,
        max_step=140.0,
    )
    if not post.success:
        raise RuntimeError(post.message)
    post_t = np.linspace(t_peri, t_peri + post_hours * 3600, 500)
    post_y = post.sol(post_t)[:3].T
    post_rm = np.array([moon_state(t, phase)[0] for t in post_t])
    post_alt = np.linalg.norm(post_y - post_rm, axis=1) - R_M
    y0, v_leo, v_tli, _ = injection_state(parking_km, apogee_design_km)
    return Transfer(
        parking_km, perilune_km, apogee_design_km,
        phase_deg, float(t_peri), state,
        float(v_tli-v_leo), loi_dv,
        float(v_leo), float(v_tli),
        float(np.linalg.norm(v_rel)), float(v_moon_circ),
        pre_full, post, float(np.min(post_alt)), float(np.max(post_alt))
    )


def sample(transfer: Transfer, n_pre=1100, n_post=700):
    ph = np.deg2rad(transfer.phase_deg)
    t_pre = np.linspace(0.0, transfer.t_peri, n_pre)
    t_post = np.linspace(transfer.post.t[0], transfer.post.t[-1], n_post)
    p_pre = transfer.pre.sol(t_pre)[:3].T
    p_post = transfer.post.sol(t_post)[:3].T
    moon_pre = np.array([moon_state(t, ph)[0] for t in t_pre])
    moon_post = np.array([moon_state(t, ph)[0] for t in t_post])
    return t_pre, p_pre, moon_pre, t_post, p_post, moon_post


def in_plane(xyz: np.ndarray):
    return np.column_stack((xyz @ E1, xyz @ E2))


def make_plots(transfer: Transfer, out: Path):
    tpre, pre, moonpre, tpost, post, moonpost = sample(transfer)
    p, m, ppost, mpost = map(in_plane, (pre, moonpre, post, moonpost))
    phase = np.deg2rad(transfer.phase_deg)
    angles = np.linspace(0, 2*np.pi, 600)
    moon_circle = A_MOON * np.column_stack((np.cos(angles), np.sin(angles)))
    plt.rcParams.update({'font.family':'DejaVu Sans','font.size':11,
                          'figure.facecolor':'white','axes.spines.top':False,
                          'axes.spines.right':False})

    # Figure 1: Earth-centered trajectory, moving Moon.
    fig, ax = plt.subplots(figsize=(11,9), dpi=140)
    ax.plot(moon_circle[:,0]/1000, moon_circle[:,1]/1000, ls='--',
            lw=1.4, color='#aeb8c2', label='Moon reference orbit')
    ax.plot(m[:,0]/1000,m[:,1]/1000, color='#c7cdd5',lw=3,alpha=.75,
            label='Moon motion during cruise')
    ax.plot(p[:,0]/1000,p[:,1]/1000, color='#087e8b',lw=3.2,
            label='Spacecraft Earth-to-Moon transfer')
    ax.scatter([0],[0],s=340,color='#1976b9',zorder=5,label='Earth')
    ax.scatter([m[0,0]/1000],[m[0,1]/1000],s=105,facecolors='none',
               edgecolors='#9b59b6',linewidth=2,zorder=6,label='Moon at TLI')
    ax.scatter([m[-1,0]/1000],[m[-1,1]/1000],s=200,color='#776e65',zorder=7,
               label='Moon at LOI')
    ax.scatter([p[-1,0]/1000],[p[-1,1]/1000],s=50,color='#ef8a23',zorder=8,
               label='Spacecraft at perilune')
    ax.annotate('TLI', (p[0,0]/1000,p[0,1]/1000),xytext=(18,14),textcoords='offset points')
    ax.annotate(f'LOI / perilune\nDay {transfer.t_peri/DAY:.2f}',
                (p[-1,0]/1000,p[-1,1]/1000), xytext=(-275,-115),
                textcoords='data',ha='center',arrowprops={'arrowstyle':'->'})
    for ix in [int(len(p)*f) for f in [.2,.45,.7]]:
        ax.annotate('', xy=p[ix]/1000,xytext=p[ix-7]/1000,
                    arrowprops={'arrowstyle':'-|>','color':'#087e8b','lw':1.8})
    ax.set(xlabel='In-plane x [thousand km]',ylabel='In-plane y [thousand km]',
           title='Earth–Moon Direct Transfer | Earth-Centered Geometry')
    ax.set_aspect('equal');ax.grid(alpha=.22)
    ax.legend(loc='upper right',fontsize=9,frameon=True)
    fig.tight_layout();fig.savefig(out/'01_earth_moon_transfer_2d.png',dpi=180);plt.close(fig)

    # Figure 2: 3D, actual 5.145 degree tilt (not exaggerated).
    fig=plt.figure(figsize=(11,9),dpi=140)
    ax=fig.add_subplot(111,projection='3d')
    moon_xyz=A_MOON*(np.outer(np.cos(angles),E1)+np.outer(np.sin(angles),E2))
    ax.plot(*(moon_xyz.T/1000), color='#aeb8c2',linestyle='--',lw=1.3,
            label='Moon orbit (inclined 5.145°)')
    ax.plot(*(moonpre.T/1000),color='#c7cdd5',lw=2.8,label='Moon motion')
    ax.plot(*(pre.T/1000),color='#087e8b',lw=3,label='Spacecraft')
    ax.scatter([0],[0],[0],s=180,color='#1976b9',label='Earth')
    ax.scatter(*(moonpre[-1]/1000),s=105,color='#776e65',label='Moon at encounter')
    ax.scatter(*(pre[-1]/1000),s=34,color='#ef8a23',label='LOI')
    ax.set(xlabel='Reference x [1000 km]',ylabel='Reference y [1000 km]',
           zlabel='Reference z [1000 km]',
           title='Earth–Moon Transfer | Inclined Circular-Moon Model')
    ax.set_box_aspect((1,1,1))
    ax.set(xlim=(-430,430),ylim=(-430,430),zlim=(-430,430))
    ax.view_init(elev=22,azim=45)
    ax.legend(loc='upper left',fontsize=9)
    fig.tight_layout();fig.savefig(out/'02_earth_moon_transfer_3d.png',dpi=180);plt.close(fig)

    # Figure 3: moon-relative close-up of pre- and post-capture motion.
    # Plot only last ~2 h before LOI to limit the axis span.
    fig,ax=plt.subplots(figsize=(9,8),dpi=140)
    cut=tpre>=transfer.t_peri-2.6*3600
    xpre=(p-m)[cut]
    xpost=ppost-mpost
    ax.plot(xpre[:,0],xpre[:,1],lw=2.3,color='#ef8a23',label='Incoming, before LOI')
    ax.plot(xpost[:,0],xpost[:,1],lw=2,color='#087e8b',label='After LOI (capture)')
    ax.add_patch(Circle((0,0),R_M,facecolor='#b1aca5',edgecolor='#655c54',lw=1.5,
                        label='Moon (mean radius)'))
    ax.scatter([xpre[-1,0]],[xpre[-1,1]],s=65,color='#b21b1b',zorder=6,
               label=f'LOI at {transfer.perilune_km:.0f} km altitude')
    ax.set(xlabel='Moon-centered x [km]',ylabel='Moon-centered y [km]',
           title='Lunar Approach and Impulsive Circularization')
    ax.set_aspect('equal');ax.grid(alpha=.23)
    ax.set(xlim=(-6000,6000),ylim=(-6000,6000))
    ax.legend(loc='upper right',fontsize=9)
    fig.tight_layout();fig.savefig(out/'03_lunar_approach_and_capture.png',dpi=180);plt.close(fig)

    # Figure 4: Transfer time history.
    d=np.linalg.norm(pre-moonpre,axis=1)
    d_post=np.linalg.norm(post-moonpost,axis=1)
    fig,axs=plt.subplots(2,1,figsize=(10,8),dpi=140)
    axs[0].plot(tpre/DAY,d/1000,lw=2.3,color='#087e8b')
    axs[0].axhline(R_M/1000,color='#b21b1b',ls=':',label='Lunar surface radius')
    axs[0].set(xlabel='Time since TLI [days]',ylabel='Distance to Moon [1000 km]',
               title='Spacecraft–Moon Distance During Transfer')
    axs[0].grid(alpha=.25);axs[0].legend()
    axs[1].plot((tpost-transfer.t_peri)/3600,d_post-R_M,color='#087e8b',lw=2)
    axs[1].axhline(transfer.perilune_km,color='#a4a4a4',ls='--',
                   label='Target altitude')
    axs[1].set(xlabel='Time since LOI [hours]',ylabel='Altitude above mean lunar sphere [km]',
               title='Post-LOI Altitude: Earth–Moon Gravity Still Active')
    axs[1].grid(alpha=.25);axs[1].legend()
    fig.tight_layout(h_pad=2);fig.savefig(out/'04_transfer_range_and_capture_altitude.png',dpi=180);plt.close(fig)

    # Figure 5: Mission Δv accounting, impulsive only.
    fig,ax=plt.subplots(figsize=(9,5),dpi=140)
    phases=['Trans-lunar injection\n(from circular LEO)','Lunar orbit insertion\n(at perilune)']
    dvs=[transfer.tli_dv,transfer.loi_dv]
    bars=ax.barh(phases,dvs,color=['#087e8b','#ef8a23'],height=.5)
    for bar,x in zip(bars,dvs):
        ax.text(x+0.04,bar.get_y()+bar.get_height()/2,f'{x:.3f} km/s',va='center')
    ax.invert_yaxis();ax.set(xlabel='Impulsive Δv [km/s]',
                            title=f'Illustrative Δv Budget | Total {sum(dvs):.3f} km/s')
    ax.set_xlim(0,max(dvs)*1.25);ax.grid(axis='x',alpha=.25)
    fig.tight_layout();fig.savefig(out/'05_impulsive_dv_budget.png',dpi=180);plt.close(fig)

    # Optional interactive plot, self-contained HTML.
    try:
        import plotly.graph_objects as go
        f=go.Figure()
        f.add_trace(go.Scatter3d(x=moon_xyz[:,0],y=moon_xyz[:,1],z=moon_xyz[:,2],
                                 mode='lines',line=dict(color='lightgray',dash='dash',width=3),
                                 name='Moon reference orbit'))
        f.add_trace(go.Scatter3d(x=moonpre[:,0],y=moonpre[:,1],z=moonpre[:,2],
                                 mode='lines',line=dict(color='gray',width=5),name='Moon during flight'))
        f.add_trace(go.Scatter3d(x=pre[:,0],y=pre[:,1],z=pre[:,2],mode='lines',
                                 line=dict(color='#087e8b',width=7),name='Spacecraft'))
        for name,xyz,size,color in [('Earth',np.zeros(3),9,'#1976b9'),
                                    ('Moon at departure',moonpre[0],5,'#9b59b6'),
                                    ('Moon at perilune',moonpre[-1],8,'#776e65')]:
            f.add_trace(go.Scatter3d(x=[xyz[0]],y=[xyz[1]],z=[xyz[2]],
                                     mode='markers',marker=dict(size=size,color=color),name=name))
        f.update_layout(title='Interactive Earth–Moon Transfer (idealized circular lunar orbit)',
                        scene=dict(aspectmode='data',xaxis_title='x [km]',
                                   yaxis_title='y [km]',zaxis_title='z [km]'),
                        legend=dict(orientation='h',y=-.1),margin=dict(l=5,r=5,b=5,t=50))
        f.write_html(str(out/'06_interactive_3d.html'),include_plotlyjs=True)
    except ImportError:
        pass


def earth_only_energy_test():
    """Numerical unit check: Earth two-body propagation conserves specific energy."""
    r0 = R_E + 200.0
    v0 = np.sqrt(MU_E/r0)
    s0 = np.array([r0,0,0,0,v0,0])
    def rhs(t,y):
        r=y[:3]
        return np.r_[y[3:],-MU_E*r/np.linalg.norm(r)**3]
    sol=solve_ivp(rhs,(0,4*3600),s0,rtol=1e-11,atol=1e-12,max_step=70)
    energy=.5*np.sum(sol.y[3:]**2,axis=0)-MU_E/np.linalg.norm(sol.y[:3],axis=0)
    err=np.max(np.abs((energy-energy[0])/energy[0]))
    assert err < 1e-8, f'Earth-only energy check failed: {err}'
    return float(err)


def metrics(tr: Transfer, energy_error: float):
    return {
        'model':'Earth-centered 3D gravity: Earth + inclined circular Moon + indirect term',
        'reference_epoch':'Day 0 (phase is optimized; NOT a real calendar epoch)',
        'parking_orbit_altitude_km':tr.parking_km,
        'perilune_target_altitude_km':tr.perilune_km,
        'perilune_actual_altitude_km':float(np.linalg.norm(
             tr.y_peri[:3]-moon_state(tr.t_peri,np.deg2rad(tr.phase_deg))[0])-R_M),
        'lunar_phase_at_departure_deg':tr.phase_deg,
        'travel_time_days':tr.t_peri/DAY,
        'moon_model_period_days':MOON_PERIOD_DAYS,
        'tli_delta_v_km_s':tr.tli_dv,
        'loi_delta_v_km_s':tr.loi_dv,
        'total_impulsive_delta_v_km_s':tr.tli_dv+tr.loi_dv,
        'lunar_relative_speed_before_loi_km_s':tr.v_lunar_peri,
        'lunar_circular_speed_after_loi_km_s':tr.v_circ_moon,
        'post_loi_min_altitude_km':tr.min_post_altitude,
        'post_loi_max_altitude_km':tr.max_post_altitude,
        'ideal_lunar_circular_period_hours':2*np.pi*np.sqrt((R_M+tr.perilune_km)**3/MU_M)/3600,
        'earth_only_energy_relative_error':energy_error,
        'not_included':['real Moon ephemeris','solar gravity','Earth J2','Moon mascons',
                        'true launch date / launch site','finite burns','polar orbit targeting',
                        'full B-plane targeting','navigation margins'],
    }


def parking_trade(out: Path, perilune_km: float, post_hours: float):
    records=[]
    for h in (200., 400., 800.):
        sol=solve_transfer(parking_km=h,perilune_km=perilune_km,
                           post_hours=post_hours)
        records.append({'earth_parking_altitude_km':h,
                        'transfer_time_days':round(sol.t_peri/DAY,4),
                        'lunar_phase_deg':round(sol.phase_deg,5),
                        'tli_dv_km_s':round(sol.tli_dv,5),
                        'loi_dv_km_s':round(sol.loi_dv,5),
                        'total_dv_km_s':round(sol.tli_dv+sol.loi_dv,5)})
    with open(out/'parking_orbit_trade.csv','w',newline='') as f:
        wr=csv.DictWriter(f,fieldnames=list(records[0].keys()))
        wr.writeheader();wr.writerows(records)
    fig,ax=plt.subplots(figsize=(9,5.5),dpi=140)
    h=np.array([x['earth_parking_altitude_km'] for x in records])
    tli=np.array([x['tli_dv_km_s'] for x in records]);loi=np.array([x['loi_dv_km_s'] for x in records])
    ax.bar(h,tli,width=130,color='#087e8b',label='TLI')
    ax.bar(h,loi,bottom=tli,width=130,color='#ef8a23',label='LOI')
    for x,y in zip(h,tli+loi):ax.text(x,y+.03,f'{y:.3f}',ha='center')
    ax.set(xlabel='Initial circular Earth parking altitude [km]',
           ylabel='TLI + LOI impulsive Δv [km/s]',
           title='Parking-Orbit Altitude Trade (not launch vehicle cost)')
    ax.set_xticks(h);ax.legend();ax.grid(axis='y',alpha=.22)
    fig.tight_layout();fig.savefig(out/'07_parking_orbit_trade.png',dpi=180);plt.close(fig)
    return records


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    # The four mission-input controls (site, parking altitude, inclination, azimuth).
    # Inclination/azimuth can be omitted or cross-checked against each other.
    parser.add_argument('--launch-site',choices=sorted(SITES),default='kennedy',help='Launch-pad preset for geometric screening; NOT coupled to lunar transfer plane')
    parser.add_argument('--parking-km',type=float,default=200.,help='Initial Earth circular parking altitude [km]')
    parser.add_argument('--parking-inc-deg',type=float,default=None,help='Geometric target parking inclination [deg]')
    parser.add_argument('--azimuth-deg',type=float,default=None,help='INERTIAL horizontal heading clockwise from north [deg], not pad steering')
    parser.add_argument('--compare-inc-deg',type=float,default=40.,help='Common parking inclination for the four-launch-site comparison [deg]')
    parser.add_argument('--perilune-km',type=float,default=100.,help='Requested lunar arrival periapsis altitude [km]')
    parser.add_argument('--apogee-km',type=float,default=A_MOON,help='Earth 2-body design apogee radius [km]')
    parser.add_argument('--post-hours',type=float,default=14.,help='Hours propagated after LOI')
    parser.add_argument('--skip-trade',action='store_true',help='Skip three-altitude comparison')
    parser.add_argument('--output',default='output',help='Output folder')
    args=parser.parse_args()
    if args.parking_km < 100 or args.perilune_km < 20 or args.post_hours <= 0:
        parser.error('Use parking>=100 km, perilune>=20 km and positive post-hours')
    out=Path(args.output).resolve();out.mkdir(parents=True,exist_ok=True)
    # Fail closed: a launch geometry mismatch must not be reported as a feasible
    # coupled mission. Run launch_geometry.py alone to study an invalid case.
    launch_case=analyze_launch(args.launch_site,args.parking_km,
                               args.parking_inc_deg,args.azimuth_deg)
    if not launch_case['geometry']['input_consistency_pass']:
        parser.error('Direct launch geometry impossible/inconsistent. Run launch_geometry.py to inspect the infeasible case.')
    comparison_cases=compare_launch_sites(args.parking_km,args.compare_inc_deg)
    export_launch(out,launch_case,comparison_cases)
    test_err=earth_only_energy_test()
    result=solve_transfer(args.parking_km,args.perilune_km,args.apogee_km,args.post_hours)
    report=metrics(result,test_err)
    report['launch_site_screening']=launch_case
    report['transfer_plane_coupled_to_launch_site']=False
    assert abs(report['perilune_actual_altitude_km']-args.perilune_km)<.05
    assert report['post_loi_min_altitude_km']>0, 'Captured orbit intersects lunar surface'
    make_plots(result,out)
    if not args.skip_trade:
        report['parking_trade']=parking_trade(out,args.perilune_km,args.post_hours)
    (out/'mission_metrics.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(report,indent=2))
    print('\nIMPORTANT: Launch-site geometry is a screening result only. The lunar transfer\n'
          'still uses the original fixed plane; do NOT interpret site changes as a\n'
          'site-specific TLI/LOI trajectory or verified launch opportunity.')
    print('\nFigures and metrics saved to',out)

if __name__=='__main__':
    main()
