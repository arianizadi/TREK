import React, { useEffect, useCallback, useId, useRef } from 'react'
import ReactDOM from 'react-dom'
import { AlertTriangle } from 'lucide-react'
import { useTranslation } from '../../i18n'

interface ConfirmDialogProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  title?: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

export default function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel,
  cancelLabel,
  danger = true,
}: ConfirmDialogProps) {
  const { t } = useTranslation()
  const titleId = useId()
  const messageId = useId()
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  const handleEsc = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
  }, [onClose])

  useEffect(() => {
    if (isOpen) {
      previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      document.addEventListener('keydown', handleEsc)
      window.setTimeout(() => {
        const dialog = dialogRef.current
        if (!dialog) return
        const focusable = dialog.querySelector<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        )
        ;(focusable ?? dialog).focus()
      }, 0)
    }
    return () => {
      document.removeEventListener('keydown', handleEsc)
      previousFocusRef.current?.focus?.()
      previousFocusRef.current = null
    }
  }, [isOpen, handleEsc])

  if (!isOpen) return null

  return ReactDOM.createPortal(
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center px-4 trek-backdrop-enter bg-[rgba(15,23,42,0.5)]"
      style={{ paddingBottom: 'var(--bottom-nav-h)' }}
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={message ? messageId : undefined}
        tabIndex={-1}
        className="trek-modal-enter rounded-2xl shadow-2xl w-full max-w-sm p-6 bg-surface-card"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start gap-4">
          {danger && (
            <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-red-600" />
            </div>
          )}
          <div className="flex-1">
            <h3 id={titleId} className="text-base font-semibold text-content">
              {title || t('common.confirm')}
            </h3>
            <p id={message ? messageId : undefined} className="mt-1 text-sm text-content-secondary">
              {message}
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium rounded-lg transition-colors text-content-secondary border border-edge-secondary"
          >
            {cancelLabel || t('common.cancel')}
          </button>
          <button
            onClick={() => { onConfirm(); onClose() }}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors text-white ${
              danger ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {confirmLabel || t('common.delete')}
          </button>
        </div>
      </div>

    </div>,
    document.body
  )
}
