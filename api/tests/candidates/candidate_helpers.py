import numpy as np

from lunar_margin.engine.candidates.field import MetricField


def make_field(
    *,
    sun: list[float] | None = None,
    dark: list[float] | None = None,
    earth: list[float] | None = None,
    blackout: list[float] | None = None,
    complete: list[bool] | None = None,
    n: int | None = None,
) -> MetricField:
    """필요한 열만 채운 장. 채우지 않은 열은 NaN(결측). computed는 값이 하나라도 있으면 True."""
    size = n or max(len(c) for c in (sun, dark, earth, blackout, complete) if c is not None)
    field = MetricField.missing(size)
    for name, values in (
        ("sun_fraction", sun),
        ("sun_longest_dark_h", dark),
        ("earth_fraction", earth),
        ("earth_longest_blackout_h", blackout),
    ):
        if values is not None:
            getattr(field, name)[:] = values
    if complete is not None:
        field.horizon_complete[:] = complete
    any_value = np.zeros(size, dtype=np.bool_)
    for arr in (field.sun_fraction, field.sun_longest_dark_h, field.earth_fraction,
                field.earth_longest_blackout_h):  # fmt: skip
        any_value |= ~np.isnan(arr)
    field.computed[:] = any_value
    return field
