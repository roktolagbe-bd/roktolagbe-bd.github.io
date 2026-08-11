import { useCallback, useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Field, Input } from '@/components/form/Field'
import { useI18n } from '@/lib/i18n'
import { MiniButton, Panel } from './ui'
import { cn } from '@/lib/cn'

type Row = { key: string; value: unknown; description: string | null }

const NUMBER_KEYS = [
  'donor_cooldown_days',
  'max_emails_per_request',
  'daily_email_cap',
  'min_donors_per_step',
  'max_requests_per_ip_per_hour',
  'max_registrations_per_ip_per_hour',
  'min_form_seconds',
]

export function Settings({ client }: { client: SupabaseClient }) {
  const { t } = useI18n()
  const [rows, setRows] = useState<Row[]>([])
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await client.from('admin_settings').select('key, value, description').order('key')
    const list = (data ?? []) as Row[]
    setRows(list)
    setDraft(
      Object.fromEntries(
        list.map((r) => [r.key, typeof r.value === 'string' ? r.value : JSON.stringify(r.value)]),
      ),
    )
    setLoading(false)
  }, [client])

  useEffect(() => {
    void load()
  }, [load])

  const save = async (key: string, value: unknown) => {
    setSaving(key)
    await client.rpc('admin_set_setting', { in_key: key, in_value: value })
    setSaving(null)
    await load()
  }

  const autoEmail = rows.find((r) => r.key === 'auto_email_enabled')
  const isOn = autoEmail?.value === true || autoEmail?.value === 'true'

  if (loading) return <p role="status">{t('common.loading')}</p>

  return (
    <div className="grid gap-4">
      {/* The master switch is the most consequential control in this project,
          so it gets its own panel at the top and states plainly what happens
          in each position. Nothing else on this screen competes with it. */}
      <section
        className={cn(
          'rounded-md border-2 border-line p-5 shadow-ink-2',
          isOn ? 'bg-jol-fill' : 'bg-gada-fill',
        )}
      >
        <h2 className="text-lg font-extrabold text-tile-ink">{t('admin.settings.master')}</h2>
        <p className="mt-1 text-sm font-bold text-tile-ink">
          {isOn ? t('admin.emails.on') : t('admin.emails.off')}
        </p>
        <p className="mt-2 max-w-prose text-sm text-tile-ink">
          {isOn ? t('admin.settings.master.onHint') : t('admin.settings.master.offHint')}
        </p>

        <button
          type="button"
          onClick={() => void save('auto_email_enabled', !isOn)}
          disabled={saving === 'auto_email_enabled'}
          aria-pressed={isOn}
          className="ink-press mt-4 min-h-12 rounded-md border-2 border-line bg-raise px-6 font-extrabold text-ink shadow-ink-2"
        >
          {isOn ? t('admin.settings.turnOff') : t('admin.settings.turnOn')}
        </button>
      </section>

      <Panel title={t('admin.settings.numbers')}>
        <div className="grid gap-4 sm:grid-cols-2">
          {rows
            .filter((r) => NUMBER_KEYS.includes(r.key))
            .map((r) => (
              <Field key={r.key} label={r.key} hint={r.description ?? undefined}>
                {({ id }) => (
                  <span className="flex gap-2">
                    <Input
                      id={id}
                      type="number"
                      inputMode="numeric"
                      value={draft[r.key] ?? ''}
                      onChange={(e) => setDraft((d) => ({ ...d, [r.key]: e.target.value }))}
                    />
                    <MiniButton
                      onClick={() => void save(r.key, Number(draft[r.key]))}
                      disabled={saving === r.key}
                    >
                      {t('admin.save')}
                    </MiniButton>
                  </span>
                )}
              </Field>
            ))}
        </div>
      </Panel>

      <Panel title={t('admin.settings.other')}>
        <div className="grid gap-4">
          {rows
            .filter((r) => !NUMBER_KEYS.includes(r.key) && r.key !== 'auto_email_enabled')
            .map((r) => (
              <Field key={r.key} label={r.key} hint={r.description ?? undefined}>
                {({ id }) => (
                  <span className="flex gap-2">
                    <Input
                      id={id}
                      value={draft[r.key] ?? ''}
                      onChange={(e) => setDraft((d) => ({ ...d, [r.key]: e.target.value }))}
                    />
                    <MiniButton
                      onClick={() => {
                        // Settings are jsonb. Accept raw JSON where it parses,
                        // otherwise store what was typed as a JSON string.
                        let parsed: unknown
                        try {
                          parsed = JSON.parse(draft[r.key] ?? '')
                        } catch {
                          parsed = draft[r.key] ?? ''
                        }
                        void save(r.key, parsed)
                      }}
                      disabled={saving === r.key}
                    >
                      {t('admin.save')}
                    </MiniButton>
                  </span>
                )}
              </Field>
            ))}
        </div>
        <p className="mt-3 text-sm text-muted">{t('admin.settings.templatesNote')}</p>
      </Panel>
    </div>
  )
}
