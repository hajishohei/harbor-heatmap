import { useEffect } from 'react';

export function Btn({ kind = 'default', size, className = '', ...p }) {
  return <button className={`btn btn-${kind} ${size ? 'btn-' + size : ''} ${className}`} {...p} />;
}

export function Field({ label, hint, children, inline }) {
  return (
    <label className={`field ${inline ? 'field-inline' : ''}`}>
      {label && <span className="field-label">{label}</span>}
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Select({ value, onChange, options, ...p }) {
  return (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...p}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

export function Card({ title, actions, children, className = '', pad = true }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="card-head">
          {title && <h3>{title}</h3>}
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      <div className={pad ? 'card-body' : ''}>{children}</div>
    </section>
  );
}

export function Loading({ text = '読み込み中…' }) {
  return <div className="loading"><span className="spinner" />{text}</div>;
}

export function Empty({ title, children }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children && <div>{children}</div>}
    </div>
  );
}

export function ErrorBox({ error }) {
  if (!error) return null;
  return <div className="error-box">エラー: {String(error.message || error)}</div>;
}

export function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const fn = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [onClose]);
  return (
    <div className="modal-ov" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`}>
        <header className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="閉じる">×</button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}

export function Tabs({ value, onChange, items }) {
  return (
    <div className="tabs" role="tablist">
      {items.map((it) => (
        <button key={it.value} role="tab" className={`tab ${value === it.value ? 'on' : ''}`} onClick={() => onChange(it.value)}>
          {it.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track"><span className="toggle-thumb" /></span>
      {label && <span>{label}</span>}
    </label>
  );
}

export function Check({ checked, onChange, label }) {
  return (
    <label className="check">
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function Stat({ label, value, sub }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

export function Copy({ text }) {
  return (
    <div className="copy">
      <pre>{text}</pre>
      <Btn size="sm" onClick={() => { navigator.clipboard.writeText(text); }}>コピー</Btn>
    </div>
  );
}

// シンプルな棒グラフ（SVG）
export function BarChart({ rows, series, height = 180 }) {
  if (!rows?.length) return <Empty title="データがありません" />;
  const max = Math.max(1, ...rows.flatMap((r) => series.map((s) => Number(r[s.key]) || 0)));
  const w = 100 / rows.length;
  return (
    <div className="barchart">
      <div className="barchart-legend">
        {series.map((s) => (
          <span key={s.key}><i style={{ background: s.color }} />{s.label}</span>
        ))}
      </div>
      <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" style={{ width: '100%', height }}>
        {rows.map((r, i) => series.map((s, j) => {
          const v = Number(r[s.key]) || 0;
          const bw = (w * 0.8) / series.length;
          const h = (v / max) * (height - 4);
          return (
            <rect key={i + '-' + j} x={i * w + w * 0.1 + j * bw} y={height - h} width={bw} height={h} fill={s.color}>
              <title>{`${r.label} ${s.label}: ${v.toLocaleString()}`}</title>
            </rect>
          );
        }))}
      </svg>
      <div className="barchart-x">
        {rows.map((r, i) => (
          <span key={i} style={{ width: w + '%' }}>{rows.length <= 16 || i % Math.ceil(rows.length / 12) === 0 ? r.label : ''}</span>
        ))}
      </div>
    </div>
  );
}
