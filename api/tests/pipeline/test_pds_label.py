import pytest

from lunar_margin.pipeline.pds_label import parse_label

# data/dem/ldem_80s_80m_float.lbl 의 핵심 줄
SAMPLE = """
  OBJECT                  = IMAGE
    LINES                 = 7600
    LINE_SAMPLES          = 7600
    SAMPLE_TYPE           = PC_REAL
    SAMPLE_BITS           = 32
    UNIT                  = KILOMETER
    SCALING_FACTOR        = 1
    OFFSET                = 1737.4
  END_OBJECT              = IMAGE
OBJECT                    = IMAGE_MAP_PROJECTION
 MAP_PROJECTION_TYPE          = "POLAR STEREOGRAPHIC"
 A_AXIS_RADIUS                = 1737.4 <km>
 CENTER_LATITUDE              = -90 <deg>
 CENTER_LONGITUDE             = 0 <deg>
 MAP_SCALE                    = 80 <m/pix>
 LINE_PROJECTION_OFFSET       = 3799.5 <pix>
 SAMPLE_PROJECTION_OFFSET     = 3799.5 <pix>
END_OBJECT                    = IMAGE_MAP_PROJECTION
"""


def test_parse_label_real_sample() -> None:
    label = parse_label(SAMPLE)

    assert label.lines == 7600
    assert label.samples == 7600
    assert label.map_scale_m == 80.0
    assert label.line_offset == 3799.5
    assert label.sample_offset == 3799.5
    assert label.radius_km == 1737.4
    assert label.height_offset_km == 1737.4
    assert label.center_lat_deg == -90.0


def test_offset_key_does_not_match_projection_offset() -> None:
    text = SAMPLE.replace("    OFFSET                = 1737.4\n", "")

    with pytest.raises(ValueError, match="OFFSET"):
        parse_label(text)


def test_parse_label_missing_key_raises() -> None:
    with pytest.raises(ValueError, match="MAP_SCALE"):
        parse_label(SAMPLE.replace("MAP_SCALE", "MAP_SCALX"))


def test_rejects_non_polar_stereographic() -> None:
    with pytest.raises(ValueError, match="POLAR STEREOGRAPHIC"):
        parse_label(SAMPLE.replace("POLAR STEREOGRAPHIC", "SINUSOIDAL"))


def test_rejects_non_float32_little_endian() -> None:
    with pytest.raises(ValueError, match="PC_REAL"):
        parse_label(SAMPLE.replace("PC_REAL", "MSB_INTEGER"))
