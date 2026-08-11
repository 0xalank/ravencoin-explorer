import { useCallback, useEffect, useState } from 'react'
import type { ApiEnvelope, ApiMeta } from '../types'

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export async function api<T>(path: string, signal?: AbortSignal): Promise<ApiEnvelope<T>> {
  const response = await fetch(path, { signal, headers: { accept: 'application/json' } })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new ApiError(payload?.error?.message ?? 'Unable to load explorer data.', response.status)
  return payload
}

export function useApi<T>(path: string | null, refreshMs = 0) {
  const [data, setData] = useState<T | null>(null)
  const [meta, setMeta] = useState<ApiMeta | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [loading, setLoading] = useState(Boolean(path))
  const [nonce, setNonce] = useState(0)
  const refetch = useCallback(() => setNonce((value) => value + 1), [])

  useEffect(() => {
    if (!path) return
    const controller = new AbortController()
    let active = true
    setLoading(true)
    setError(null)
    api<T>(path, controller.signal)
      .then((result) => {
        if (!active) return
        setData(result.data)
        setMeta(result.meta)
      })
      .catch((reason) => {
        if (active && reason.name !== 'AbortError') setError(reason)
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false; controller.abort() }
  }, [path, nonce])

  useEffect(() => {
    if (!refreshMs) return
    const timer = window.setInterval(refetch, refreshMs)
    return () => window.clearInterval(timer)
  }, [refreshMs, refetch])

  return { data, meta, error, loading, refetch }
}
