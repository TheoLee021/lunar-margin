import base64
from pathlib import Path

import httpx
import pytest

from lunar_margin.pipeline.diviner import fetch_diviner

LABEL = base64.decodebytes((Path(__file__).parent / "fixtures" / "diviner.lbl.b64").read_bytes())


def test_rejects_changed_label_before_downloading_temperature(tmp_path: Path) -> None:
    def respond(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith(".lbl")
        return httpx.Response(200, content=b"x" * len(LABEL))

    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        with pytest.raises(ValueError, match="Diviner label"):
            fetch_diviner(tmp_path, client=client)
    assert not list(tmp_path.rglob("*.tab"))


def test_valid_label_is_recorded_but_truncated_table_is_not_published(tmp_path: Path) -> None:
    import hashlib
    import json

    def respond(request: httpx.Request) -> httpx.Response:
        content = LABEL if request.url.path.endswith(".lbl") else b"truncated"
        return httpx.Response(200, content=content)

    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        with pytest.raises(ValueError, match="expected 212653759 B"):
            fetch_diviner(tmp_path, client=client)

    destination = tmp_path / "diviner"
    manifest = json.loads((destination / "manifest.json").read_text())
    assert len(manifest) == 1
    entry = manifest["pcp_avg_tbol_pols_sum_ltim01_240.lbl"]
    assert entry["sha256"] == hashlib.sha256(LABEL).hexdigest()
    assert entry["size_bytes"] == 3637
    assert entry["url"].startswith("https://pds-geosciences.wustl.edu/lro/")
    assert not list(destination.glob("*.tab*"))
