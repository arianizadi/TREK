import React, { useEffect, useCallback, useId, useRef } from 'react'
import ReactDOM from 'react-dom'
import { X } from 'lucide-react'

const sizeClasses: Record<string, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-2xl',
  '2xl': 'max-w-4xl',
  '3xl': 'max-w-5xl',
}

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title?: React.ReactNode
  children?: React.ReactNode
  size?: string
  footer?: React.ReactNode
  hideCloseButton?: boolean
}

export default function Modal({
  isOpen,
  onClose,
  title,
  children,
  size = 'md',
  footer,
  hideCloseButton = false,
}: ModalProps) {
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const handleEsc = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
  }, [onClose])

  useEffect(() => {
    if (isOpen) {
      previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      document.addEventListener('keydown', handleEsc)
      document.body.style.overflow = 'hidden'
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
      document.body.style.overflow = ''
      previousFocusRef.current?.focus?.()
      previousFocusRef.current = null
    }
  }, [isOpen, handleEsc])

  const mouseDownTarget = useRef<EventTarget | null>(null)

  if (!isOpen) return null

  return ReactDOM.createPortal(
    <div
      className="fixed inset-0 z-[10000] flex items-start sm:items-center justify-center px-4 trek-modal-backdrop trek-backdrop-enter bg-[rgba(15,23,42,0.5)]"
      style={{ paddingTop: 70, paddingBottom: 'calc(20px + var(--bottom-nav-h))', overflow: 'hidden' }}
      onMouseDown={e => { mouseDownTarget.current = e.target }}
      onClick={e => {
        if (e.target === e.currentTarget && mouseDownTarget.current === e.currentTarget) onClose()
        mouseDownTarget.current = null
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={!title ? 'Dialog' : undefined}
        tabIndex={-1}
        className={`
          trek-modal-enter
          rounded-2xl overflow-hidden shadow-2xl w-full ${sizeClasses[size] || sizeClasses.md}
          flex flex-col
          max-h-[calc(100dvh-var(--bottom-nav-h)-90px)] sm:max-h-[calc(100dvh-90px)]
          bg-surface-card
        `}
        onClick={e => e.stopPropagation()}
      >
        {/* Header — stays put even while the body scrolls */}
        <div className="flex items-center justify-between p-6 flex-shrink-0 border-b border-edge-secondary">
          <h2 id={title ? titleId : undefined} className="text-lg font-semibold text-content">{title}</h2>
          {!hideCloseButton && (
            <button
              type="button"
              aria-label="Close dialog"
              onClick={onClose}
              className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Body — scrolls when content overflows. min-h-0 lets the flex child shrink below its intrinsic height. */}
        <div className="flex-1 overflow-y-auto p-6 min-h-0">
          {children}
        </div>

        {/* Footer — sticky at the bottom of the modal, never compressed */}
        {footer && (
          <div className="p-6 flex-shrink-0 border-t border-edge-secondary">
            {footer}
          </div>
        )}
      </div>

    </div>,
    document.body
  )
}
