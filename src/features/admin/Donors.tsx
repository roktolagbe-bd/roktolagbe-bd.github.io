import { useCallback, useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Input, Select } from '@/components/form/Field'
import { useI18n } from '@/lib/i18n'
import { BLOOD_GROUPS } from '@/lib/blood'
import { Badge, MiniButton, Panel, TableWrap, Td, Th, downloadCsv } from './ui'

type DonorRow = {
  id: string
  full_name: string
  display_name: string
  blood_group: string
  phone: string
  email: string | null
  district_id: number | null
  verified: boolean
  blocked: boolean
  deleted_at: string | null
  total_donations: number
  last_donation_date: string | null
  consent_email: boolean
  consent_public_listing: boolean
  created_at: string
}

const PAGE = 50

/**
 * The donor table.
 *
 * This is the one screen in the project that shows phone numbers and email
 * addresses, because verifying and unblocking people is impossible without
 * them. Every action here writes an audit row that nobody, including an admin,
 * can edit or delete.
 */
export function Donors({ client }: { client: SupabaseClient }) {
  const { t, n } = useI18n()
  const [rows, setRows] = useState<DonorRow[]>([])
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState('')
  const [status, setStatus] = useState<'all' | 'unverified' | 'blocked' | 'deleted'>('all')
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    let q = client
      .from('donors')
      .select(
        'id, full_name, display_name, blood_group, phone, email, district_id, verified, blocked, deleted_at, total_donations, last_donation_date, consent_email, consent_public_listing, created_at',
      )
      .order('created_at', { ascending: false })
      .range(page * PAGE, page * PAGE + PAGE - 1)

    if (group) q = q.eq('blood_group', group)
    if (status === 'unverified') q = q.eq('verified', false).is('deleted_at', null)
    if (status === 'blocked') q = q.eq('blocked', true)
    if (status === 'deleted') q = q.not('deleted_at', 'is', null)
    if (status === 'all') q = q.is('deleted_at', null)
    if (query.trim()) {
      // Name or phone. Users search by whichever they have to hand.
      const term = `%${query.trim()}%`
      q = q.or(`full_name.ilike.${term},display_name.ilike.${term},phone.ilike.${term}`)
    }

    const { data } = await q
    setRows((data ?? []) as DonorRow[])
    setLoading(false)
  }, [client, query, group, status, page])

  useEffect(() => {
    void load()
  }, [load])

  const act = async (id: string, patch: Record<string, boolean | string>) => {
    setBusy(id)
    await client.rpc('admin_update_donor', { in_donor_id: id, ...patch })
    setBusy(null)
    await load()
  }

  const exportCsv = () => {
    // Exactly what is on screen, no more. An export is not a licence to dump
    // the whole table.
    downloadCsv(
      `roktolagbe-donors-${new Date().toISOString().slice(0, 10)}.csv`,
      rows.map((r) => ({
        name: r.full_name,
        blood_group: r.blood_group,
        phone: r.phone,
        email: r.email ?? '',
        verified: r.verified,
        blocked: r.blocked,
        donations: r.total_donations,
        last_donation: r.last_donation_date ?? '',
        registered: r.created_at.slice(0, 10),
      })),
    )
  }

  return (
    <Panel
      title={t('admin.nav.donors')}
      action={
        <MiniButton onClick={exportCsv} disabled={rows.length === 0}>
          {t('admin.exportCsv')}
        </MiniButton>
      }
    >
      <div className="mb-3 grid gap-2 sm:grid-cols-3">
        <Input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setPage(0)
          }}
          placeholder={t('admin.searchDonors')}
          aria-label={t('admin.searchDonors')}
        />
        <Select
          value={group}
          onChange={(e) => {
            setGroup(e.target.value)
            setPage(0)
          }}
          aria-label={t('form.bloodGroup')}
        >
          <option value="">{t('search.anyDistrict').replace('district', 'group')}</option>
          {BLOOD_GROUPS.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </Select>
        <Select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as typeof status)
            setPage(0)
          }}
          aria-label={t('admin.filterStatus')}
        >
          <option value="all">{t('admin.filter.active')}</option>
          <option value="unverified">{t('admin.filter.unverified')}</option>
          <option value="blocked">{t('admin.filter.blocked')}</option>
          <option value="deleted">{t('admin.filter.deleted')}</option>
        </Select>
      </div>

      {loading ? (
        <p role="status">{t('common.loading')}</p>
      ) : rows.length === 0 ? (
        <p className="text-muted">{t('admin.noRows')}</p>
      ) : (
        <TableWrap>
          <thead>
            <tr>
              <Th>{t('form.fullName')}</Th>
              <Th>{t('form.bloodGroup')}</Th>
              <Th>{t('form.phone')}</Th>
              <Th>{t('admin.col.state')}</Th>
              <Th>{t('search.donations', { count: 0 }).replace(/\d+|০/, '').trim()}</Th>
              <Th>{t('admin.col.actions')}</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <Td>
                  <span className="font-bold">{r.full_name}</span>
                  <span className="block text-xs text-muted">{r.email ?? '—'}</span>
                </Td>
                <Td className="font-extrabold">{r.blood_group}</Td>
                <Td className="tabular-nums">{r.phone}</Td>
                <Td>
                  <span className="flex flex-wrap gap-1">
                    {r.deleted_at && <Badge tone="bad">{t('admin.state.deleted')}</Badge>}
                    {r.blocked && <Badge tone="bad">{t('admin.state.blocked')}</Badge>}
                    {r.verified && <Badge tone="good">{t('search.verified')}</Badge>}
                    {!r.consent_email && <Badge>{t('admin.state.noEmail')}</Badge>}
                  </span>
                </Td>
                <Td className="tabular-nums">{n(r.total_donations)}</Td>
                <Td>
                  <span className="flex flex-wrap gap-1">
                    <MiniButton
                      onClick={() => void act(r.id, { in_verified: !r.verified })}
                      disabled={busy === r.id}
                    >
                      {r.verified ? t('admin.action.unverify') : t('admin.action.verify')}
                    </MiniButton>
                    <MiniButton
                      onClick={() => void act(r.id, { in_blocked: !r.blocked })}
                      disabled={busy === r.id}
                      tone={r.blocked ? 'quiet' : 'bad'}
                    >
                      {r.blocked ? t('admin.action.unblock') : t('admin.action.block')}
                    </MiniButton>
                    <MiniButton
                      onClick={() => void act(r.id, { in_deleted: !r.deleted_at })}
                      disabled={busy === r.id}
                      tone={r.deleted_at ? 'quiet' : 'bad'}
                    >
                      {r.deleted_at ? t('admin.action.restore') : t('admin.action.delete')}
                    </MiniButton>
                  </span>
                </Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}

      <div className="mt-3 flex items-center gap-2">
        <MiniButton onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>
          {t('common.back')}
        </MiniButton>
        <span className="text-sm text-muted">{n(page + 1)}</span>
        <MiniButton onClick={() => setPage((p) => p + 1)} disabled={rows.length < PAGE}>
          {t('common.next')}
        </MiniButton>
      </div>
    </Panel>
  )
}
