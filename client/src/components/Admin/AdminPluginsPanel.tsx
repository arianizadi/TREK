import { useEffect, useState } from 'react'
import { Blocks, AlertTriangle, PackageOpen } from 'lucide-react'
import { adminApi } from '../../api/client'
import { useTranslation } from '../../i18n'

/**
 * Admin → Plugins (#plugins), M0 read-only scaffold. Lists installed plugins
 * from the registry table and shows whether the runtime is enabled
 * (TREK_PLUGINS_ENABLED). Install, activation and the registry browser arrive in
 * later milestones; this panel is intentionally inert.
 */

interface PluginRow {
  id: string
  name: string
  description: string | null
  type: string
  icon: string | null
  version: string | null
  status: string
  reviewed_at: string | null
  source_repo: string | null
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
  const [enabled, setEnabled] = useState(false)
  const [plugins, setPlugins] = useState<PluginRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let alive = true
    adminApi.plugins()
      .then((d: { enabled: boolean; plugins: PluginRow[] }) => {
        if (!alive) return
        setEnabled(!!d.enabled)
        setPlugins(d.plugins || [])
      })
      .catch(() => { if (alive) setError(true) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  return (
    <div className="bg-surface-card border border-edge rounded-xl overflow-hidden">
      <div className="px-6 py-4 border-b border-edge-secondary flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-surface-tertiary">
          <Blocks size={17} className="text-content-muted" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-content">{t('admin.plugins.title')}</h2>
          <p className="text-xs text-content-faint mt-0.5">{t('admin.plugins.subtitle')}</p>
        </div>
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
                  </div>
                  {p.description && <p className="text-xs text-content-faint truncate mt-0.5">{p.description}</p>}
                </div>
                <span className={`shrink-0 rounded-full text-[10px] font-medium px-2 py-0.5 ${STATUS_CLASS[p.status] || STATUS_CLASS.inactive}`}>
                  {t(`admin.plugins.status.${p.status}` as never)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="px-6 py-3 border-t border-edge-secondary bg-surface-secondary">
        <p className="text-xs text-content-faint">{t('admin.plugins.scaffoldNote')}</p>
      </div>
    </div>
  )
}
