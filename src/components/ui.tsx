import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export function TopBar({ title, sub, back, actions }: { title: ReactNode; sub?: ReactNode; back?: string | (() => void); actions?: ReactNode }) {
  return (
    <header className="topbar">
      {back &&
        (typeof back === 'string' ? (
          <a className="icon-btn" href={back} aria-label="Back">
            <Icon name="left" />
          </a>
        ) : (
          <button className="icon-btn" onClick={back} aria-label="Back">
            <Icon name="left" />
          </button>
        ))}
      <h1>
        {title}
        {sub && <span className="sub">{sub}</span>}
      </h1>
      {actions}
    </header>
  );
}

export function Sheet({ title, onClose, children, labelledBy }: { title: ReactNode; onClose: () => void; children: ReactNode; labelledBy?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby={labelledBy ?? id} tabIndex={-1} ref={ref}>
        <div className="sheet__grip" />
        <div className="sheet__head">
          <h2 id={id}>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, hint, children, htmlFor }: { label: ReactNode; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="field">
      <label className="field__label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && <span className="field__hint">{hint}</span>}
    </div>
  );
}

export function TextInput({ label, hint, value, onChange, ...rest }: { label: ReactNode; hint?: ReactNode; value: string; onChange: (v: string) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const id = useId();
  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <input id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)} {...rest} />
    </Field>
  );
}

export function Stepper({ label, hint, value, onChange, min = 0, max = 999, step = 1, suffix }: { label: ReactNode; hint?: ReactNode; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; suffix?: string }) {
  const id = useId();
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v / step) * step));
  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <div className="stepper">
        <button type="button" onClick={() => onChange(clamp(value - step))} aria-label={`Decrease ${typeof label === 'string' ? label : ''}`} disabled={value <= min}>
          −
        </button>
        <input
          id={id}
          className="num"
          inputMode="decimal"
          value={Number.isFinite(value) ? String(value) : ''}
          onChange={(e) => {
            const v = Number(e.target.value.replace(',', '.'));
            if (e.target.value === '') onChange(min);
            else if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v)));
          }}
          aria-describedby={suffix ? `${id}-s` : undefined}
        />
        {suffix && (
          <span id={`${id}-s`} className="muted small" style={{ paddingRight: 4 }}>
            {suffix}
          </span>
        )}
        <button type="button" onClick={() => onChange(clamp(value + step))} aria-label={`Increase ${typeof label === 'string' ? label : ''}`} disabled={value >= max}>
          +
        </button>
      </div>
    </Field>
  );
}

export function Segmented<T extends string>({ label, hint, value, options, onChange }: { label: ReactNode; hint?: ReactNode; value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <fieldset className="field">
      <legend className="field__label">{label}</legend>
      <div className="segmented">
        {options.map((o) => (
          <button type="button" key={o.value} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
      {hint && <span className="field__hint">{hint}</span>}
    </fieldset>
  );
}

export function MultiSelect<T extends string>({ label, hint, values, options, onChange }: { label: ReactNode; hint?: ReactNode; values: T[]; options: { value: T; label: ReactNode }[]; onChange: (v: T[]) => void }) {
  return (
    <fieldset className="field">
      <legend className="field__label">{label}</legend>
      <div className="segmented">
        {options.map((o) => {
          const on = values.includes(o.value);
          return (
            <button type="button" key={o.value} aria-pressed={on} onClick={() => onChange(on ? values.filter((v) => v !== o.value) : [...values, o.value])}>
              {on && <Icon name="check" size={16} />} {o.label}
            </button>
          );
        })}
      </div>
      {hint && <span className="field__hint">{hint}</span>}
    </fieldset>
  );
}

export function Toggle({ label, hint, checked, onChange }: { label: ReactNode; hint?: ReactNode; checked: boolean; onChange: (v: boolean) => void }) {
  const id = useId();
  return (
    <label className="toggle" htmlFor={id}>
      <span className="toggle__text">
        {label}
        {hint && <small>{hint}</small>}
      </span>
      <input id={id} type="checkbox" role="switch" className="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

export function Notice({ kind = 'info', icon, children }: { kind?: 'info' | 'warn' | 'safety'; icon?: IconName; children: ReactNode }) {
  return (
    <div className={`notice notice--${kind}`} role={kind === 'info' ? undefined : 'note'}>
      <Icon name={icon ?? (kind === 'info' ? 'info' : 'warn')} size={20} />
      <div>{children}</div>
    </div>
  );
}

export function Empty({ icon, title, children, action }: { icon: IconName; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon} size={40} />
      <h2>{title}</h2>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Bar({ pct, cap }: { pct: number; cap?: boolean }) {
  return (
    <div className={`bar${cap ? ' bar--cap' : ''}`} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <span style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </div>
  );
}

export function Toast({ message, action, onAction, onDone, ms = 4500 }: { message: string; action?: string; onAction?: () => void; onDone: () => void; ms?: number }) {
  useEffect(() => {
    const t = setTimeout(onDone, ms);
    return () => clearTimeout(t);
  }, [message, ms, onDone]);
  return (
    <div className="toast" role="status" aria-live="polite">
      <span>{message}</span>
      {action && (
        <button
          onClick={() => {
            onAction?.();
            onDone();
          }}
        >
          {action}
        </button>
      )}
    </div>
  );
}

export function ListLink({ href, onClick, icon, title, meta, right }: { href?: string; onClick?: () => void; icon?: IconName; title: ReactNode; meta?: ReactNode; right?: ReactNode }) {
  const body = (
    <>
      {icon && (
        <span className="list-link__icon">
          <Icon name={icon} />
        </span>
      )}
      <span className="list-link__body">
        <span className="list-link__title">{title}</span>
        {meta && <span className="list-link__meta">{meta}</span>}
      </span>
      {right ?? <Icon name="right" className="chev" size={18} />}
    </>
  );
  return href ? (
    <a className="list-link" href={href}>
      {body}
    </a>
  ) : (
    <button className="list-link" onClick={onClick}>
      {body}
    </button>
  );
}

export function downloadText(filename: string, text: string, type = 'application/json') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
