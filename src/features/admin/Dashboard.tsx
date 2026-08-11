import { useEffect, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { SupabaseClient } from '@supabase/supabase-js'
import { useI18n } from '@/lib/i18n'
import { Panel, Stat } from './ui'

export type DashboardData = {
  donors_total: number
  donors_blocked: number
  donors_verified: number
  requests_open: number
  requests_fulfilled: number
  emails_queued: number
  emails_failed: number
  emails_sent_today: number
  quota_remaining: number
  auto_email_enabled: boolean
  requests_over_time: Array<{ day: string; count: number }>
  by_group: Array<{ blood_group: string; available: number; total: number }>
  by_district: Array<{ district: string; donors: number }>
}

/* One hue for the data, ink for the text, a recessive grid.
 *
 * Both charts show a single series measuring magnitude, so colour carries no
 * identity: the blood group is already on the axis and the date is already on
 * the axis. Using the eight tile colours here would be decoration, and worse,
 * the validator rejects them as a categorical palette — AB+ and AB- sit at
 * ΔE 10.2, below the normal-vision floor. One sequential hue is both simpler
 * and correct.
 */
const SERIES = 'var(--c-nil)'
const AXIS = 'var(--c-muted)'
const GRID = 'var(--c-line-soft)'

export function Dashboard({ client }: { client: SupabaseClient }) {
  const { t, n, lang } = useI18n()
  const [data, setData] = useState<DashboardData | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const { data: rows, error: err } = await client.rpc('admin_dashboard')
        if (err) throw err
        if (!cancelled) setData(rows as DashboardData)
      } catch {
        if (!cancelled) setError(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [client])

  if (error) return <p role="alert">{t('admin.loadFailed')}</p>
  if (!data) return <p role="status">{t('common.loading')}</p>

  const dayLabel = (day: string) =>
    new Date(day).toLocaleDateString(lang === 'bn' ? 'bn-BD' : 'en-GB', {
      day: 'numeric',
      month: 'short',
    })

  return (
    <div className="grid gap-4">
      {/* The state of the email switch is the first thing an admin needs to
          know, because everything else about the pipeline follows from it. */}
      <div
        className={
          data.auto_email_enabled
            ? 'rounded-md border-2 border-line bg-jol-fill px-4 py-3 font-bold text-tile-ink'
            : 'rounded-md border-2 border-line bg-gada-fill px-4 py-3 font-bold text-tile-ink'
        }
      >
        {data.auto_email_enabled ? t('admin.emails.on') : t('admin.emails.off')}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label={t('admin.stat.donors')} value={n(data.donors_total)} />
        <Stat label={t('admin.stat.verified')} value={n(data.donors_verified)} tone="good" />
        <Stat label={t('admin.stat.openRequests')} value={n(data.requests_open)} />
        <Stat label={t('admin.stat.fulfilled')} value={n(data.requests_fulfilled)} tone="good" />
        <Stat
          label={t('admin.stat.quota')}
          value={n(data.quota_remaining)}
          tone={data.quota_remaining < 50 ? 'warn' : undefined}
        />
        <Stat label={t('admin.stat.queued')} value={n(data.emails_queued)} />
        <Stat
          label={t('admin.stat.failed')}
          value={n(data.emails_failed)}
          tone={data.emails_failed > 0 ? 'bad' : undefined}
        />
        <Stat label={t('admin.stat.sentToday')} value={n(data.emails_sent_today)} />
        <Stat
          label={t('admin.stat.blocked')}
          value={n(data.donors_blocked)}
          tone={data.donors_blocked > 0 ? 'warn' : undefined}
        />
      </div>

      <Panel title={t('admin.chart.requests')}>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data.requests_over_time} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis
                dataKey="day"
                tickFormatter={dayLabel}
                stroke={AXIS}
                tick={{ fontSize: 11 }}
                interval="preserveStartEnd"
                minTickGap={24}
              />
              <YAxis stroke={AXIS} tick={{ fontSize: 11 }} allowDecimals={false} width={40} />
              <Tooltip
                labelFormatter={(v) => dayLabel(String(v))}
                formatter={(value) => [n(Number(value) || 0), t('admin.chart.requests')]}
                contentStyle={{
                  background: 'var(--c-raise)',
                  border: '2px solid var(--c-line)',
                  borderRadius: 4,
                  color: 'var(--c-ink)',
                }}
              />
              <Line
                type="monotone"
                dataKey="count"
                stroke={SERIES}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={t('admin.chart.byGroup')}>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.by_group} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="blood_group" stroke={AXIS} tick={{ fontSize: 11 }} />
                <YAxis stroke={AXIS} tick={{ fontSize: 11 }} allowDecimals={false} width={40} />
                <Tooltip
                  formatter={(value) => [n(Number(value) || 0), t('search.available')]}
                  contentStyle={{
                    background: 'var(--c-raise)',
                    border: '2px solid var(--c-line)',
                    borderRadius: 4,
                    color: 'var(--c-ink)',
                  }}
                />
                <Bar dataKey="available" fill={SERIES} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        {/* A list, not a map. "Which districts have people" is a ranking
            question, and a ranked list answers it faster than a choropleth. */}
        <Panel title={t('admin.chart.byDistrict')}>
          <ol className="grid gap-1.5">
            {data.by_district.map((row) => {
              const peak = Math.max(...data.by_district.map((d) => d.donors), 1)
              return (
                <li key={row.district} className="grid grid-cols-[8rem_1fr_3rem] items-center gap-2 text-sm">
                  <span className="truncate">{row.district}</span>
                  <span className="h-3 rounded-sm bg-sunk">
                    <span
                      className="block h-full rounded-sm"
                      style={{ width: `${(row.donors / peak) * 100}%`, background: SERIES }}
                    />
                  </span>
                  <span className="text-right font-bold tabular-nums">{n(row.donors)}</span>
                </li>
              )
            })}
          </ol>
        </Panel>
      </div>
    </div>
  )
}
