"""Nominal DTE RF link-budget layer based on the team's Colab prototype."""

from __future__ import annotations

from dataclasses import dataclass
import math

C_MPS = 299_792_458.0


@dataclass
class RFConfig:
    """Reference RF configuration.

    Defaults preserve the team's early Colab assumptions and MUST be replaced
    by documented mission/ground-station values before claiming mission fidelity.
    """

    frequency_hz: float = 2.2e9
    tx_power_w: float = 10.0
    tx_gain_dbi: float = 20.0
    rx_gain_dbi: float = 65.0
    misc_loss_db: float = 3.0
    rx_required_dbm: float = -105.0
    target_margin_db: float = 3.0


def fspl_db(range_km: float, frequency_hz: float) -> float:
    d_m = range_km * 1000.0
    return 20.0 * math.log10(4.0 * math.pi * d_m * frequency_hz / C_MPS)


def link_budget(range_km: float, geometric_visible: bool, config: RFConfig) -> dict:
    """Compute nominal received power and link margin.

    LOS is a gate; FSPL itself depends only on distance and frequency.
    """
    loss_fspl_db = fspl_db(range_km, config.frequency_hz)
    tx_power_dbm = 10.0 * math.log10(config.tx_power_w) + 30.0

    rx_power_dbm = (
        tx_power_dbm
        + config.tx_gain_dbi
        + config.rx_gain_dbi
        - loss_fspl_db
        - config.misc_loss_db
    )
    link_margin_db = rx_power_dbm - config.rx_required_dbm

    if not geometric_visible:
        status = "BLOCKED"
    elif link_margin_db < config.target_margin_db:
        status = "LOW MARGIN"
    else:
        status = "AVAILABLE"

    return {
        "rf_fspl_db": loss_fspl_db,
        "rx_power_dbm": rx_power_dbm,
        "link_margin_db": link_margin_db,
        "dte_available": bool(geometric_visible and link_margin_db >= config.target_margin_db),
        "status": status,
    }
