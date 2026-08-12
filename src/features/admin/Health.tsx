import { useCallback, useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Button } from '@/components/Button'
import { useI18n } from '@/lib/i18n'
import { Panel } from './ui'
import { cn } from '@/lib/cn'

type HealthRow = {
  stage: string
  ok: boolean
  detail: string
}

/**
 * One button that checks whether a blood request actually worked.
 *
 * Every failure this project has had in production was the same shape: one
 * component reported success, a later one did nothing, and nothing was looking
 * at the join between them. A matcher that raised and reported nothing. A
 * matcher that matched while the screen said nobody was found. Recipients
 * marked queued with an empty email_queue.
 *
 * Reading return values could not have caught any of those, because in each
 * case the return value was the thing that was wrong. So this reads the tables
 * afterwards instead: it calls request_pipeline_health, which touches nothing
 * and trusts nothing, and reports what is actually in the database stage by
 * stage.
 *
 * It is deliberately the first thing in the admin panel's Health tab and needs
 * no arguments: the common question is "did the last request work", and that
 * should be one click.
 */
export function Health({ client }: { client: SupabaseClient }) {
  const { t } = useI18n()
  const [rows, setRows] = useState<HealthRow[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [requestId, setRequestId] = useState('')

  const run = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const { data, error: rpcError } = await client.rpc('request_pipeline_health', {
        in_request_id: requestId.trim() || null,
      })
      if (rpcError) throw rpcError
      setRows((data ?? []) as HealthRow[])
    } catch (err) {
      setRows(null)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [client, requestId])

  // Run once on arrival. Somebody opening this tab is already asking the
  // question; making them press a button first is a wasted step.
  useEffect(() => {
    void run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const failures = rows?.filter((r) => !r.ok).length ?? 0

  return (
    <div className="grid gap-4">
      <Panel
        title={t('admin.health.title')}
        action={
          <Button size="sm" onClick={() => void run()} disabled={busy}>
            {busy ? t('common.loading') : t('admin.health.run')}
          </Button>
        }
      >
        <p className="text-sm text-muted">{t('admin.health.body')}</p>

        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="grow text-sm">
            <span className="font-bold">{t('admin.health.requestId')}</span>
            <input
              value={requestId}
              onChange={(e) => setRequestId(e.target.value)}
              placeholder={t('admin.health.requestId.placeholder')}
              className="mt-1 block w-full rounded-md border-2 border-line bg-raise px-3 py-2 font-mono text-xs"
            />
          </label>
        </div>

        {error && (
          <p role="alert" className="mt-3 rounded-md border-2 border-line bg-shindur-fill px-3 py-2 text-sm font-bold text-tile-ink">
            {error}
          </p>
        )}

        {rows && (
          <>
            <p
              className={cn(
                'mt-4 rounded-md border-2 border-line px-3 py-2 text-sm font-extrabold text-tile-ink',
                failures === 0 ? 'bg-jol-fill' : 'bg-shindur-fill',
              )}
            >
              {failures === 0 ? t('admin.health.allGood') : t('admin.health.problems', { count: failures })}
            </p>

            <ul className="mt-3 grid gap-2">
              {rows.map((row, i) => (
                <li
                  key={`${row.stage}-${i}`}
                  className={cn(
                    'rounded-md border-2 px-3 py-2 text-sm',
                    row.ok ? 'border-line-soft bg-sunk' : 'border-line bg-shindur-fill text-tile-ink',
                  )}
                >
                  <div className="flex items-baseline gap-2">
                    <span aria-hidden="true" className="font-extrabold">
                      {row.ok ? '✓' : '✕'}
                    </span>
                    <span className="font-extrabold">{row.stage}</span>
                  </div>
                  <p className={cn('mt-0.5', row.ok ? 'text-muted' : 'font-bold')}>{row.detail}</p>
                </li>
              ))}
            </ul>
          </>
        )}
      </Panel>

      <Panel title={t('admin.health.manual.title')}>
        <p className="text-sm text-muted">{t('admin.health.manual.body')}</p>
        <pre className="mt-2 overflow-x-auto rounded-md border-2 border-line-soft bg-sunk p-3 text-xs">
{`select * from public.request_pipeline_health(null);`}
        </pre>
      </Panel>
    </div>
  )
}
