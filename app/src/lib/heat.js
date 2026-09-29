// ヒートマップ描画エンジン
// スナップショットを同一オリジンのiframe（スクリプト無効）に描画し、
// そのドキュメント内にオーバーレイのcanvasを重ねる。

export const VIEW_H = { pc: 860, tab: 1000, sp: 740 };

const FRAME_CSS = `
*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}
[data-aos],.aos-init,.wow,.fadein,.fade-in,.js-fade,.inview,.is-hidden-before{opacity:1!important;transform:none!important;visibility:visible!important}
html{overflow-x:hidden!important}
#__hm_ov{position:absolute;left:0;top:0;pointer-events:none;z-index:2147483646}
#__hm_ov img{position:absolute;left:0;top:0;width:100%;height:100%;max-width:none}
#__hm_hl{position:absolute;pointer-events:none;z-index:2147483647;outline:3px solid #ff3d7f;background:rgba(255,61,127,.15);border-radius:4px;transition:none}
.__hm_mark{position:absolute;left:0;right:0;border-top:2px dashed rgba(255,255,255,.95);z-index:2147483647;pointer-events:none}
.__hm_mark span{position:absolute;left:8px;top:-13px;background:#111;color:#fff;font:600 12px/1 sans-serif;padding:6px 9px;border-radius:999px;white-space:nowrap}
`;

export function buildSrcdoc(html) {
  if (!html) return '<html><body style="font-family:sans-serif;color:#888;padding:40px">デザインがまだ保存されていません</body></html>';
  const style = `<style id="__hm_css">${FRAME_CSS}</style>`;
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, style + '</head>');
  return style + html;
}

// ---------- カラーパレット ----------
const STOPS = [
  [0, [0, 60, 255]],
  [0.25, [0, 200, 255]],
  [0.5, [0, 230, 90]],
  [0.75, [255, 230, 0]],
  [1, [255, 30, 0]],
];
export function heatColor(v) {
  v = Math.max(0, Math.min(1, v));
  for (let i = 1; i < STOPS.length; i++) {
    if (v <= STOPS[i][0]) {
      const [p0, c0] = STOPS[i - 1];
      const [p1, c1] = STOPS[i];
      const t = (v - p0) / (p1 - p0);
      return c0.map((c, k) => Math.round(c + (c1[k] - c) * t));
    }
  }
  return STOPS[STOPS.length - 1][1];
}
let paletteCache = null;
function palette() {
  if (paletteCache) return paletteCache;
  const p = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const c = heatColor(i / 255);
    p[i * 3] = c[0];
    p[i * 3 + 1] = c[1];
    p[i * 3 + 2] = c[2];
  }
  paletteCache = p;
  return p;
}

function docSize(doc) {
  const de = doc.documentElement;
  const b = doc.body || de;
  return {
    W: Math.max(de.clientWidth, de.scrollWidth > de.clientWidth * 1.5 ? de.clientWidth : de.scrollWidth),
    H: Math.max(de.scrollHeight, b.scrollHeight, de.offsetHeight),
  };
}

// ---------- クリック位置の解決 ----------
export function resolveClicks(doc, clicks, snapW) {
  const cache = new Map();
  const win = doc.defaultView;
  const sx = win ? win.scrollX : 0;
  const sy = win ? win.scrollY : 0;
  const pts = [];
  for (const c of clicks || []) {
    let x = null, y = null;
    if (c.s) {
      let el = cache.get(c.s);
      if (el === undefined) {
        try { el = doc.querySelector(c.s); } catch { el = null; }
        cache.set(c.s, el);
      }
      if (el) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 || r.height > 0) {
          x = r.left + sx + (c.rx ?? 0.5) * r.width;
          y = r.top + sy + (c.ry ?? 0.5) * r.height;
        }
      }
    }
    if (x == null) {
      x = c.dw ? (c.x * snapW) / c.dw : c.x;
      y = c.y;
    }
    if (Number.isFinite(x) && Number.isFinite(y)) pts.push([x, y]);
  }
  return pts;
}

function makeOverlay(doc) {
  let ov = doc.getElementById('__hm_ov');
  if (ov) ov.remove();
  doc.querySelectorAll('.__hm_mark').forEach((m) => m.remove());
  const { W, H } = docSize(doc);
  ov = doc.createElement('div');
  ov.id = '__hm_ov';
  ov.style.width = W + 'px';
  ov.style.height = H + 'px';
  const k = Math.min(1, 16000 / H, 12000000 / (W * H));
  // スクリプト無効のiframe内ではcanvasが描画されないため、親側で描いて画像として重ねる
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(W * k));
  canvas.height = Math.max(1, Math.round(H * k));
  (doc.body || doc.documentElement).appendChild(ov);
  const commit = () => {
    const img = doc.createElement('img');
    img.alt = '';
    img.src = canvas.toDataURL('image/png');
    ov.appendChild(img);
  };
  return { ov, canvas, ctx: canvas.getContext('2d'), W, H, k, commit };
}

// ---------- 描画 ----------
export function drawClick(doc, clicks, snapW) {
  const { canvas, ctx, k, W, H, commit } = makeOverlay(doc);
  const pts = resolveClicks(doc, clicks, snapW);
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!pts.length) { commit(); return { points: 0 }; }
  // グリッド集計
  const cell = 4;
  const grid = new Map();
  let max = 0;
  for (const [x, y] of pts) {
    if (x < 0 || y < 0 || x > W || y > H) continue;
    const key = Math.round(x / cell) + ':' + Math.round(y / cell);
    const v = (grid.get(key) || 0) + 1;
    grid.set(key, v);
    if (v > max) max = v;
  }
  const r = Math.max(6, 22 * k);
  const shadow = document.createElement('canvas');
  shadow.width = canvas.width;
  shadow.height = canvas.height;
  const sctx = shadow.getContext('2d');
  const blob = document.createElement('canvas');
  blob.width = blob.height = r * 2;
  const bctx = blob.getContext('2d');
  const g = bctx.createRadialGradient(r, r, 0, r, r, r);
  g.addColorStop(0, 'rgba(0,0,0,1)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  bctx.fillStyle = g;
  bctx.fillRect(0, 0, r * 2, r * 2);
  const denom = Math.max(1, Math.log(max + 1));
  for (const [key, v] of grid) {
    const [gx, gy] = key.split(':').map(Number);
    sctx.globalAlpha = Math.max(0.12, Math.log(v + 1) / denom);
    sctx.drawImage(blob, gx * cell * k - r, gy * cell * k - r);
  }
  const img = sctx.getImageData(0, 0, shadow.width, shadow.height);
  const d = img.data;
  const pal = palette();
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    if (!a) continue;
    const j = a * 3;
    d[i] = pal[j];
    d[i + 1] = pal[j + 1];
    d[i + 2] = pal[j + 2];
    d[i + 3] = Math.min(255, a * 1.4 + 40);
  }
  sctx.putImageData(img, 0, 0);
  ctx.drawImage(shadow, 0, 0);
  commit();
  return { points: pts.length };
}

export function drawScroll(doc, scroll, n) {
  const { canvas, ctx, commit } = makeOverlay(doc);
  const h = canvas.height;
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  for (let i = 0; i < 100; i++) {
    const v = n ? (scroll[i] || 0) / n : 0;
    const c = heatColor(v);
    const a = 0.25 + (1 - v) * 0.5;
    grad.addColorStop(i / 99, `rgba(${c[0]},${c[1]},${c[2]},${a.toFixed(3)})`);
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, h);
  commit();
  // 到達率ライン
  const { H } = docSize(doc);
  for (const th of [0.75, 0.5, 0.25]) {
    let idx = -1;
    for (let i = 0; i < 100; i++) {
      if (n && (scroll[i] || 0) / n < th) { idx = i; break; }
    }
    if (idx < 0) continue;
    const m = doc.createElement('div');
    m.className = '__hm_mark';
    m.style.top = (idx / 100) * H + 'px';
    m.style.position = 'absolute';
    m.innerHTML = `<span>${Math.round(th * 100)}%のユーザーがここまで到達</span>`;
    (doc.body || doc.documentElement).appendChild(m);
  }
}

export function drawAttention(doc, attention) {
  const { canvas, ctx, commit } = makeOverlay(doc);
  const h = canvas.height;
  const max = Math.max(1, ...attention.map(Number));
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  for (let i = 0; i < 100; i++) {
    const v = (attention[i] || 0) / max;
    const c = heatColor(v);
    // 注目度が低いほど暗く、高いほど暖色で明るく
    const dark = 1 - v;
    const r = Math.round(c[0] * v), g = Math.round(c[1] * v), b = Math.round(c[2] * v + 30 * dark);
    grad.addColorStop(i / 99, `rgba(${r},${g},${b},${(0.45 + dark * 0.25).toFixed(3)})`);
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, h);
  commit();
}

export function clearOverlay(doc) {
  const ov = doc.getElementById('__hm_ov');
  if (ov) ov.remove();
  doc.querySelectorAll('.__hm_mark').forEach((m) => m.remove());
}

export function highlight(doc, selector) {
  let hl = doc.getElementById('__hm_hl');
  if (!selector) {
    if (hl) hl.remove();
    return;
  }
  let el = null;
  try { el = doc.querySelector(selector); } catch { el = null; }
  if (!el) return;
  const r = el.getBoundingClientRect();
  const win = doc.defaultView;
  if (!hl) {
    hl = doc.createElement('div');
    hl.id = '__hm_hl';
    (doc.body || doc.documentElement).appendChild(hl);
  }
  hl.style.left = r.left + win.scrollX - 3 + 'px';
  hl.style.top = r.top + win.scrollY - 3 + 'px';
  hl.style.width = r.width + 6 + 'px';
  hl.style.height = r.height + 6 + 'px';
  el.scrollIntoView({ block: 'center' });
}

// ポインタ位置（ドキュメント座標y）の到達率・注目度
export function infoAt(doc, y, data) {
  const { H } = docSize(doc);
  const i = Math.max(0, Math.min(99, Math.floor((y / H) * 100)));
  const n = data?.n || 0;
  const att = data?.attention || [];
  const max = Math.max(1, ...att.map(Number));
  return {
    reach: n ? (data.scroll[i] || 0) / n : 0,
    attention: (att[i] || 0) / max,
    avgSec: n ? (att[i] || 0) / n / 1000 : 0,
  };
}
