import { useMemo, useState } from 'react';
import { supabase, rpc, q } from '../lib/supabase';
import { useAsync, defaultRange, rangeToTs, fmt, pct, go } from '../lib/utils';
import { Btn, Card, Empty, ErrorBox, Loading, Toggle, BarChart } from '../components/ui';

export const KIND_LABEL = { modal: 'ポップアップ（画面中央）', bar: 'オーバーレイ（画面下）', corner: 'オーバーレイ（画面右下）', scenario: 'シナリオポップアップ' };

export function triggerSummary(t = {}) {
  const out = [];
  if (t.exit) out.push('離脱時');
  if (t.predict) out.push('AI離脱予測');
  if (t.load) out.push(t.load_delay ? `表示${t.load_delay}秒後` : 'ページ表示時');
  if (t.time) out.push(`${t.time}秒経過`);
  if (t.scroll) out.push(`${t.scroll}%スクロール`);
  if (t.reverse_top) out.push('逆スクロールで最上部');
  if (t.return_page) out.push('ページ復帰');
  if (t.return_visit) out.push('リピート訪問');
  if (t.click_selector) out.push('要素クリック');
  if (t.banner) out.push('右下バナークリック');
  return out.join('・') || '—';
}

// Thompson Samplingで各クリエイティブが選ばれる確率を推定
function allocation(creatives, goal) {
  const N = 3000;
  const wins = creatives.map(() => 0);
  const gamma = (k) => {
    if (k < 1) return gamma(1 + k) * Math.pow(Math.random(), 1 / k);
    const d = k - 1 / 3, c = 1 / Math.sqrt(9 * d);
    for (;;) {
      let x, v;
      do { x = Math.sqrt(-2 * Math.log(Math.random())) * Math.cos(2 * Math.PI * Math.random()); v = 1 + c * x; } while (v <= 0);
      v = v * v * v;
      const u = Math.random();
      if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
  };
  for (let n = 0; n < N; n++) {
    let best = -1, bi = 0;
    creatives.forEach((c, i) => {
      const s = goal === 'cv' ? c.cv : c.clicks;
      const a = gamma(1 + s), b = gamma(1 + Math.max(0, c.views - s));
      const x = a / (a + b);
      if (x > best) { best = x; bi = i; }
    });
    wins[bi]++;
  }
  return wins.map((w) => w / N);
}

function ScenarioStats({ popup, range }) {
  const r = useAsync(() => rpc('hm_scenario_report', { p_popup: popup.id, ...rangeToTs(range.from, range.to) }), [popup.id, range.from, range.to]);
  if (r.loading) return <Loading />;
  const rows = r.data || [];
  const steps = popup.scenario?.steps || [];
  const results = popup.scenario?.results || [];
  const stepViews = (id) => rows.filter((x) => x.event === 'step' && x.step === id).reduce((a, x) => a + Number(x.n), 0);
  const answers = (id) => rows.filter((x) => x.event === 'answer' && x.step === id);
  const resultViews = (id) => rows.filter((x) => x.event === 'result' && x.step === id).reduce((a, x) => a + Number(x.n), 0);
  return (
    <div className="scenario-stats">
      {steps.map((s, i) => {
        const v = stepViews(s.id);
        const prev = i ? stepViews(steps[i - 1].id) : v;
        return (
          <div key={s.id} className="sc-stat">
            <div className="sc-stat-head"><b>Q{i + 1}. {s.question}</b><span>表示 {fmt(v)}{i > 0 && `（前問から ${pct(v, prev)}）`}</span></div>
            {answers(s.id).map((a) => (
              <div key={a.answer} className="sc-answer"><span>{a.answer}</span><div className="mini-bar"><i style={{ width: pct(a.n, v, 0) }} /></div><span>{fmt(a.n)}（{pct(a.n, v)}）</span></div>
            ))}
          </div>
        );
      })}
      <div className="sc-stat">
        <div className="sc-stat-head"><b>診断結果の表示</b></div>
        {results.map((r2) => <div key={r2.id} className="sc-answer"><span>{r2.title}</span><span>{fmt(resultViews(r2.id))}</span></div>)}
      </div>
    </div>
  );
}

function PopupRow({ p, stats, range, onToggle, onRemove, onDuplicate, siteId }) {
  const [open, setOpen] = useState(false);
  const agg = stats.reduce((a, r) => ({ views: a.views + Number(r.views), clicks: a.clicks + Number(r.clicks), cv: a.cv + Number(r.cv_sessions) }), { views: 0, clicks: 0, cv: 0 });
  const crs = (p.creatives || []).map((c) => {
    const s = stats.find((r) => r.creative_id === c.id) || {};
    return { ...c, views: Number(s.views || 0), clicks: Number(s.clicks || 0), cv: Number(s.cv_sessions || 0) };
  });
  const goal = p.settings?.goal || 'click';
  const alloc = useMemo(() => (crs.length > 1 && p.settings?.optimize === 'auto' ? allocation(crs, goal) : null), [JSON.stringify(crs), goal]);
  const daily = useAsync(async () => (open ? rpc('hm_popup_daily', { p_popup: p.id, ...rangeToTs(range.from, range.to) }) : null), [open, p.id, range.from, range.to]);
  return (
    <>
      <tr className={open ? 'row-open' : ''}>
        <td>
          <button className="link-btn" onClick={() => setOpen(!open)}>{open ? '▾' : '▸'} <b>{p.name}</b></button>
          <div className="cell-sub">{KIND_LABEL[p.kind]} ／ {triggerSummary(p.triggers)}</div>
        </td>
        <td><Toggle checked={p.status === 'active'} onChange={(v) => onToggle(p, v)} /></td>
        <td className="num">{fmt(agg.views)}</td>
        <td className="num">{fmt(agg.clicks)}</td>
        <td className="num">{pct(agg.clicks, agg.views, 2)}</td>
        <td className="num">{fmt(agg.cv)}</td>
        <td className="num">{pct(agg.cv, agg.clicks, 2)}</td>
        <td className="num">{pct(agg.cv, agg.views, 2)}</td>
        <td className="nowrap right">
          <Btn size="sm" onClick={() => go(`/site/${siteId}/popups/${p.id}`)}>編集</Btn>
          <Btn size="sm" kind="ghost" onClick={() => onDuplicate(p)}>複製</Btn>
          <Btn size="sm" kind="ghost" onClick={() => onRemove(p)}>削除</Btn>
        </td>
      </tr>
      {open && (
        <tr className="row-detail">
          <td colSpan={9}>
            {p.kind === 'scenario' ? <ScenarioStats popup={p} range={range} /> : (
              <table className="table table-inner">
                <thead><tr><th>クリエイティブ</th><th className="num">表示</th><th className="num">クリック</th><th className="num">CTR</th><th className="num">CV</th><th className="num">CVR</th><th className="num">CTVR</th>{alloc && <th className="num">自動配分</th>}</tr></thead>
                <tbody>
                  {crs.map((c, i) => (
                    <tr key={c.id}>
                      <td><div className="row gap-8">{c.type === 'image' && c.image_url ? <img src={c.image_url} className="thumb" alt="" /> : <span className="thumb thumb-html">HTML</span>}{c.name}</div></td>
                      <td className="num">{fmt(c.views)}</td>
                      <td className="num">{fmt(c.clicks)}</td>
                      <td className="num">{pct(c.clicks, c.views, 2)}</td>
                      <td className="num">{fmt(c.cv)}</td>
                      <td className="num">{pct(c.cv, c.clicks, 2)}</td>
                      <td className="num">{pct(c.cv, c.views, 2)}</td>
                      {alloc && <td className="num"><b>{(alloc[i] * 100).toFixed(0)}%</b></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {daily.data && (
              <BarChart height={120} rows={daily.data.map((d) => ({ label: d.day.slice(5).replace('-', '/'), views: d.views, clicks: d.clicks }))}
                series={[{ key: 'views', label: '表示', color: '#9db5fb' }, { key: 'clicks', label: 'クリック', color: '#e8543f' }]} />
            )}
          </td>
        </tr>
      )}
    </>
  );
}

export default function Popups({ site }) {
  const [range, setRange] = useState(defaultRange(30));
  const list = useAsync(() => q(supabase.from('hm_popups').select('*, creatives:hm_creatives(*)').eq('site_id', site.id).order('priority', { ascending: false }).order('created_at')), [site.id]);
  const report = useAsync(() => rpc('hm_popup_report', { p_site: site.id, ...rangeToTs(range.from, range.to) }), [site.id, range.from, range.to]);

  const toggle = async (p, on) => {
    await q(supabase.from('hm_popups').update({ status: on ? 'active' : 'paused', updated_at: new Date().toISOString() }).eq('id', p.id));
    list.reload();
  };
  const remove = async (p) => {
    if (!confirm(`「${p.name}」を削除しますか？レポートも削除されます。`)) return;
    await q(supabase.from('hm_popups').delete().eq('id', p.id));
    list.reload();
  };
  const duplicate = async (p) => {
    const { id, created_at, updated_at, creatives, ...rest } = p;
    const np = await q(supabase.from('hm_popups').insert({ ...rest, name: p.name + '（コピー）', status: 'paused' }).select().single());
    if (creatives?.length) {
      await q(supabase.from('hm_creatives').insert(creatives.map(({ id: _i, created_at: _c, popup_id: _p, ...c }) => ({ ...c, popup_id: np.id }))));
    }
    list.reload();
  };

  return (
    <div className="stack">
      <div className="row gap-8 wrap">
        <input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
        <span className="muted">〜</span>
        <input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
        {[7, 30, 90].map((d) => <button key={d} className="chip" onClick={() => setRange(defaultRange(d))}>{d}日</button>)}
        <div className="spacer" />
        <Btn kind="primary" onClick={() => go(`/site/${site.id}/popups/new`)}>＋ ポップアップを作成</Btn>
      </div>
      <ErrorBox error={list.error || report.error} />
      <Card pad={false}>
        {list.loading ? <div className="card-body"><Loading /></div> : !list.data?.length ? (
          <div className="card-body"><Empty title="ポップアップがまだありません">離脱時のポップアップ、画面下・右下のオーバーレイ、アンケート形式のシナリオポップアップを作成できます。</Empty></div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>名前</th><th>配信</th><th className="num">表示回数</th><th className="num">クリック</th><th className="num">CTR</th><th className="num">CV</th><th className="num">CVR</th><th className="num">CTVR</th><th /></tr></thead>
              <tbody>
                {list.data.map((p) => (
                  <PopupRow key={p.id} p={p} siteId={site.id} range={range} stats={(report.data || []).filter((r) => r.popup_id === p.id)}
                    onToggle={toggle} onRemove={remove} onDuplicate={duplicate} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="muted small">CTR＝クリック÷表示、CVR＝CV÷クリック、CTVR＝CV÷表示。CVはポップアップをクリックした後、同じセッション内で発生したCVを数えています。</p>
    </div>
  );
}
