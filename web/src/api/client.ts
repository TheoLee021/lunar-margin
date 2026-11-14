import { z } from 'zod'

// 응답 스키마는 docs/api.md 와 일치해야 한다.
export const HealthSchema = z.object({ status: z.literal('ok') })
export type Health = z.infer<typeof HealthSchema>

export class ApiError extends Error {
  override name = 'ApiError'
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>

export interface RequestOptions {
  baseUrl?: string
  fetchFn?: FetchFn
  signal?: AbortSignal
}

export const DEFAULT_BASE_URL = import.meta.env.VITE_API_URL ?? '/api'

// FastAPI 에러 본문 `{"detail": ...}` 를 메시지에 담는다.
async function failureMessage(
  path: string,
  response: Response,
): Promise<string> {
  const base = `GET ${path} failed with ${response.status}`
  try {
    const body: unknown = await response.json()
    const parsed = z.object({ detail: z.unknown() }).safeParse(body)
    if (!parsed.success) return base
    const detail = parsed.data.detail
    return `${base}: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`
  } catch {
    return base
  }
}

export async function getJson<T>(
  path: string,
  schema: z.ZodType<T>,
  { baseUrl = DEFAULT_BASE_URL, fetchFn = fetch, signal }: RequestOptions = {},
): Promise<T> {
  const response = await fetchFn(`${baseUrl}${path}`, { signal })
  if (!response.ok) {
    throw new ApiError(await failureMessage(path, response), response.status)
  }
  const parsed = schema.safeParse(await response.json())
  if (!parsed.success) {
    throw new ApiError(
      `GET ${path} returned an unexpected shape`,
      response.status,
    )
  }
  return parsed.data
}

export function fetchHealth(options?: RequestOptions): Promise<Health> {
  return getJson('/health', HealthSchema, options)
}
