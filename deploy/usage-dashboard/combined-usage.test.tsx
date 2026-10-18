import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { CombinedUsage } from './combined-usage'

const query = vi.hoisted(() => ({ data: undefined as unknown, isError: false, isFetching: false }))
vi.mock('@tanstack/react-query', () => ({ useQuery: () => query, useQueryClient: () => ({ invalidateQueries: vi.fn() }) }))
afterEach(() => { vi.restoreAllMocks(); query.data = undefined; query.isError = false })
const snapshot = () => ({ month: '2026-10', checkedAt: '2026-10-18T20:00:00Z', cloudAvailable: true,
  local: { total: 1000 }, cloud: { total: 300, input: 200, output: 100, unreported: 1, attempts: 2,
    since: '2026-10-18T19:00:00Z', checkedAt: '2026-10-18T20:00:00Z' } })

describe('combined usage', () => {
  it('adds local and cloud once and labels incomplete reports', () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-18T20:00:15Z'))
    query.data = snapshot()
    const html = renderToStaticMarkup(<CombinedUsage />)
    expect(html).toContain('1,300')
    expect(html).toContain('Updating every 15 seconds')
    expect(html).toContain('the total is a lower bound')
    expect(html).toContain('Earlier unrecorded cloud usage is excluded')
    expect(html).toContain('>Refresh</button>')
    expect(html).toContain('Cloud checked:')
    expect(html).toContain('Full monthly usage is unavailable')
    expect(html).toContain('partial recorded tokens')
  })
  it('retains counts and marks stale data after the sync worker stops', () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-18T20:05:00Z'))
    query.data = snapshot()
    const html = renderToStaticMarkup(<CombinedUsage />)
    expect(html).toContain('1,300')
    expect(html).toContain('Sync unavailable or stale')
    expect(html).not.toContain('Updating every 15 seconds')
  })
  it('never shows previous-month counts as this month', () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-01T00:00:05Z'))
    query.data = snapshot()
    expect(renderToStaticMarkup(<CombinedUsage />)).not.toContain('1,300')
  })
})
