# VS Code First Run (Windows)

## 1. Open this folder in VS Code
Open the extracted `lunar_margin_vscode` folder itself, not its parent folder.

## 2. Open Terminal in VS Code
`Terminal > New Terminal`

## 3. Create a virtual environment

```powershell
py -3.12 -m venv .venv
```

If `py -3.12` is unavailable, use:

```powershell
python -m venv .venv
```

## 4. Activate it

PowerShell:

```powershell
.\.venv\Scripts\Activate.ps1
```

If PowerShell blocks activation, run once in that terminal:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\.venv\Scripts\Activate.ps1
```

## 5. Install dependencies

```powershell
python -m pip install --upgrade pip
pip install -r requirements.txt
```

## 6. Download NAIF SPICE kernels

```powershell
python scripts\download_kernels.py
```

This downloads the minimal kernel set into `kernels/`.

## 7. First execution: SPICE only, flat horizon

```powershell
python scripts\quickstart.py
```

Expected ending:

```text
PASS: SPICE geometry is running. Next step: terrain-aware horizon.
```

This proves:

`UTC + lunar site -> SPICE -> Sun/Earth azimuth/elevation/range`

works locally.

## 8. Then try the terrain-aware run

```powershell
python scripts\run_trade.py
```

This uses the NASA PGDA remote COG DEM. It may be slower and may fail on some Windows/GDAL installations if `/vsicurl/` HTTP access is unavailable. If that happens, do not debug SPICE again: the geometry is already validated by step 7. Download the DEM locally or switch `DEFAULT_DEM_URL` to a local GeoTIFF path.

## VS Code Run button
After setup, open **Run and Debug** and choose:

- `Lunar Margin: Quickstart`
- `Lunar Margin: Full Trade`

## Kernel choice
The quickstart uses:

- `naif0012.tls`
- `de440s.bsp`
- `pck00011.tpc`
- `moon_pa_de421_1900-2050.bpc`
- `moon_080317.tf`

`moon_080317.tf` defines the `MOON_ME` frame using the DE421 lunar-orientation frame, so this package pairs it with the DE421 lunar binary PCK. The planetary position SPK remains DE440s.
