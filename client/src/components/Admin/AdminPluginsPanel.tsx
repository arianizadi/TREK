import { useEffect, useState } from 'react'
import { Blocks, AlertTriangle, PackageOpen, RefreshCw, Power, Trash2, Download, Bug, X } from 'lucide-react'
import { adminApi } from '../../api/client'
import { useTranslation } from '../../i18n'
import { useToast } from '../shared/Toast'
import ConfirmDialog from '../shared/ConfirmDialog'

/**
 * Admin → Plugins (#plugins). Lists installed plugins with lifecycle actions
 * (activate / deactivate / uninstall), a registry browser to install new ones,
 * and each plugin's error log. Gated by the runtime-enabled flag.
 */

interface PluginRow {
  id: string
  name: string
  description: string | null
  type: string
  version: string | null
  status: string
  reviewed_at: string | null
}
interface RegistryItem {
  id: string
  name: string
  author: string
  description: string
  type: string
  latest: string | null
  reviewedAt: string | null
}

const STATUS_CLASS: Record<string, string> = {
  active: 'bg-emerald-500/15 text-emerald-600',
  inactive: 'bg-surface-tertiary text-content-muted',
  disabled: 'bg-amber-500/15 text-amber-600',
  error: 'bg-rose-500/15 text-rose-600',
  incompatible: 'bg-orange-500/15 text-orange-600',
}

export default function AdminPluginsPanel() {
  const { t } = useTranslation()
  const toast = useToast()
  const [enabled, setEnabled] = useState(false)
  const [plugins, setPlugins] = useState<PluginRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [view, setView] = useState<'installed' | 'browse'>('installed')
  const [registry, setRegistry] = useState<RegistryItem[] | null>(null)
  const [errorsFor, setErrorsFor] = useState<{ id: string; rows: Array<{ ts: string; level: string; message: string }> } | null>(null)
  const [confirmUninstall, setConfirmUninstall] = useState<string | null>(null)

  const refresh = () => {
    adminApi.plugins()
      .then((d: { enabled: boolean; plugins: PluginRow[] }) => { setEnabled(!!d.enabled); setPlugins(d.plugins || []) })
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }
  useEffect(refresh, [])

  const act = async (id: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(id)
    try { await fn(); toast.success(ok); refresh() }
    catch (e) { toast.error((e as { response?: { data?: { error?: string } } })?.response?.data?.error || t('admin.plugins.actionError')) }
    finally { setBusy(null) }
  }

  const openBrowse = () => {
    setView('browse')
    if (!registry) adminApi.pluginBrowse().then(setRegistry).catch(() => setRegistry([]))
  }
  const openErrors = (id: string) =>
    adminApi.pluginErrors(id).then((d: { errors: typeof errorsFor extends null ? never : Array<{ ts: string; level: string; message: string }> }) =>
      setErrorsFor({ id, rows: d.errors as Array<{ ts: string; level: string; message: string }> })).catch(() => setErrorsFor({ id, rows: [] }))

  return (
    <div className="bg-surface-card border border-edge rounded-xl overflow-hidden">
      <div className="px-6 py-4 border-b border-edge-secondary flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-surface-tertiary">
          <Blocks size={17} className="text-content-muted" />
        </div>
        <div className="flex-1">
          <h2 className="text-base font-semibold text-content">{t('admin.plugins.title')}</h2>
          <p className="text-xs text-content-faint mt-0.5">{t('admin.plugins.subtitle')}</p>
        </div>
        {enabled && (
          <div className="flex items-center gap-2">
            <button onClick={() => act('__rescan', adminApi.pluginRescan, t('admin.plugins.rescanned'))}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-edge text-content-muted hover:text-content">
              <RefreshCw size={13} /> {t('admin.plugins.rescan')}
            </button>
            <button onClick={view === 'browse' ? () => setView('installed') : openBrowse}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-accent text-accent-text">
              {view === 'browse' ? t('admin.plugins.installed') : <><Download size={13} /> {t('admin.plugins.browse')}</>}
            </button>
          </div>
        )}
      </div>

      {!enabled && !loading && !error && (
        <div className="mx-6 mt-4 p-4 rounded-lg border border-amber-500/30 bg-amber-500/10 flex items-start gap-3">
          <AlertTriangle size={16} className="text-amber-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-amber-700">{t('admin.plugins.disabledTitle')}</p>
            <p className="text-xs text-amber-700/90 mt-0.5">{t('admin.plugins.disabledBody')}</p>
          </div>
        </div>
      )}

      <div className="p-6">
        {loading ? (
          <div className="py-8 text-center text-sm text-content-faint">{t('common.loading')}</div>
        ) : error ? (
          <div className="py-8 text-center text-sm text-rose-600">{t('admin.plugins.loadError')}</div>
        ) : view === 'browse' ? (
          <RegistryGrid items={registry} busy={busy} t={t}
            onInstall={(id) => act(id, () => adminApi.pluginInstall(id), t('admin.plugins.installed'))} />
        ) : plugins.length === 0 ? (
          <div className="py-10 text-center">
            <PackageOpen size={28} className="mx-auto text-content-faint mb-3" />
            <p className="text-sm text-content-muted">{t('admin.plugins.empty')}</p>
          </div>
        ) : (
          <div className="divide-y divide-edge-secondary">
            {plugins.map(p => (
              <div key={p.id} className="flex items-center gap-4 py-3 first:pt-0 last:pb-0">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-surface-tertiary shrink-0">
                  <Blocks size={16} className="text-content-muted" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-content truncate">{p.name}</span>
                    {p.version && <span className="text-xs text-content-faint">v{p.version}</span>}
                    <span className="text-[10px] text-content-faint">· {p.type}</span>
                  </div>
                  {p.description && <p className="text-xs text-content-faint truncate mt-0.5">{p.description}</p>}
                </div>
                <span className={`shrink-0 rounded-full text-[10px] font-medium px-2 py-0.5 ${STATUS_CLASS[p.status] || STATUS_CLASS.inactive}`}>
                  {t(`admin.plugins.status.${p.status}` as never)}
                </span>
                <div className="flex items-center gap-1 shrink-0">
                  {p.status === 'active' ? (
                    <IconBtn title={t('admin.plugins.deactivate')} disabled={busy === p.id}
                      onClick={() => act(p.id, () => adminApi.pluginDeactivate(p.id), t('admin.plugins.deactivated'))}><Power size={14} /></IconBtn>
                  ) : (
                    <IconBtn title={t('admin.plugins.activate')} disabled={busy === p.id} accent
                      onClick={() => act(p.id, () => adminApi.pluginActivate(p.id), t('admin.plugins.activated'))}><Power size={14} /></IconBtn>
                  )}
                  <IconBtn title={t('admin.plugins.viewErrors')} onClick={() => openErrors(p.id)}><Bug size={14} /></IconBtn>
                  <IconBtn title={t('common.delete')} danger onClick={() => setConfirmUninstall(p.id)}><Trash2 size={14} /></IconBtn>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="px-6 py-3 border-t border-edge-secondary bg-surface-secondary">
        <p className="text-xs text-content-faint">{t('admin.plugins.trustNote')}</p>
      </div>

      {errorsFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setErrorsFor(null)}>
          <div className="bg-surface-card border border-edge rounded-xl w-full max-w-2xl max-h-[70vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-3 border-b border-edge-secondary flex items-center justify-between">
              <span className="text-sm font-semibold text-content">{errorsFor.id} — {t('admin.plugins.errorLog')}</span>
              <button onClick={() => setErrorsFor(null)} className="text-content-faint hover:text-content"><X size={16} /></button>
            </div>
            <div className="p-4 overflow-y-auto text-xs font-mono">
              {errorsFor.rows.length === 0 ? <p className="text-content-faint">{t('admin.plugins.noErrors')}</p> :
                errorsFor.rows.map((r, i) => (
                  <div key={i} className="py-1 border-b border-edge-secondary/50">
                    <span className={r.level === 'error' ? 'text-rose-600' : 'text-amber-600'}>{r.level}</span>
                    <span className="text-content-faint"> {r.ts} </span>
                    <span className="text-content-muted">{r.message}</span>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={!!confirmUninstall}
        onClose={() => setConfirmUninstall(null)}
        onConfirm={async () => {
          const id = confirmUninstall!; setConfirmUninstall(null)
          await act(id, () => adminApi.pluginUninstall(id, true), t('admin.plugins.uninstalled'))
        }}
        title={t('admin.plugins.uninstallTitle')}
        message={t('admin.plugins.uninstallBody')}
      />
    </div>
  )
}

function IconBtn({ children, title, onClick, disabled, accent, danger }: {
  children: React.ReactNode; title: string; onClick: () => void; disabled?: boolean; accent?: boolean; danger?: boolean
}) {
  return (
    <button title={title} onClick={onClick} disabled={disabled}
      className={`w-8 h-8 grid place-items-center rounded-lg border border-edge transition-colors disabled:opacity-40 ${
        danger ? 'text-rose-500 hover:bg-rose-500/10' : accent ? 'text-emerald-600 hover:bg-emerald-500/10' : 'text-content-muted hover:text-content'}`}>
      {children}
    </button>
  )
}

function RegistryGrid({ items, onInstall, busy, t }: {
  items: RegistryItem[] | null
  onInstall: (id: string) => void
  busy: string | null
  t: (k: string) => string
}) {
  if (!items) return <div className="py-8 text-center text-sm text-content-faint">{t('common.loading')}</div>
  if (items.length === 0) return <div className="py-8 text-center text-sm text-content-faint">{t('admin.plugins.registryEmpty')}</div>
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {items.map(item => (
        <div key={item.id} className="border border-edge rounded-xl p-4 bg-surface-card">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-content">{item.name}</span>
            <span className="text-[10px] text-content-faint">{item.latest ? `v${item.latest}` : ''}</span>
            {item.reviewedAt && <span className="text-[10px] text-emerald-600">✓ reviewed</span>}
          </div>
          <p className="text-xs text-content-faint mt-1 line-clamp-2">{item.description}</p>
          <div className="flex items-center justify-between mt-3">
            <span className="text-[11px] text-content-faint">{item.author} · {item.type}</span>
            <button onClick={() => onInstall(item.id)} disabled={busy === item.id}
              className="text-xs px-3 py-1.5 rounded-lg bg-accent text-accent-text disabled:opacity-50">{t('admin.plugins.install')}</button>
          </div>
        </div>
      ))}
    </div>
  )
}
