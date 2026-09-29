import { useState } from 'react';
import { rpc } from '../lib/supabase';
import { useAsync, rangeToTs, defaultRange, fmt, pct, sec, shortUrl, go, DEVICE_LABEL } from '../lib/utils';
import { BarChart, Card, Empty, ErrorBox, Loading, Select, Stat } from '../components/ui';

export default function Dashboard({ site }) {
  const [range, setRange] = useState(defaultRange(30));
  const [device, setDevice] = useState('');
  const ts = rangeToTs(range.from, range.to);
  const daily = useAsync(() => rpc('hm_daily', { p_site: site.id, ...ts }), [site.id, range.from, range.to]);
  const pages = useAsync(() => rpc('hm_pages', { p_site: site.id, ...ts, p_device: device || null }), [site.id, range.from, range.to, device]);

  const tot = (daily.data || []).reduce((a, r) => ({ pv: a.pv + Number(r.pv), s: a.s + Number(r.sessions), v: a.v + Number(r.visitors), cv: a.cv + Number(r.cv) }), { pv: 0, s: 0, v: 0, cv: 0 });

  return (
    <div className="stack">
      <div className="row gap-8 wrap">
        <input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
        <span className="muted">〜</span>
        <input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
        {[7, 30, 90].map((d) => <button key={d} className="chip" onClick={() => setRange(defaultRange(d))}>{d}日</button>)}
      </div>
      <ErrorBox error={daily.error || pages.error} />
      <div className="stats-row">
        <Stat label="PV" value={fmt(tot.pv)} />
        <Stat label="セッション" value={fmt(tot.s)} />
        <Stat label="CV" value={fmt(tot.cv)} sub={`CVR ${pct(tot.cv, tot.s)}`} />
        <Stat label="今月の計測PV" value={fmt(site.usage)} sub={`上限 ${fmt(site.pv_limit)}`} />
      </div>
      <Card title="日別推移">
        {daily.loading ? <Loading /> : (
          <BarChart
            rows={(daily.data || []).map((r) => ({ label: r.day.slice(5).replace('-', '/'), pv: r.pv, sessions: r.sessions, cv: r.cv }))}
            series={[{ key: 'pv', label: 'PV', color: '#3b6cf6' }, { key: 'sessions', label: 'セッション', color: '#9db5fb' }, { key: 'cv', label: 'CV', color: '#e8543f' }]}
          />
        )}
      </Card>
      <Card title="ページ一覧" actions={<Select value={device} onChange={setDevice} options={[{ value: '', label: '全デバイス' }, { value: 'pc', label: 'PC' }, { value: 'sp', label: 'スマホ' }, { value: 'tab', label: 'タブレット' }]} />} pad={false}>
        {pages.loading ? <div className="card-body"><Loading /></div> : !pages.data?.length ? (
          <div className="card-body"><Empty title="データがありません">計測タグを設置すると、ここにページごとの数値が表示されます。</Empty></div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>ページ</th><th className="num">PV</th><th className="num">セッション</th><th className="num">平均滞在</th><th className="num">平均到達率</th><th className="num">CVセッション</th><th className="num">CVR</th><th /></tr>
              </thead>
              <tbody>
                {pages.data.map((p) => (
                  <tr key={p.url}>
                    <td>
                      <div className="cell-title">{p.title || shortUrl(p.url)}</div>
                      <div className="cell-sub">{p.url}</div>
                    </td>
                    <td className="num">{fmt(p.pv)}</td>
                    <td className="num">{fmt(p.sessions)}</td>
                    <td className="num">{sec(Number(p.avg_ms))}</td>
                    <td className="num">{p.avg_reach == null ? '-' : (Number(p.avg_reach) * 100).toFixed(0) + '%'}</td>
                    <td className="num">{fmt(p.cv_sessions)}</td>
                    <td className="num">{pct(p.cv_sessions, p.sessions)}</td>
                    <td className="nowrap">
                      {(p.devices || []).map((d) => (
                        <button key={d} className="chip" onClick={() => go(`/site/${site.id}/heatmap`, { url: p.url, dev: d })}>{DEVICE_LABEL[d]}</button>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
