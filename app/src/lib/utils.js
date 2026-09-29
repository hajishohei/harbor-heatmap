import { useEffect, useState, useCallback } from 'react';

// ---------- ルーティング（ハッシュ） ----------
export function parseHash() {
  const raw = window.location.hash.replace(/^#/, '') || '/';
  const [path, query = ''] = raw.split('?');
  const params = Object.fromEntries(new URLSearchParams(query));
  return { path, parts: path.split('/').filter(Boolean), params };
}
export function useRoute() {
  const [route, setRoute] = useState(parseHash());
  useEffect(() => {
    const fn = () => setRoute(parseHash());
    window.addEventListener('hashchange', fn);
    return () => window.removeEventListener('hashchange', fn);
  }, []);
  return route;
}
export function go(path, params) {
  const qs = params ? '?' + new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString() : '';
  window.location.hash = path + (qs === '?' ? '' : qs);
}

// ---------- 非同期データ ----------
export function useAsync(fn, deps) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const run = useCallback(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    Promise.resolve()
      .then(fn)
      .then((data) => alive && setState({ loading: false, data, error: null }))
      .catch((error) => alive && setState({ loading: false, data: null, error }));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(run, [run]);
  return { ...state, reload: run };
}

// ---------- 日付 ----------
export function isoDate(d) {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}
export function daysAgo(n) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
}
// 期間（YYYY-MM-DD, YYYY-MM-DD）→ RPC用の from/to（toは翌日0時）
export function rangeToTs(from, to) {
  // 日付入力が空・不正のとき（クリア操作など）に toISOString() が例外を投げないようにする
  let f = new Date(from + 'T00:00:00');
  let t = new Date(to + 'T00:00:00');
  if (isNaN(f)) f = daysAgo(29);
  if (isNaN(t)) t = daysAgo(0);
  t.setDate(t.getDate() + 1);
  return { p_from: f.toISOString(), p_to: t.toISOString() };
}
export function defaultRange(days = 30) {
  return { from: isoDate(daysAgo(days - 1)), to: isoDate(new Date()) };
}

// ---------- 表示 ----------
export const fmt = (n) => (n == null || isNaN(n) ? '-' : Number(n).toLocaleString('ja-JP'));
export const pct = (a, b, digits = 1) => (!Number(b) ? '-' : ((a / b) * 100).toFixed(digits) + '%');
export const sec = (ms) => (ms == null ? '-' : ms >= 60000 ? `${Math.floor(ms / 60000)}分${Math.round((ms % 60000) / 1000)}秒` : `${Math.round(ms / 1000)}秒`);
export const DEVICE_LABEL = { pc: 'PC', sp: 'スマホ', tab: 'タブレット' };
export function shortUrl(u) {
  try {
    const x = new URL(u);
    return x.pathname === '/' ? x.host + '/' : x.pathname;
  } catch {
    return u;
  }
}

export function downloadCsv(filename, rows) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const csv = '﻿' + rows.map((r) => r.map(esc).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function uid() {
  return Math.random().toString(36).slice(2, 10);
}
