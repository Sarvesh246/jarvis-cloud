import { useState } from 'react'
import { useI18n } from '@/i18n'
import { buildBudgetLegend } from '@/lib/budget-legend'
import { formatTokens, platformColors, type TokenUsageData } from '@/lib/routing'

export function TokenUsageBar({ data }: { data: TokenUsageData }) {
  const { t } = useI18n()
  const [showAllUsage, setShowAllUsage] = useState(false)
  const [showAllUnused, setShowAllUnused] = useState(false)
  const { totalBudget, totalUsed, models } = data
  const { usageRows, unusedRows, unusedUnpublished } = buildBudgetLegend(models, totalBudget)
  const shownUsage = showAllUsage ? usageRows : usageRows.slice(0, 6)
  const shownUnused = showAllUnused ? unusedRows : unusedRows.slice(0, 9)
  const exact = (n: number) => `${n.toLocaleString()} tokens`
  const rowKey = (m: TokenUsageData['models'][number]) => `${m.platform}:${m.modelId ?? m.displayName}`
  const dot = (platform: string) => <span className="size-2 rounded-sm flex-shrink-0" style={{ backgroundColor: platformColors[platform] ?? '#94a3b8' }} />

  return (
    <section className="rounded-3xl border bg-card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <h2 className="text-sm font-medium">Local · {t('models.monthlyUsageHeading')}</h2>
        <span className="text-xs tabular-nums" title={`${exact(totalUsed)}. ${t('models.monthlyCapacityEstimateHint')}`}>
          <span className="font-medium">{formatTokens(totalUsed)}</span> {t('models.used')}
          <span className="text-muted-foreground"> / {t('models.monthlyAllowanceEstimate')}</span>
          <span className="ml-2 font-medium">· planning estimate only</span>
        </span>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">Local requests only. Cloud consumption is excluded from this breakdown. The remaining provider balance is unknown.</p>
      <div className="flex h-2.5 rounded-full overflow-hidden bg-muted" aria-label={t('models.monthlyUsageHeading')}>
        {usageRows.map(m => (
          <div key={rowKey(m)} title={`${m.displayName} (${m.platform}): ${exact(m.used ?? 0)}`}
            style={{ width: `${totalUsed > 0 ? ((m.used ?? 0) / totalUsed) * 100 : 0}%`, backgroundColor: platformColors[m.platform] ?? '#94a3b8' }} />
        ))}
      </div>
      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-5 gap-y-2 text-xs tabular-nums">
        {/* Used models lead with what is left of their allowance; a model with no
            published token budget has nothing to subtract from, so it shows usage. */}
        {shownUsage.map(m => (
          <div key={rowKey(m)} className="flex items-center gap-2 min-w-0"
            title={`${m.displayName} (${m.platform}): ${exact(m.usedTokens)} ${t('models.used')}${m.remainingTokens !== null ? `, ~${exact(m.remainingTokens)} ${t('models.remaining')}` : ''}`}>
            {dot(m.platform)}
            <span className="truncate">{m.displayName}</span>
            <span className="ml-auto whitespace-nowrap font-mono text-muted-foreground">
              {m.remainingTokens !== null
                ? <><span className="text-foreground">{formatTokens(m.remainingTokens)}</span> {t('models.leftOf', { budget: formatTokens(m.budget) })}</>
                : <>{formatTokens(m.usedTokens)} {t('models.used')}</>}
            </span>
          </div>
        ))}
      </div>
      {usageRows.length > 6 && (
        <button onClick={() => setShowAllUsage(v => !v)} className="mt-3 text-xs text-muted-foreground hover:text-foreground">
          {showAllUsage ? t('models.showLess') : t('models.showAllModels', { count: usageRows.length })}
        </button>
      )}
      {unusedRows.length > 0 && (
        <div className="mt-4 border-t pt-3 text-xs">
          <h3 className="font-medium text-muted-foreground">{t('models.notUsedHeading')}</h3>
          <p className="mt-1 text-muted-foreground">{t('models.remainingEstimateHint')}</p>
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-5 gap-y-2 tabular-nums">
            {shownUnused.map(m => (
              <div key={rowKey(m)} className="flex items-center gap-2 min-w-0">
                {dot(m.platform)}
                <span className="truncate">{m.displayName}</span>
                <span className="ml-auto whitespace-nowrap font-mono text-muted-foreground">~{formatTokens(m.remainingTokens)} {t('models.remaining')}</span>
              </div>
            ))}
          </div>
          {unusedRows.length > 9 && (
            <button onClick={() => setShowAllUnused(v => !v)} className="mt-3 text-xs text-muted-foreground hover:text-foreground">
              {showAllUnused ? t('models.showLess') : t('models.showAllModels', { count: unusedRows.length })}
            </button>
          )}
        </div>
      )}
      {unusedUnpublished.length > 0 && (
        <details className="mt-4 border-t pt-3 text-xs">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">{t('models.unquantifiedModels', { count: unusedUnpublished.length })}</summary>
          <p className="mt-2 text-muted-foreground">{t('models.unquantifiedHint')}</p>
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-5 gap-y-2 tabular-nums">
            {unusedUnpublished.map(m => (
              <div key={rowKey(m)} className="flex items-center gap-2 min-w-0">
                {dot(m.platform)}
                <span className="truncate">{m.displayName}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  )
}
