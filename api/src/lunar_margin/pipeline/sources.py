"""다운로드할 NASA 원천 데이터 목록. 선정 이유와 버전은 docs/data.md 참고."""

from dataclasses import dataclass

_PDS_POLAR = (
    "https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/"
    "lrolol_1xxx/data/lola_gdr/polar/float_img"
)
_NAIF = "https://naif.jpl.nasa.gov/pub/naif/generic_kernels"


@dataclass(frozen=True)
class Source:
    name: str
    url: str
    filename: str
    size_bytes: int | None = None


def _dem(stem: str, img_bytes: int) -> tuple[Source, Source]:
    return (
        Source(
            f"LOLA {stem} (img)", f"{_PDS_POLAR}/{stem}_float.img", f"{stem}_float.img", img_bytes
        ),
        Source(f"LOLA {stem} (label)", f"{_PDS_POLAR}/{stem}_float.lbl", f"{stem}_float.lbl"),
    )


# 키: 해상도 이름. 값: (이미지, 라벨)
DEM_SOURCES: dict[str, tuple[Source, Source]] = {
    "80s_80m": _dem("ldem_80s_80m", 231_040_000),
    "80s_40m": _dem("ldem_80s_40m", 924_160_000),
    "85s_20m": _dem("ldem_85s_20m", 920_272_896),
}

SPICE_SOURCES: tuple[Source, ...] = (
    Source("NAIF leapseconds", f"{_NAIF}/lsk/naif0012.tls", "naif0012.tls"),
    Source("JPL DE440s ephemeris", f"{_NAIF}/spk/planets/de440s.bsp", "de440s.bsp"),
    Source("NAIF planetary constants", f"{_NAIF}/pck/pck00011.tpc", "pck00011.tpc"),
    Source(
        "Moon principal-axes orientation (DE440)",
        f"{_NAIF}/pck/moon_pa_de440_200625.bpc",
        "moon_pa_de440_200625.bpc",
    ),
    Source(
        "Moon frames (DE440)", f"{_NAIF}/fk/satellites/moon_de440_250416.tf", "moon_de440_250416.tf"
    ),
)
