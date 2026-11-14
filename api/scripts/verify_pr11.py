"""Local PR #11 smoke test against a running FastAPI server (NASA data required).

Run from api/: uv run python scripts/verify_pr11.py
Does not claim independent scientific validation of the LOLA/SPICE datasets.
"""

import json
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import urlopen

BASE = "http://localhost:8000"
PARAMS = {
    "lat": -89.83,
    "lon": -153.7,
    "start": "2027-01-10T00:00:00Z",
    "end": "2027-01-24T00:00:00Z",
    "step_minutes": 30,
}


def get(path: str, params: dict[str, str | float | int] | None = None) -> dict:
    url = BASE + path + ("?" + urlencode(params) if params else "")
    with urlopen(url, timeout=180) as response:
        return json.load(response)


def require(test: bool, description: str) -> None:
    if not test:
        raise AssertionError(description)
    print("PASS:", description)


def main() -> None:
    try:
        require(get("/health")["status"] == "ok", "API health")
        combined = get("/analysis/site-assessment", PARAMS)
        region = combined["region"]
        terrain = combined["terrain"]
        require(combined["sun"]["visible_fraction"] >= 0, "Sun summary returned")
        require(combined["earth"]["visible_fraction"] >= 0, "Earth summary returned")
        require(terrain["dem_pixel_m"] == 80, "LOLA 80 m terrain source")
        require(region["radius_m"] == 250, "250 m circular region")
        require(region["sample_step_m"] == 80, "Regional sampling uses DEM pixel spacing")
        require(
            0 <= region["valid_samples"] <= region["total_samples"],
            "DEM coverage counts are coherent",
        )
        require(
            abs(region["coverage_fraction"] - region["valid_samples"] / region["total_samples"])
            < 0.0001,
            "DEM coverage fraction matches sample counts",
        )
        require(
            region["landing_safety_status"] == "UNVERIFIED",
            "Environmental PASS never certifies landing safety",
        )
        require(
            region["slope_p95_deg"] is None
            or (0 <= region["slope_p95_deg"] <= region["slope_max_deg"]),
            "Regional slope percentiles are ordered",
        )
        for body, endpoint in (
            ("sun", "/analysis/illumination"),
            ("earth", "/analysis/earth-visibility"),
        ):
            detailed = get(endpoint, {**PARAMS, "observer_height_m": 0})
            delta_fraction = abs(
                combined[body]["visible_fraction"] - detailed["metrics"]["visible_fraction"]
            )
            delta_dark = abs(
                combined[body]["longest_dark_hours"] - detailed["metrics"]["longest_dark_hours"]
            )
            print(
                f"{body.upper()}: PR11 {combined[body]['visible_fraction'] * 100:.2f}%"
                f" vs detailed {detailed['metrics']['visible_fraction'] * 100:.2f}%;"
                f" delta={delta_fraction * 100:.2f} percentage points,"
                f" max-dark delta={delta_dark:.2f} h"
            )
            require(0 <= detailed["metrics"]["visible_fraction"] <= 1, f"{body} detailed LOS")
        try:
            get("/analysis/site-assessment", {**PARAMS, "lat": -79})
        except HTTPError as exc:
            require(exc.code == 422, "Invalid latitude rejected with HTTP 422")
        else:
            raise AssertionError("Invalid latitude was accepted")
        print("RESULT: Local API and regional-screening checks passed.")
        print("NOTE: LOS sampling deltas are reported, not assumed zero.")
        print("NOTE: 80 m DEM cannot verify landing footpad hazards or bearing strength.")
    except URLError as exc:
        raise SystemExit(f"Cannot reach {BASE}; start FastAPI first: {exc}") from exc


if __name__ == "__main__":
    main()
