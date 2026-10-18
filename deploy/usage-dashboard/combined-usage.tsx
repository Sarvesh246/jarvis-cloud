import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

type Snapshot = {
  month: string
  checkedAt: string
  cloudAvailable: boolean
  local: { total: number }
  cloud?: { total: number; input: number; output: number; unreported: number; attempts: number; since: string | null; checkedAt: string }
}

export function CombinedUsage() {
  const queryClient = useQueryClient()
  const [refreshError, setRefreshError] = useState(false)
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5_000)
    return () => clearInterval(timer)
  }, [])
  const { data, isError, isFetching, refetch } = useQuery<Snapshot>({
    queryKey: ['combined-usage'],
    queryFn: async () => {
      const response = await fetch(`/usage-snapshot.json?t=${Date.now()}`, { cache: 'no-store' })
      if (!response.ok) throw new Error('Usage snapshot unavailable')
      const value = await response.json()
      if (!value?.local || typeof value.local.total !== 'number' || !value.checkedAt) throw new Error('Invalid usage snapshot')
      return value
    },
    refetchInterval: 5_000,
    retry: false,
  })
  const month = new Date(now).toISOString().slice(0, 7)
  const current = data?.month === month
  const localFresh = current && now - Date.parse(data.checkedAt) < 60_000
  const cloudFresh = localFresh && data.cloudAvailable && data.cloud && now - Date.parse(data.cloud.checkedAt) < 60_000
  const count = (n: number) => n.toLocaleString()
  const total = data ? data.local.total + (data.cloud?.total ?? 0) : 0
  async function refreshNow() {
    setRefreshError(false)
    // Refresh model/analytics queries too; the sync worker updates cloud counts
    // independently every 15 seconds, with its actual check time shown below.
    await queryClient.invalidateQueries({ predicate: query =>
      ['fallback', 'analytics'].includes(String(query.queryKey[0])) })
    const result = await refetch()
    setNow(Date.now())
    setRefreshError(Boolean(result.error))
  }
  return (
    <section className="rounded-3xl border bg-card p-5" aria-label="Local and VaeloChat token usage">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium">Local + VaeloChat usage</h2>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">{month} · UTC month</span>
          <button type="button" onClick={refreshNow} disabled={isFetching}
            title="Reload the latest counters; cloud sync runs every 15 seconds"
            className="rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50">
            {isFetching ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>
      <div className="mt-2 text-3xl font-semibold tabular-nums">{data && current ? count(total) : '—'} <span className="text-sm font-normal text-muted-foreground">recorded tokens</span></div>
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs tabular-nums text-muted-foreground">
        <span>Local: {data && current ? count(data.local.total) : '—'}</span>
        <span>VaeloChat: {data?.cloud && current ? count(data.cloud.total) : 'unavailable'}</span>
        <span>{cloudFresh ? 'Updating every 15 seconds' : 'Sync unavailable or stale; showing last recorded counts'}</span>
        {data?.cloud?.checkedAt && <span>Cloud checked: {new Date(data.cloud.checkedAt).toLocaleTimeString()}</span>}
      </div>
      {data?.cloud && <p className="mt-3 text-xs text-muted-foreground">Cloud input: {count(data.cloud.input)} · output: {count(data.cloud.output)}. {data.cloud.unreported > 0 ? `${count(data.cloud.unreported)} attempts returned incomplete token usage; the total is a lower bound. ` : ''}Cloud tracking {data.cloud.since ? `since ${new Date(data.cloud.since).toLocaleString()}` : 'starts with the next reply'}. Earlier unrecorded cloud usage is excluded.</p>}
      {(isError || !data) && <p className="mt-3 text-xs text-muted-foreground">Waiting for the local usage sync service.</p>}
      {refreshError && <p role="status" className="mt-2 text-xs text-muted-foreground">Refresh failed. The last recorded counts are still shown.</p>}
    </section>
  )
}
