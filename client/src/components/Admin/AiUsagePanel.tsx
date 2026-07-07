import React, { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Bot, ChevronDown, ChevronRight, RefreshCw } from 'lucide-react'
import { adminApi, type AdminAiUsageEvent, type AdminAiUsageResponse } from '../../api/client'
import { useTranslation } from '../../i18n'

const LIMIT = 100

export default function AiUsagePanel(): React.ReactElement {
  const { locale } = useTranslation()
  const [days, setDays] = useState(30)
  const [data, setData] = useState<AdminAiUsageResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<number | null>(null)

  const load = useCallback(async (offset = 0) => {
    setLoading(true)
    try {
      const next = await adminApi.aiUsage({ days, limit: LIMIT, offset })
      setData(prev => offset > 0 && prev
        ? { ...next, events: [...prev.events, ...next.events] }
        : next)
    } finally {
      setLoading(false)
    }
  }, [days])

  useEffect(() => {
    void load(0)
  }, [load])

  const totals = data?.totals

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="m-0 flex items-center gap-2 text-lg font-semibold text-content">
            <Bot size={20} />
            AI Usage & Logs
          </h2>
          <p className="m-0 mt-1 text-sm text-content-muted">
            Admin-only OpenRouter usage, cost, prompts, responses, and apply history.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={days}
            onChange={(event) => setDays(Number(event.target.value))}
            className="rounded-lg border border-edge bg-surface-card px-3 py-2 text-sm text-content"
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
            <option value={365}>Last year</option>
            <option value={0}>All time</option>
          </select>
          <button
            type="button"
            disabled={loading}
            onClick={() => load(0)}
            className="inline-flex items-center gap-2 rounded-lg border border-edge bg-surface-card px-3 py-2 text-sm font-medium text-content transition-opacity disabled:opacity-50"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <div className="flex gap-2">
          <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
          <p className="m-0">
            Full AI prompts, trip context sent to the model, responses, draft plans, and apply payloads are stored here. API keys, bearer tokens, secrets, passwords, and server plan signatures are redacted.
          </p>
        </div>
      </div>

      {totals && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Metric label="Requests" value={formatNumber(totals.requests, locale)} />
          <Metric label="Errors" value={formatNumber(totals.errors, locale)} tone={totals.errors > 0 ? 'warn' : 'normal'} />
          <Metric label="Total tokens" value={formatNumber(totals.total_tokens, locale)} />
          <Metric label="Reasoning tokens" value={formatNumber(totals.reasoning_tokens, locale)} />
          <Metric label="Cost" value={formatMoney(totals.cost)} />
        </div>
      )}

      {data && data.byUser.length > 0 && (
        <section className="space-y-2">
          <h3 className="m-0 text-sm font-semibold text-content-secondary">Usage by user</h3>
          <div className="overflow-x-auto rounded-lg border border-edge bg-surface-card">
            <table className="min-w-[760px] w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-edge-secondary text-left">
                  <Th>User</Th>
                  <Th>Requests</Th>
                  <Th>Errors</Th>
                  <Th>Total tokens</Th>
                  <Th>Reasoning</Th>
                  <Th>Cost</Th>
                  <Th>Last used</Th>
                </tr>
              </thead>
              <tbody>
                {data.byUser.map(row => (
                  <tr key={row.user_id ?? 'unknown'} className="border-b border-edge-secondary align-top">
                    <Td>{userLabel(row)}</Td>
                    <Td mono>{formatNumber(row.requests, locale)}</Td>
                    <Td mono>{formatNumber(row.errors, locale)}</Td>
                    <Td mono>{formatNumber(row.total_tokens, locale)}</Td>
                    <Td mono>{formatNumber(row.reasoning_tokens, locale)}</Td>
                    <Td mono>{formatMoney(row.cost)}</Td>
                    <Td>{formatTime(row.last_used_at, locale)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {data && data.byModel.length > 0 && (
        <section className="space-y-2">
          <h3 className="m-0 text-sm font-semibold text-content-secondary">Usage by model</h3>
          <div className="overflow-x-auto rounded-lg border border-edge bg-surface-card">
            <table className="min-w-[640px] w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-edge-secondary text-left">
                  <Th>Provider</Th>
                  <Th>Model</Th>
                  <Th>Requests</Th>
                  <Th>Errors</Th>
                  <Th>Total tokens</Th>
                  <Th>Cost</Th>
                </tr>
              </thead>
              <tbody>
                {data.byModel.map(row => (
                  <tr key={`${row.provider}:${row.model ?? 'unknown'}`} className="border-b border-edge-secondary align-top">
                    <Td>{row.provider}</Td>
                    <Td mono>{row.model || 'unknown'}</Td>
                    <Td mono>{formatNumber(row.requests, locale)}</Td>
                    <Td mono>{formatNumber(row.errors, locale)}</Td>
                    <Td mono>{formatNumber(row.total_tokens, locale)}</Td>
                    <Td mono>{formatMoney(row.cost)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="m-0 text-sm font-semibold text-content-secondary">Full event history</h3>
          {data && <span className="text-xs text-content-faint">Showing {data.events.length} of {data.total}</span>}
        </div>
        {loading && !data ? (
          <div className="py-12 text-center text-sm text-content-muted">Loading...</div>
        ) : !data || data.events.length === 0 ? (
          <div className="py-12 text-center text-sm text-content-muted">No AI usage recorded.</div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-edge bg-surface-card">
            <table className="min-w-[1040px] w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-edge-secondary text-left">
                  <Th>Time</Th>
                  <Th>User</Th>
                  <Th>Trip</Th>
                  <Th>Kind</Th>
                  <Th>Status</Th>
                  <Th>Tokens</Th>
                  <Th>Cost</Th>
                  <Th>IP</Th>
                  <Th>Details</Th>
                </tr>
              </thead>
              <tbody>
                {data.events.map(event => (
                  <React.Fragment key={event.id}>
                    <tr className="border-b border-edge-secondary align-top">
                      <Td>{formatTime(event.created_at, locale)}</Td>
                      <Td>{eventUserLabel(event)}</Td>
                      <Td>{event.trip_title || (event.trip_id ? `#${event.trip_id}` : '-')}</Td>
                      <Td mono>{event.request_kind}</Td>
                      <Td>
                        <span className={`rounded-md px-2 py-1 text-xs font-semibold ${event.status === 'ok' ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>
                          {event.status}
                        </span>
                      </Td>
                      <Td mono>{formatNumber(event.total_tokens ?? 0, locale)}</Td>
                      <Td mono>{formatMoney(event.cost ?? 0)}</Td>
                      <Td mono>{event.ip || '-'}</Td>
                      <Td>
                        <button
                          type="button"
                          onClick={() => setExpanded(expanded === event.id ? null : event.id)}
                          className="inline-flex items-center gap-1 text-sm font-medium text-content-secondary underline-offset-2 hover:underline"
                        >
                          {expanded === event.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          Details
                        </button>
                      </Td>
                    </tr>
                    {expanded === event.id && (
                      <tr className="border-b border-edge-secondary">
                        <td colSpan={9} className="bg-surface-secondary p-3">
                          <EventDetails event={event} />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {data && data.events.length < data.total && (
        <button
          type="button"
          disabled={loading}
          onClick={() => load(data.events.length)}
          className="text-sm font-medium text-content-secondary underline-offset-2 hover:underline disabled:opacity-50"
        >
          Load more
        </button>
      )}
    </div>
  )
}

function Metric({ label, value, tone = 'normal' }: { label: string; value: string; tone?: 'normal' | 'warn' }) {
  return (
    <div className="rounded-lg border border-edge bg-surface-card p-4">
      <p className="m-0 text-xs font-medium uppercase text-content-faint">{label}</p>
      <p className={`m-0 mt-1 text-xl font-semibold ${tone === 'warn' ? 'text-amber-700' : 'text-content'}`}>{value}</p>
    </div>
  )
}

function EventDetails({ event }: { event: AdminAiUsageEvent }) {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <PayloadBlock title="Request" payload={event.request_payload} />
      <PayloadBlock title="Response" payload={event.response_payload} />
      {event.error && (
        <div className="lg:col-span-2">
          <PayloadBlock title="Error" payload={event.error} />
        </div>
      )}
    </div>
  )
}

function PayloadBlock({ title, payload }: { title: string; payload: unknown }) {
  return (
    <div className="space-y-1">
      <p className="m-0 text-xs font-semibold uppercase text-content-muted">{title}</p>
      <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap rounded-lg border border-edge bg-surface-card p-3 text-xs text-content">
        {stringifyPayload(payload)}
      </pre>
    </div>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="p-3 font-semibold whitespace-nowrap text-content-secondary">{children}</th>
}

function Td({ children, mono = false }: { children: React.ReactNode; mono?: boolean }) {
  return <td className={`p-3 text-content ${mono ? 'font-mono text-xs' : ''}`}>{children}</td>
}

function userLabel(row: AdminAiUsageResponse['byUser'][number]): string {
  return row.username || row.user_email || (row.user_id != null ? `#${row.user_id}` : 'unknown')
}

function eventUserLabel(event: AdminAiUsageEvent): string {
  return event.username || event.user_email || (event.user_id != null ? `#${event.user_id}` : 'unknown')
}

function formatNumber(value: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(value || 0)
}

function formatMoney(value: number): string {
  return `$${(value || 0).toFixed(4)}`
}

function formatTime(value: string | null, locale: string): string {
  if (!value) return '-'
  try {
    return new Date(value).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'medium' })
  } catch {
    return value
  }
}

function stringifyPayload(payload: unknown): string {
  if (payload == null) return '-'
  if (typeof payload === 'string') return payload
  try {
    return JSON.stringify(payload, null, 2)
  } catch {
    return String(payload)
  }
}
