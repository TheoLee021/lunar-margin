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
    # 75°S 이남(극에서 약 457 km). 85°S 이남 ROI의 수평선을 200 km까지 DEM 안에서 계산할 수 있다
    "75s_120m": _dem("ldem_75s_120m", 232_501_504),
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


@dataclass(frozen=True)
class ZipMemberSource:
    """원격 zip 안의 파일 하나. 이름이 member_suffix로 끝나는 항목을 filename으로 저장한다."""

    name: str
    url: str
    member_suffix: str
    filename: str


_SFS_RECORD = "https://zenodo.org/api/records/17954508/files"
# Artemis III 후보 착륙 지역(2022) 13곳의 Shape-from-Shading DEM. zip 이름 = 지역 번호와 이름
_SFS_REGIONS = (
    "A3CLR22_0_Amundsen_Rim",
    "A3CLR22_1_Nobile_Rim_2",
    "A3CLR22_2_Haworth",
    "A3CLR22_3_Faustini_Rim_A",
    "A3CLR22_4_deGerlache_Rim_2",
    "A3CLR22_5_Connecting_Ridge_Extension",
    "A3CLR22_6_Connecting_Ridge",
    "A3CLR22_7_Nobile_Rim_1",
    "A3CLR22_8_Peak_Near_Shackleton",
    "A3CLR22_9_deGerlache_Rim",
    "A3CLR22_10_Leibnitz_Beta_Plateau",
    "A3CLR22_11_Malapert_Massif",
    "A3CLR22_12_deGerlache_Kocher_Massif",
)
# 지역마다 1~4 GB인 zip에서 5 m 고도 래스터(20~60 MB)만 받는다
SFS_SOURCES: tuple[ZipMemberSource, ...] = tuple(
    ZipMemberSource(
        f"SfS 5 m DEM {region}",
        f"{_SFS_RECORD}/{region}.zip/content",
        "_GLDELEV_005.tif",
        f"{region}_GLDELEV_005.tif",
    )
    for region in _SFS_REGIONS
)
