import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import en from '@/i18n/locales/en.json'
import { TokenUsageBar } from './token-usage-bar'

vi.mock('@/i18n', () => ({
  useI18n: () => ({ t: (key: string, args: Record<string, unknown> = {}) => {
    const text = en.models[key.replace('models.', '') as keyof typeof en.models] ?? key
    return String(text).replace(/\{(\w+)\}/g, (_, name: string) => String(args[name] ?? ''))
  } }),
}))

describe('TokenUsageBar', () => {
  it('leads with remaining allowance for used models and lists the unused ones below', () => {
    const html = renderToStaticMarkup(<TokenUsageBar data={{
      totalBudget: 8_000_000,
      totalUsed: 3_100_900,
      models: [
        { platform: 'google', modelId: 'flash', displayName: 'Google Flash', budget: 0, used: 3_100_000 },
        { platform: 'groq', modelId: 'qwen', displayName: 'Groq Qwen', budget: 6_000_000, used: 900 },
        { platform: 'cerebras', modelId: 'idle', displayName: 'Idle Cerebras', budget: 2_000_000, used: 0 },
        { platform: 'ovh', modelId: 'unused', displayName: 'Unused OVH', budget: 0, used: 0 },
      ],
    }} />)
    expect(html).toContain('Token usage this month')
    expect(html).toContain('~135M estimated per 30 days')
    expect(html).not.toContain('97.7% estimated left')
    expect(html).toContain('The remaining provider balance is unknown')
    // Used with no published budget: usage, never an invented remaining figure.
    expect(html).toContain('3.1M</span>') // headline
    expect(html).toMatch(/Google Flash<\/span>.*3\.1M used/)
    // Used with a budget: what is left of it.
    expect(html).toMatch(/Groq Qwen<\/span>.*6\.0M<\/span> left of 6\.0M/)
    // The rest sits below, under its own heading.
    expect(html.indexOf('Not used yet')).toBeGreaterThan(html.indexOf('Groq Qwen'))
    expect(html).toMatch(/Idle Cerebras<\/span>.*~2\.0M remaining/)
    expect(html).toContain('Browse 1 models with other limits')
    expect(html).toContain('Unused OVH')
  })
})
