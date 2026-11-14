# Using this package in Google Colab

1. Upload the unzipped `lunar_margin_baseline_v1` folder to Google Drive.
2. Mount Drive:

```python
from google.colab import drive
drive.mount('/content/drive')
```

3. Install dependencies:

```python
!pip install spiceypy rasterio pyproj pandas numpy
```

4. Add the project root to Python path:

```python
import sys
sys.path.append('/content/drive/MyDrive/lunar_margin_baseline_v1')
```

5. Load kernels and import modules:

```python
from lunar_margin.geometry import load_kernels, target_geometry
from lunar_margin.terrain import TerrainModel
from lunar_margin.rf_link import RFConfig, link_budget
```

6. Keep SPICE kernels in a `kernels/` directory in Drive or edit paths in `scripts/run_trade.py`.

## Recommended workflow

Use Colab for rapid experiments and validation, but keep reusable physics in `.py` modules. Export CSVs for frontend/backend integration.
