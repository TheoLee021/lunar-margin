// Near a pole Cesium's default constrained axis (+Z) makes left-drag orbit around the pole axis
// instead of panning across it, so we release it over the polar caps. Two thresholds keep the
// axis from flipping back and forth while the camera hovers around the boundary.
const FREE_AXIS_ENTER_LATITUDE_DEG = 80
const FREE_AXIS_EXIT_LATITUDE_DEG = 75

export function shouldFreeCameraAxis(
  latitudeDeg: number,
  currentlyFree: boolean,
): boolean {
  const threshold = currentlyFree
    ? FREE_AXIS_EXIT_LATITUDE_DEG
    : FREE_AXIS_ENTER_LATITUDE_DEG
  return Math.abs(latitudeDeg) >= threshold
}
