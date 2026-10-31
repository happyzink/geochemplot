import { useEffect, type ReactNode } from 'react';

interface ModalProps {
  title: string;
  subtitle?: string;
  width?: 'narrow' | 'wide';
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
}

/** 通用模态框；Esc 关闭，点击遮罩不误关（避免丢失正在编辑的格式）。 */
export function Modal({ title, subtitle, width, onClose, footer, children }: ModalProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="modal-backdrop">
      <div
        className={`modal${width ? ` ${width}` : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-head">
          <h2>
            {title}
            {subtitle && <span className="sub">{subtitle}</span>}
          </h2>
          <div className="spacer" />
          <button className="icon-btn" title="关闭（Esc）" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}
