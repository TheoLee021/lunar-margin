"""Real concurrent HTTP calls run in a child: unsafe CSPICE can abort the process."""

import os
import subprocess
import sys
import textwrap
from pathlib import Path

import pytest

SCRIPT = textwrap.dedent("""
    import sys
    from concurrent.futures import ThreadPoolExecutor
    from fastapi.testclient import TestClient
    from lunar_margin.app.main import create_app
    from lunar_margin.app.settings import Settings

    params = dict(lat=-89.02, lon=-94.4, start="2027-01-10T00:00:00Z",
                  end="2027-01-24T00:00:00Z", step_minutes=30)
    with TestClient(create_app(Settings())) as client:
        def request(kind):
            response = client.get("/analysis/" + kind, params=params)
            assert response.status_code == 200, response.text
            return response.json()
        kinds = ["illumination", "earth-visibility"]
        expected = {kind: request(kind) for kind in kinds} if sys.argv[1] == "warm" else None
        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(request, kinds * 4))
        if expected is None:
            expected = {kind: request(kind) for kind in kinds}
        for kind, result in zip(kinds * 4, results, strict=True):
            assert result == expected[kind], "concurrent computation changed the result"
        print("8 concurrent analyses match sequential results")
""")


@pytest.mark.parametrize("startup", ["cold", "warm"])
def test_concurrent_analysis_matches_sequential(data_dir: Path, startup: str) -> None:
    result = subprocess.run(
        [sys.executable, "-c", SCRIPT, startup],
        capture_output=True,
        text=True,
        timeout=30,
        env={**os.environ, "DATA_DIR": str(data_dir.resolve())},
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert "8 concurrent analyses match sequential results" in result.stdout
