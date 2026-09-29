import { useEffect, useMemo, useRef, useState } from 'react';
import { buildSrcdoc, drawAttention, drawClick, drawScroll, clearOverlay, highlight, infoAt, VIEW_H } from '../lib/heat';

export const MODE_LABEL = { scroll: 'スクロール', attention: 'アテンション', click: 'クリック', none: 'デザインのみ' };

// syncGroup: { panels: Map<id, Window>, lock: boolean } を親で共有すると、スクロールが連動する
export default function HeatmapPanel({ id, snapshot, data, mode, device, syncGroup, highlightSel, label, maxHeight }) {
  const wrapRef = useRef(null);
  const frameRef = useRef(null);
  const [width, setWidth] = useState(800);
  const [loaded, setLoaded] = useState(0);
  const [tip, setTip] = useState(null);

  const snapW = snapshot?.doc_w || (device === 'sp' ? 390 : device === 'tab' ? 820 : 1280);
  const viewH = VIEW_H[device] || 860;
  const scale = Math.min(1, width / snapW);
  const dispH = Math.min(viewH * scale, maxHeight || 99999);
  const srcdoc = useMemo(() => buildSrcdoc(snapshot?.html), [snapshot?.html]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => setWidth(entries[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const doc = () => {
    try { return frameRef.current?.contentDocument; } catch { return null; }
  };

  // 描画
  useEffect(() => {
    const d = doc();
    if (!d || !d.body) return;
    const paint = () => {
      if (!data || mode === 'none') return clearOverlay(d);
      if (mode === 'click') drawClick(d, data.clicks || [], snapW);
      else if (mode === 'scroll') drawScroll(d, data.scroll || [], data.n || 0);
      else if (mode === 'attention') drawAttention(d, data.attention || []);
    };
    paint();
    // 画像の読み込み完了でページの高さが変わるため少し後に再描画
    const t = setTimeout(paint, 1200);
    return () => clearTimeout(t);
  }, [loaded, data, mode, snapW]);

  // ホバーで到達率・注目度を表示／スクロール連動
  useEffect(() => {
    const d = doc();
    const win = frameRef.current?.contentWindow;
    if (!d || !win) return;
    const onMove = (e) => {
      if (!data) return;
      const info = infoAt(d, e.pageY, data);
      setTip({ x: e.clientX * scale, y: e.clientY * scale, ...info });
    };
    const onLeave = () => setTip(null);
    const onScroll = () => {
      if (!syncGroup || syncGroup.lock) return;
      const max = d.documentElement.scrollHeight - win.innerHeight;
      const ratio = max > 0 ? win.scrollY / max : 0;
      syncGroup.lock = true;
      for (const [pid, w] of syncGroup.panels) {
        if (pid === id) continue;
        try {
          const m = w.document.documentElement.scrollHeight - w.innerHeight;
          w.scrollTo(0, ratio * m);
        } catch { /* ignore */ }
      }
      requestAnimationFrame(() => { syncGroup.lock = false; });
    };
    d.addEventListener('mousemove', onMove);
    d.addEventListener('mouseleave', onLeave);
    win.addEventListener('scroll', onScroll, { passive: true });
    // スナップショット内のリンク遷移を無効化
    const block = (e) => { if (e.target.closest && e.target.closest('a,button,form')) e.preventDefault(); };
    d.addEventListener('click', block, true);
    d.addEventListener('submit', (e) => e.preventDefault(), true);
    if (syncGroup) syncGroup.panels.set(id, win);
    return () => {
      d.removeEventListener('mousemove', onMove);
      d.removeEventListener('mouseleave', onLeave);
      win.removeEventListener('scroll', onScroll);
      if (syncGroup) syncGroup.panels.delete(id);
    };
  }, [loaded, data, scale, syncGroup, id]);

  useEffect(() => {
    const d = doc();
    if (d && d.body) highlight(d, highlightSel);
  }, [highlightSel, loaded]);

  return (
    <div className="hm-panel" ref={wrapRef}>
      {label && <div className="hm-panel-label">{label}</div>}
      <div className="hm-stage" style={{ width: snapW * scale, height: dispH }}>
        <iframe
          ref={frameRef}
          title={label || 'heatmap'}
          srcDoc={srcdoc}
          sandbox="allow-same-origin"
          style={{ width: snapW, height: dispH / scale, transform: `scale(${scale})`, transformOrigin: '0 0' }}
          onLoad={() => setLoaded((n) => n + 1)}
        />
        {tip && mode !== 'click' && (
          <div className="hm-tip" style={{ left: Math.min(tip.x + 14, snapW * scale - 180), top: tip.y + 14 }}>
            <div>到達率 <b>{(tip.reach * 100).toFixed(1)}%</b></div>
            <div>平均注目時間 <b>{tip.avgSec.toFixed(1)}秒</b></div>
          </div>
        )}
      </div>
      <Legend mode={mode} />
    </div>
  );
}

function Legend({ mode }) {
  if (mode === 'none') return null;
  const text = { scroll: ['到達率 低', '高'], attention: ['注目度 低', '高'], click: ['クリック 少', '多'] }[mode];
  return (
    <div className="hm-legend">
      <span>{text[0]}</span>
      <i />
      <span>{text[1]}</span>
    </div>
  );
}
