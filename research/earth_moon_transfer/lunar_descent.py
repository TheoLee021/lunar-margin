#!/usr/bin/env python3
"""Educational lunar descent from a circular 100-km orbit.

2-body Moon-centered planar model, illustrative throttleable lander, idealized
impulsive DOI to a 15-km perilune, coast to powered descent initiation (PDI),
then finite-thrust guided braking and landing. This DOES NOT target a lunar
south-pole latitude/longitude, avoid hazards, model rotation/mascons or solve a
flight-ready trajectory. Units internally SI (m, s, kg, N).
"""
from __future__ import annotations
import argparse
import csv
import json
from pathlib import Path
import numpy as np
from scipy.integrate import solve_ivp
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

MU_M = 4.902800066e12    # m^3/s^2
R_M = 1737.4e3          # mean lunar sphere [m]
G0 = 9.80665            # m/s^2


def settings(orbit_km=100.0, pdi_km=15.0, mass_kg=1650.0,
             dry_mass_kg=650.0, thrust_n=8500.0, isp_s=310.0,
             max_down_m_s=20.0, target_touchdown_m_s=0.7):
    if not (orbit_km > pdi_km > 1.0):
        raise ValueError('Need orbit_km > pdi_km > 1')
    if not (mass_kg > dry_mass_kg > 0 and thrust_n > 0 and isp_s > 0):
        raise ValueError('Need positive mass/thrust/Isp and initial mass > dry mass')
    return dict(orbit_km=float(orbit_km), pdi_km=float(pdi_km),
                mass_kg=float(mass_kg), dry_mass_kg=float(dry_mass_kg),
                thrust_n=float(thrust_n), isp_s=float(isp_s),
                max_down_m_s=float(max_down_m_s),
                target_touchdown_m_s=float(target_touchdown_m_s))


def doi_to_pdi(cfg):
    r_a=R_M+1000*cfg['orbit_km']
    r_p=R_M+1000*cfg['pdi_km']
    a=(r_a+r_p)/2
    v_circ=np.sqrt(MU_M/r_a)
    v_a=np.sqrt(MU_M*(2/r_a-1/a))
    v_p=np.sqrt(MU_M*(2/r_p-1/a))
    dt=np.pi*np.sqrt(a**3/MU_M)
    # Exact Keplerian analytic impulse at apolune and coast to perilune.
    doi_fuel=cfg['mass_kg']*(1-np.exp(-(v_circ-v_a)/(cfg['isp_s']*G0)))
    return dict(doi_delta_v_m_s=float(v_circ-v_a),doi_coast_s=float(dt),
                doi_propellant_kg=float(doi_fuel),
                pdi_tangential_speed_m_s=float(v_p),pdi_radius_m=float(r_p),
                initial_circular_speed_m_s=float(v_circ))


def guidance(y,cfg):
    """Simple bounded velocity guidance; not optimal or terrain-aware.

    State [radius m, in-plane angle rad, radial velocity m/s,
           tangential velocity m/s, wet mass kg]. Positive vr is upward.
    """
    r,theta,vr,vt,m=y
    h=max(0.0,r-R_M)
    vmax=cfg['max_down_m_s']
    vfloor=cfg['target_touchdown_m_s']
    brake_up=0.7
    ref_vr=-min(vmax,np.sqrt(2*brake_up*h+vfloor*vfloor))
    # Feedforward the derivative of the flare reference near touchdown.
    flare_alt=(vmax*vmax-vfloor*vfloor)/(2*brake_up)
    ar_cmd=0.15*(ref_vr-vr)+(brake_up if h<flare_alt else 0.0)
    at_cmd=-0.014*vt
    # Remove the natural radial/along-track inertial accelerations to command
    # acceleration as a thrust vector in the Moon-centered moving polar frame.
    u_r=ar_cmd-(vt*vt/r-MU_M/r**2)
    u_t=at_cmd+(vr*vt/r)
    raw=np.hypot(u_r,u_t)
    a_max=cfg['thrust_n']/m
    scale=min(1.0,a_max/raw) if raw>0 else 1.0
    if m<=cfg['dry_mass_kg']+1e-6:
        scale=0.0  # engine out, exposes failed landing in metrics
    u_r*=scale;u_t*=scale
    thrust=m*np.hypot(u_r,u_t)
    return u_r,u_t,thrust,ref_vr


def dynamics(t,y,cfg):
    r,theta,vr,vt,m=y
    ur,ut,thrust,_=guidance(y,cfg)
    return [vr,vt/r,vt*vt/r-MU_M/r**2+ur,-vr*vt/r+ut,
            -thrust/(cfg['isp_s']*G0)]


def solve(cfg):
    doi=doi_to_pdi(cfg)
    r0=doi['pdi_radius_m']
    # After half of the elliptic deorbit coast the PDI point is opposite DOI.
    pdi_mass=cfg['mass_kg']-doi['doi_propellant_kg']
    initial=[r0,np.pi,0.0,doi['pdi_tangential_speed_m_s'],pdi_mass]
    def touch(t,y,cfg):return y[0]-R_M
    touch.terminal=True;touch.direction=-1
    sim=solve_ivp(dynamics,(0,2400),initial,args=(cfg,),events=touch,
                  rtol=5e-9,atol=1e-8,max_step=1.0,dense_output=True)
    if not sim.success or len(sim.t_events[0])!=1:
        raise RuntimeError('Landing event absent or integration failed')
    times=np.linspace(0,sim.t_events[0][0],850)
    states=sim.sol(times).T
    controls=np.array([guidance(y,cfg) for y in states])
    yfinal=sim.y_events[0][0]
    fuel_used=pdi_mass-yfinal[4]
    propellant_capacity=cfg['mass_kg']-cfg['dry_mass_kg']
    # Correct thrust-integral effective delta-v; not a second instantaneous burn.
    dv_equiv=np.trapezoid(controls[:,2]/states[:,4],times)
    landing_speed=np.hypot(yfinal[2],yfinal[3])
    status=('PASS' if abs(yfinal[2])<=1.5 and abs(yfinal[3])<=2.0
            and yfinal[4]>cfg['dry_mass_kg']+1 and yfinal[0]>=R_M-.01
            else 'FAIL')
    report=dict(model='Two-body Moon-centered planar polar equations; mean-radius flat surface',
                input=cfg,doi=doi,
                descent_duration_s=float(times[-1]),
                descent_downrange_km=float(R_M*(yfinal[1]-np.pi)/1000),
                touchdown_radial_speed_m_s=float(yfinal[2]),
                touchdown_tangential_speed_m_s=float(yfinal[3]),
                touchdown_speed_m_s=float(landing_speed),
                touchdown_propellant_remaining_kg=float(yfinal[4]-cfg['dry_mass_kg']),
                descent_propellant_used_kg=float(fuel_used),
                total_DOI_plus_descent_propellant_used_kg=float(cfg['mass_kg']-yfinal[4]),
                descent_propellant_capacity_kg=float(propellant_capacity),
                finite_thrust_integral_m_s=float(dv_equiv),
                max_thrust_used_n=float(np.max(controls[:,2])),
                thrust_saturation_fraction=float(np.mean(controls[:,2]>=cfg['thrust_n']*.999)),
                landing_status=status,
                geometry='Relative in-plane downrange only; not a named south-pole landing site',
                assumptions=['no lunar rotation','no topography/DEM/PSR',
                             'no Moon J2 or mass concentrations',
                             'no plane changes, site latitude/longitude or UTC',
                             'unlimited thrust-vector angle and throttle 0..100%',
                             'ideal state feedback; no sensor uncertainty or latency',
                             'descent stage is not modeled separately from the transfer orbiter'])
    return times,states,controls,report


def plots(out,t,y,u,report):
    plt.rcParams.update({'font.size':10,'axes.spines.top':False,'axes.spines.right':False})
    h=(y[:,0]-R_M)/1000
    downrange=R_M*(y[:,1]-np.pi)/1000
    # Full trajectory: circular orbit reference, impulsive DOI at apoapsis,
    # coast on Kepler ellipse, and a controlled descent after PDI.
    ra=R_M+report['input']['orbit_km']*1000
    rp=R_M+report['input']['pdi_km']*1000
    sma=(ra+rp)/2
    ecc=(ra-rp)/(ra+rp)
    E=np.linspace(np.pi,2*np.pi,450)
    rc=sma*(1-ecc*np.cos(E))
    f=2*np.arctan2(np.sqrt(1+ecc)*np.sin(E/2),np.sqrt(1-ecc)*np.cos(E/2))
    phi=f-np.pi
    coast_xy=np.column_stack((rc*np.cos(phi),rc*np.sin(phi)))/1000
    descent_xy=np.column_stack((y[:,0]*np.cos(y[:,1]),y[:,0]*np.sin(y[:,1])))/1000
    ang=np.linspace(0,2*np.pi,600)
    fig,ax=plt.subplots(figsize=(9,9))
    ax.plot(ra*np.cos(ang)/1000,ra*np.sin(ang)/1000,'--',color='#9ba8b4',lw=1.6,label='100-km circular parking orbit')
    ax.plot(coast_xy[:,0],coast_xy[:,1],color='#f28c28',lw=2.6,label='DOI to 15-km coast')
    ax.plot(descent_xy[:,0],descent_xy[:,1],color='#087f8c',lw=2.9,label='Finite-thrust descent')
    ax.plot(R_M*np.cos(ang)/1000,R_M*np.sin(ang)/1000,color='#6b6259',lw=2,label='Mean lunar sphere')
    ax.scatter(coast_xy[0,0],coast_xy[0,1],color='#e07f21',s=60,zorder=6,label='DOI burn')
    ax.scatter(coast_xy[-1,0],coast_xy[-1,1],color='#b62b4d',s=60,zorder=6,label='PDI at 15 km')
    ax.scatter(descent_xy[-1,0],descent_xy[-1,1],color='#174c8b',s=80,zorder=8,label='Touchdown')
    ax.set(xlabel='Moon-centered x [km]',ylabel='Moon-centered y [km]',
           title='100-km Circular Orbit → Deorbit Coast → Powered Descent → Touchdown')
    ax.set_aspect('equal');ax.grid(alpha=.23);ax.legend(loc='upper right',fontsize=9)
    fig.tight_layout();fig.savefig(out/'08_deorbit_to_landing_full.png',dpi=180);plt.close(fig)

    fig,ax=plt.subplots(figsize=(10,5.5))
    ax.plot(downrange,h,lw=2.4,color='#087f8c',label='Finite-thrust descent')
    ax.scatter([0],[report['input']['pdi_km']],color='#f28c28',label='Powered descent initiation',zorder=5)
    ax.scatter([downrange[-1]],[0],color='#d84343',label='Touchdown',zorder=5)
    ax.axhline(2,color='0.65',ls=':',label='2-km reporting gate')
    ax.set(xlabel='In-plane surface-arc downrange from PDI [km]',ylabel='Altitude above mean Moon [km]',
           title='From 15-km PDI to Touchdown | Not a Specific Lunar Site')
    ax.grid(alpha=.23);ax.legend()
    fig.tight_layout();fig.savefig(out/'09_descent_groundtrack.png',dpi=180);plt.close(fig)
    fig,axes=plt.subplots(3,1,figsize=(10,10),sharex=True)
    tm=t/60
    axes[0].plot(tm,h,color='#087f8c',lw=2.4)
    axes[0].set(ylabel='Altitude [km]',title='Powered Descent: Altitude, Velocity and Thrust')
    axes[1].plot(tm,y[:,2],label='Radial (up positive)',color='#d67c20')
    axes[1].plot(tm,y[:,3],label='Tangential (prograde positive)',color='#2773a5')
    axes[1].set(ylabel='Velocity [m/s]');axes[1].legend()
    axes[2].plot(tm,u[:,2]/1000,color='#943e88',label='Commanded thrust')
    axes[2].axhline(report['input']['thrust_n']/1000,ls='--',color='0.45',label='Maximum thrust')
    axes[2].set(xlabel='Time since PDI [min]',ylabel='Thrust [kN]');axes[2].legend()
    for ax in axes:ax.grid(alpha=.2)
    fig.tight_layout();fig.savefig(out/'10_descent_time_history.png',dpi=180);plt.close(fig)
    fig,ax=plt.subplots(figsize=(10,5.5))
    ax.plot(tm,y[:,4],color='#087f8c',lw=2.3,label='Wet vehicle mass')
    ax.axhline(report['input']['dry_mass_kg'],color='#d84343',ls='--',label='Dry-mass bound')
    ax.set(xlabel='Time since PDI [min]',ylabel='Lander mass [kg]',title='Propellant Consumption and Reserve')
    ax.grid(alpha=.22);ax.legend()
    fig.tight_layout();fig.savefig(out/'11_descent_mass_budget.png',dpi=180);plt.close(fig)


def write(out,t,y,u,report):
    out.mkdir(parents=True,exist_ok=True)
    (out/'descent_metrics.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf8')
    with (out/'descent_history.csv').open('w',newline='') as f:
        w=csv.writer(f)
        w.writerow(['time_s','altitude_km','downrange_from_pdi_km','radial_speed_m_s',
                    'tangential_speed_m_s','vehicle_mass_kg','thrust_n','throttle_fraction'])
        for ti,yi,ui in zip(t,y,u):
            w.writerow([ti,(yi[0]-R_M)/1000,R_M*(yi[1]-np.pi)/1000,yi[2],yi[3],
                        yi[4],ui[2],ui[2]/report['input']['thrust_n']])
    plots(out,t,y,u,report)


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--orbit-km',type=float,default=100)
    p.add_argument('--pdi-km',type=float,default=15)
    p.add_argument('--mass-kg',type=float,default=1650)
    p.add_argument('--dry-mass-kg',type=float,default=650)
    p.add_argument('--thrust-n',type=float,default=8500)
    p.add_argument('--isp-s',type=float,default=310)
    p.add_argument('--output',type=Path,default=Path('output'))
    args=p.parse_args()
    cfg=settings(args.orbit_km,args.pdi_km,args.mass_kg,args.dry_mass_kg,
                 args.thrust_n,args.isp_s)
    t,y,u,rep=solve(cfg)
    write(args.output,t,y,u,rep)
    print(json.dumps(rep,indent=2))
    if rep['landing_status']!='PASS':
        raise SystemExit('DESIGN FAIL: touchdown criteria or fuel reserve not satisfied')

if __name__=='__main__':main()
