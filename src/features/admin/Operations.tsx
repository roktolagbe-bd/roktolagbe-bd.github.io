import { useCallback, useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Input, Select } from '@/components/form/Field'
import { useI18n } from '@/lib/i18n'
import { usePlaces } from '@/lib/places'
import { Badge, MiniButton, Panel, TableWrap, Td, Th } from './ui'

const when = (value: string | null, lang: string) =>
  value
    ? new Date(value).toLocaleString(lang === 'bn' ? 'bn-BD' : 'en-GB', {
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
      })
    : '—'

// ---------------------------------------------------------------------------
// Email queue
// ---------------------------------------------------------------------------

type QueueRow = {
  id: string
  to_email: string
  subject: string
  status: string
  attempts: number
  last_error: string | null
  scheduled_for: string
  sent_at: string | null
  kind: string
}

const TONE: Record<string, 'good' | 'warn' | 'bad' | 'quiet'> = {
  sent: 'good',
  queued: 'warn',
  failed: 'bad',
  skipped: 'quiet',
}

export function Queue({ client }: { client: SupabaseClient }) {
  const { t, n, lang } = useI18n()
  const [rows, setRows] = useState<QueueRow[]>([])
  const [status, setStatus] = useState('failed')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    let q = client
      .from('email_queue')
      .select('id, to_email, subject, status, attempts, last_error, scheduled_for, sent_at, kind')
      .order('created_at', { ascending: false })
      .limit(100)
    if (status !== 'all') q = q.eq('status', status)
    const { data } = await q
    setRows((data ?? []) as QueueRow[])
  }, [client, status])

  useEffect(() => {
    void load()
  }, [load])

  const retry = async (id: string) => {
    setBusy(true)
    await client.rpc('admin_retry_email', { in_email_id: id })
    setBusy(false)
    await load()
  }

  return (
    <Panel
      title={t('admin.nav.queue')}
      action={
        <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t('admin.filterStatus')} className="max-w-40">
          <option value="failed">{t('admin.queue.failed')}</option>
          <option value="queued">{t('admin.queue.waiting')}</option>
          <option value="sent">{t('admin.queue.sent')}</option>
          <option value="all">{t('admin.filter.all')}</option>
        </Select>
      }
    >
      {rows.length === 0 ? (
        <p className="text-muted">{t('admin.noRows')}</p>
      ) : (
        <TableWrap>
          <thead>
            <tr>
              <Th>{t('form.email')}</Th>
              <Th>{t('admin.col.subject')}</Th>
              <Th>{t('admin.col.state')}</Th>
              <Th>{t('admin.col.actions')}</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <Td>
                  {r.to_email}
                  <span className="block text-xs text-muted">{r.kind}</span>
                </Td>
                <Td className="max-w-80">
                  <span className="line-clamp-2">{r.subject}</span>
                  {/* The failure reason is the whole point of this screen. */}
                  {r.last_error && (
                    <span className="mt-1 block text-xs break-words text-shindur">{r.last_error}</span>
                  )}
                </Td>
                <Td>
                  <Badge tone={TONE[r.status] ?? 'quiet'}>{r.status}</Badge>
                  <span className="mt-1 block text-xs text-muted">
                    {t('admin.queue.attempts', { count: r.attempts })}
                  </span>
                  <span className="block text-xs text-muted">
                    {r.sent_at ? when(r.sent_at, lang) : when(r.scheduled_for, lang)}
                  </span>
                </Td>
                <Td>
                  {r.status !== 'sent' && (
                    <MiniButton onClick={() => void retry(r.id)} disabled={busy}>
                      {t('admin.action.retry')}
                    </MiniButton>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
      <p className="mt-3 text-sm text-muted">{n(rows.length)}</p>
    </Panel>
  )
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

type AuditRow = {
  id: number
  actor_id: string | null
  action: string
  target_table: string | null
  target_id: string | null
  payload: unknown
  created_at: string
}

export function Audit({ client }: { client: SupabaseClient }) {
  const { t, lang } = useI18n()
  const [rows, setRows] = useState<AuditRow[]>([])

  useEffect(() => {
    void (async () => {
      const { data } = await client
        .from('audit_log')
        .select('id, actor_id, action, target_table, target_id, payload, created_at')
        .order('created_at', { ascending: false })
        .limit(200)
      setRows((data ?? []) as AuditRow[])
    })()
  }, [client])

  return (
    <Panel title={t('admin.nav.audit')}>
      <p className="mb-3 text-sm text-muted">{t('admin.audit.note')}</p>
      {rows.length === 0 ? (
        <p className="text-muted">{t('admin.noRows')}</p>
      ) : (
        <TableWrap>
          <thead>
            <tr>
              <Th>{t('admin.col.when')}</Th>
              <Th>{t('admin.col.action')}</Th>
              <Th>{t('admin.col.target')}</Th>
              <Th>{t('admin.col.detail')}</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <Td className="whitespace-nowrap text-muted">{when(r.created_at, lang)}</Td>
                <Td className="font-bold">{r.action}</Td>
                <Td className="text-muted">
                  {r.target_table}
                  <span className="block text-xs">{r.target_id?.slice(0, 8)}</span>
                </Td>
                <Td>
                  <code className="text-xs break-all">{JSON.stringify(r.payload)}</code>
                </Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
    </Panel>
  )
}

// ---------------------------------------------------------------------------
// Master data: hospitals
//
// Districts and upazilas are seeded from open data and corrected by pull
// request, so they are shown read-only here with a pointer to the file. A free
// text editor over 494 rows of geography invites more damage than it fixes.
// ---------------------------------------------------------------------------

type HospitalRow = {
  id: string
  name_en: string
  name_bn: string | null
  district_id: number | null
  lat: number | null
  lng: number | null
  is_active: boolean
}

export function MasterData({ client }: { client: SupabaseClient }) {
  const { t, n, lang } = useI18n()
  const { districts } = usePlaces()
  const [rows, setRows] = useState<HospitalRow[]>([])
  const [districtId, setDistrictId] = useState<number | null>(null)
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    let q = client
      .from('hospitals')
      .select('id, name_en, name_bn, district_id, lat, lng, is_active')
      .order('name_en')
      .limit(200)
    if (districtId) q = q.eq('district_id', districtId)
    const { data } = await q
    setRows((data ?? []) as HospitalRow[])
  }, [client, districtId])

  useEffect(() => {
    void load()
  }, [load])

  const add = async () => {
    if (!newName.trim() || !districtId) return
    setBusy(true)
    await client.from('hospitals').insert({ name_en: newName.trim(), district_id: districtId })
    setNewName('')
    setBusy(false)
    await load()
  }

  const toggle = async (row: HospitalRow) => {
    setBusy(true)
    await client.from('hospitals').update({ is_active: !row.is_active }).eq('id', row.id)
    setBusy(false)
    await load()
  }

  return (
    <div className="grid gap-4">
      <Panel title={t('admin.nav.master')}>
        <div className="mb-3 grid gap-2 sm:grid-cols-[1fr_2fr_auto]">
          <Select
            value={districtId ?? ''}
            onChange={(e) => setDistrictId(e.target.value ? Number(e.target.value) : null)}
            aria-label={t('form.district')}
          >
            <option value="">{t('search.anyDistrict')}</option>
            {districts.map((d) => (
              <option key={d.id} value={d.id}>
                {lang === 'bn' ? d.name_bn : d.name_en}
              </option>
            ))}
          </Select>
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t('request.hospitalName')}
            aria-label={t('request.hospitalName')}
          />
          <MiniButton onClick={() => void add()} disabled={busy || !newName.trim() || !districtId}>
            {t('admin.action.add')}
          </MiniButton>
        </div>

        {rows.length === 0 ? (
          <p className="text-muted">{t('admin.noRows')}</p>
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>{t('request.hospital')}</Th>
                <Th>{t('admin.col.position')}</Th>
                <Th>{t('admin.col.state')}</Th>
                <Th>{t('admin.col.actions')}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <Td className="font-bold">{r.name_en}</Td>
                  <Td className="text-muted tabular-nums">
                    {r.lat != null && r.lng != null
                      ? `${n(Math.round(r.lat * 1000) / 1000)}, ${n(Math.round(r.lng * 1000) / 1000)}`
                      : t('admin.master.noPin')}
                  </Td>
                  <Td>
                    <Badge tone={r.is_active ? 'good' : 'quiet'}>
                      {r.is_active ? t('admin.state.active') : t('admin.state.hidden')}
                    </Badge>
                  </Td>
                  <Td>
                    <MiniButton onClick={() => void toggle(r)} disabled={busy}>
                      {r.is_active ? t('admin.action.hideRow') : t('admin.action.show')}
                    </MiniButton>
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Panel>

      <Panel title={t('admin.master.geography')}>
        <p className="text-sm text-muted">{t('admin.master.geographyNote')}</p>
      </Panel>
    </div>
  )
}
