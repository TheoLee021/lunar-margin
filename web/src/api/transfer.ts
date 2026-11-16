import { ApiError, getJson, type RequestOptions } from './client'
import { TransferDataSchema } from '../mission/transferData'

export async function fetchTransfer(
  departure: string,
  arrival: string,
  options?: RequestOptions,
  approach?: { latitude: number; longitude: number; durationS: number },
) {
  const start = `${departure}T00:00:00Z`
  const end = `${arrival}T00:00:00Z`
  const query = new URLSearchParams({ departure: start, arrival: end })
  if (approach) {
    query.set('latitude', String(approach.latitude))
    query.set('longitude', String(approach.longitude))
    query.set('duration_s', String(approach.durationS))
  }
  const result = await getJson(
    `/trajectory/transfer?${query}`,
    TransferDataSchema,
    options,
  )
  if (
    Date.parse(result.departure) !== Date.parse(start) ||
    Date.parse(result.arrival) !== Date.parse(end)
  ) {
    throw new ApiError('Trajectory does not match the selected dates', 200)
  }
  return result
}
