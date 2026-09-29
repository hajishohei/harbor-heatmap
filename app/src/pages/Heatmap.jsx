import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase, rpc, q } from '../lib/supabase';
import { useAsync, rangeToTs, defaultRange, isoDate, daysAgo, fmt, pct, sec, shortUrl, downloadCsv, DEVICE_LABEL, go } from '../lib/utils';
import HeatmapPanel, { MODE_LABEL } from '../components/HeatmapPanel';
import { Btn, Card, Empty, ErrorBox, Field, Loading, Modal, Select, Stat, Tabs } from '../components/ui';

const htmlCache = new Map();

function useHeatmap(siteId, url, cfg) {
  const snaps = useAsync(async () => {
    if (!url) return [];
    return q(supabase.from('hm_snapshots').select('id,hash,doc_w,doc_h,created_at,label')
      .eq('site_id', siteId).eq('url', url).eq('device', cfg.dev).order('created_at', { ascending: false }));
  }, [siteId, url, cfg.dev]);

  const snapMeta = useMemo(() => {
    const list = snaps.data || [];
    if (!list.length) return null;
    if (cfg.ver === 'latest' || cfg.ver === 'all') return list[0];
    return list.find((s) => s.hash === cfg.ver) || list[0];
  }, [snaps.data, cfg.ver]);

  const html = useAsync(async () => {
    if (!snapMeta) return null;
    if (htmlCache.has(snapMeta.id)) return htmlCache.get(snapMeta.id);
    const row = await q(supabase.from('hm_snapshots').select('html').eq('id', snapMeta.id).single());
    htmlCache.set(snapMeta.id, row.html);
    return row.html;
  }, [snapMeta?.id]);

  const hash = cfg.ver === 'all' ? null : snapMeta?.hash || null;
  const data = useAsync(async () => {
    if (!url || snaps.loading) return null;
    return rpc('hm_heatmap', {
      p_site: siteId, p_url: url, p_device: cfg.dev, ...rangeToTs(cfg.from, cfg.to),
      p_seg: cfg.seg, p_hash: hash,
    });
  }, [siteId, url, cfg.dev, cfg.from, cfg.to, JSON.stringify(cfg.seg), hash, snaps.loading]);

  return {
    snapshots: snaps.data || [],
    snapshot: snapMeta ? { ...snapMeta, html: html.data } : null,
    data: data.data,
    hash,
    loading: snaps.loading || data.loading || html.loading,
    error: snaps.error || data.error || html.error,
  };
}

function newCfg(dev = 'pc', days = 30) {
  const r = defaultRange(days);
  return { dev, from: r.from, to: r.to, seg: { cv: 'all', visitor: 'all', source: '', cv_tag: null }, ver: 'latest' };
}

function Controls({ cfg, setCfg, cvTags, sources, snapshots, compact }) {
  const set = (patch) => setCfg({ ...cfg, ...patch });
  const setSeg = (patch) => setCfg({ ...cfg, seg: { ...cfg.seg, ...patch } });
  const preset = (days) => { const r = defaultRange(days); set({ from: r.from, to: r.to }); };
  return (
    <div className={`controls ${compact ? 'controls-compact' : ''}`}>
      <Field label="デバイス">
        <Select value={cfg.dev} onChange={(v) => set({ dev: v, ver: 'latest' })}
          options={[{ value: 'pc', label: 'PC' }, { value: 'sp', label: 'スマホ' }, { value: 'tab', label: 'タブレット' }]} />
      </Field>
      <Field label="期間">
        <div className="row gap-4">
          <input type="date" value={cfg.from} max={cfg.to} onChange={(e) => set({ from: e.target.value })} />
          <span className="muted">〜</span>
          <input type="date" value={cfg.to} min={cfg.from} onChange={(e) => set({ to: e.target.value })} />
        </div>
        <div className="row gap-4 mt-4">
          {[7, 30, 90].map((d) => <button key={d} className="chip" onClick={() => preset(d)}>{d}日</button>)}
        </div>
      </Field>
      <Field label="デザイン">
        <Select value={cfg.ver} onChange={(v) => set({ ver: v })} options={[
          { value: 'latest', label: '最新デザイン' },
          ...snapshots.slice(1).map((s, i) => ({ value: s.hash, label: `${s.label || `以前のデザイン${i + 1}`}（${new Date(s.created_at).toLocaleDateString('ja-JP')}〜）` })),
          { value: 'all', label: 'すべてのデザインを合算' },
        ]} />
      </Field>
      <Field label="CV">
        <Select value={cfg.seg.cv} onChange={(v) => setSeg({ cv: v })}
          options={[{ value: 'all', label: 'すべての訪問者' }, { value: 'cv', label: 'CVした訪問者' }, { value: 'noncv', label: 'CVしていない訪問者' }]} />
        {cfg.seg.cv !== 'all' && cvTags.length > 0 && (
          <Select value={cfg.seg.cv_tag || ''} onChange={(v) => setSeg({ cv_tag: v || null })}
            options={[{ value: '', label: 'すべてのCV' }, ...cvTags.map((t) => ({ value: t.id, label: t.name }))]} className="mt-4" />
        )}
      </Field>
      <Field label="訪問者">
        <Select value={cfg.seg.visitor} onChange={(v) => setSeg({ visitor: v })}
          options={[{ value: 'all', label: 'すべて' }, { value: 'new', label: '新規' }, { value: 'return', label: 'リピーター' }]} />
      </Field>
      <Field label="流入元">
        <Select value={cfg.seg.source || ''} onChange={(v) => setSeg({ source: v })}
          options={[{ value: '', label: 'すべて' }, ...sources.map((s) => ({ value: s.source, label: `${s.source}（${s.n}）` }))]} />
      </Field>
    </div>
  );
}

function Summary({ data }) {
  if (!data) return null;
  return (
    <div className="stats-row">
      <Stat label="PV" value={fmt(data.n)} />
      <Stat label="セッション" value={fmt(data.sessions)} />
      <Stat label="CVセッション" value={fmt(data.cv_sessions)} sub={pct(data.cv_sessions, data.sessions)} />
      <Stat label="滞在時間（中央値）" value={sec(data.med_ms)} />
    </div>
  );
}

function Ranking({ data, onHover, url }) {
  const rows = data?.ranking || [];
  const total = (data?.clicks || []).length;
  const exportCsv = () => downloadCsv(`clicks_${shortUrl(url).replace(/[^\w-]/g, '_')}.csv`, [
    ['順位', '要素', 'テキスト', 'リンク先', 'クリック数', '割合', 'セレクタ'],
    ...rows.map((r, i) => [i + 1, r.tag, r.tx, r.h, r.n, total ? ((r.n / total) * 100).toFixed(1) + '%' : '', r.s]),
  ]);
  return (
    <Card title="クリックされた要素" actions={<Btn size="sm" onClick={exportCsv} disabled={!rows.length}>CSV出力</Btn>} pad={false}>
      {!rows.length ? <div className="card-body"><Empty title="クリックデータがありません" /></div> : (
        <div className="ranking">
          {rows.slice(0, 50).map((r, i) => (
            <div key={r.s} className="ranking-row" onMouseEnter={() => onHover(r.s)} onMouseLeave={() => onHover(null)}>
              <span className="rank-no">{i + 1}</span>
              <span className="rank-body">
                <span className="rank-text">{r.tx || `<${r.tag}>`}</span>
                {r.h && <span className="rank-href">{r.h}</span>}
              </span>
              <span className="rank-n">{fmt(r.n)}<small>{total ? ((r.n / total) * 100).toFixed(1) + '%' : ''}</small></span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function ShareModal({ site, url, cfg, hash, mode, onClose }) {
  const [expiry, setExpiry] = useState('30');
  const [link, setLink] = useState('');
  const [err, setErr] = useState(null);
  const create = async () => {
    try {
      const { p_from, p_to } = rangeToTs(cfg.from, cfg.to);
      const expires_at = expiry === '0' ? null : new Date(Date.now() + Number(expiry) * 86400000).toISOString();
      const row = await q(supabase.from('hm_shares').insert({
        site_id: site.id, expires_at,
        config: { url, device: cfg.dev, from: p_from, to: p_to, seg: cfg.seg, hash, mode },
      }).select().single());
      setLink(`${location.origin}${location.pathname}#/share/${row.token}`);
    } catch (e) { setErr(e); }
  };
  return (
    <Modal title="ヒートマップを外部共有" onClose={onClose}>
      <p className="muted">いまの表示条件（ページ・デバイス・期間・セグメント・デザイン）で、ログイン不要の閲覧用URLを発行します。</p>
      <Field label="有効期限">
        <Select value={expiry} onChange={setExpiry} options={[{ value: '7', label: '7日間' }, { value: '30', label: '30日間' }, { value: '90', label: '90日間' }, { value: '0', label: '無期限' }]} />
      </Field>
      <ErrorBox error={err} />
      {link ? (
        <div className="share-link">
          <input readOnly value={link} onFocus={(e) => e.target.select()} />
          <Btn kind="primary" onClick={() => navigator.clipboard.writeText(link)}>コピー</Btn>
        </div>
      ) : <Btn kind="primary" onClick={create}>URLを発行</Btn>}
    </Modal>
  );
}

export default function HeatmapPage({ site, route }) {
  const [url, setUrl] = useState(route.params.url || '');
  const [layout, setLayout] = useState('single');
  const [mode, setMode] = useState('click');
  const [cfgA, setCfgA] = useState(() => newCfg(route.params.dev || 'pc'));
  const [cfgB, setCfgB] = useState(() => {
    const c = newCfg(route.params.dev || 'pc');
    return { ...c, from: isoDate(daysAgo(59)), to: isoDate(daysAgo(30)) };
  });
  const [hl, setHl] = useState(null);
  const [share, setShare] = useState(false);
  const [sync, setSync] = useState(true);
  const group = useRef({ panels: new Map(), lock: false });

  const pages = useAsync(() => rpc('hm_pages', { p_site: site.id, ...rangeToTs(isoDate(daysAgo(89)), isoDate(new Date())), p_device: null }), [site.id]);
  const cvTags = useAsync(() => q(supabase.from('hm_cv_tags').select('id,name').eq('site_id', site.id)), [site.id]);

  useEffect(() => {
    if (!url && pages.data?.length) setUrl(pages.data[0].url);
  }, [pages.data, url]);
  useEffect(() => {
    if (route.params.url && route.params.url !== url) setUrl(route.params.url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params.url]);

  const A = useHeatmap(site.id, url, cfgA);
  const B = useHeatmap(site.id, layout === 'compare' ? url : null, cfgB);

  if (pages.loading) return <Loading />;
  if (!pages.data?.length && !url) {
    return <Empty title="まだ計測データがありません">「設定・タグ」から計測タグをサイトに設置すると、数分でここにページが表示されます。</Empty>;
  }

  const pageOptions = (pages.data || []).map((p) => ({ value: p.url, label: `${shortUrl(p.url)}（${fmt(p.pv)}PV）` }));
  if (url && !pageOptions.find((o) => o.value === url)) pageOptions.unshift({ value: url, label: shortUrl(url) });

  const syncGroup = sync ? group.current : null;

  return (
    <div className="hm-page">
      <div className="hm-toolbar">
        <Field label="ページ">
          <Select value={url} onChange={(v) => { setUrl(v); go(route.path, { url: v, dev: cfgA.dev }); }} options={pageOptions} className="url-select" />
        </Field>
        <Tabs value={layout} onChange={setLayout} items={[
          { value: 'single', label: '単体表示' },
          { value: 'triple', label: '3種同時表示' },
          { value: 'compare', label: '並列比較' },
        ]} />
        {layout !== 'triple' && (
          <Tabs value={mode} onChange={setMode} items={['click', 'scroll', 'attention', 'none'].map((m) => ({ value: m, label: MODE_LABEL[m] }))} />
        )}
        <div className="spacer" />
        {layout !== 'single' && (
          <label className="check"><input type="checkbox" checked={sync} onChange={(e) => setSync(e.target.checked)} /><span>スクロール連動</span></label>
        )}
        <Btn onClick={() => setShare(true)} disabled={!url}>外部共有</Btn>
        <a className="btn btn-default" href={url} target="_blank" rel="noreferrer">実ページ</a>
      </div>

      <ErrorBox error={A.error || B.error} />

      {layout === 'single' && (
        <div className="hm-single">
          <div className="hm-main">
            {A.loading && <div className="hm-loading"><Loading text="集計中…" /></div>}
            {!A.snapshot && !A.loading ? (
              <Empty title="このページ・デバイスのデザインはまだ保存されていません">計測タグが設置されたページを一度表示すると、自動でデザインが保存されます。</Empty>
            ) : (
              <HeatmapPanel id="a" snapshot={A.snapshot} data={A.data} mode={mode} device={cfgA.dev} highlightSel={hl} />
            )}
          </div>
          <aside className="hm-side">
            <Summary data={A.data} />
            <Card title="表示条件"><Controls cfg={cfgA} setCfg={setCfgA} cvTags={cvTags.data || []} sources={A.data?.sources || []} snapshots={A.snapshots} /></Card>
            {mode === 'click' && <Ranking data={A.data} onHover={setHl} url={url} />}
          </aside>
        </div>
      )}

      {layout === 'triple' && (
        <>
          <Card><Controls cfg={cfgA} setCfg={setCfgA} cvTags={cvTags.data || []} sources={A.data?.sources || []} snapshots={A.snapshots} compact /></Card>
          <Summary data={A.data} />
          <div className="hm-grid hm-grid-3">
            {['scroll', 'attention', 'click'].map((m) => (
              <HeatmapPanel key={m} id={m} label={MODE_LABEL[m]} snapshot={A.snapshot} data={A.data} mode={m} device={cfgA.dev} syncGroup={syncGroup} maxHeight={760} />
            ))}
          </div>
        </>
      )}

      {layout === 'compare' && (
        <div className="hm-grid hm-grid-2">
          {[['A', cfgA, setCfgA, A], ['B', cfgB, setCfgB, B]].map(([key, cfg, setCfg, H]) => (
            <div key={key} className="compare-col">
              <Card title={`比較${key}`}>
                <Controls cfg={cfg} setCfg={setCfg} cvTags={cvTags.data || []} sources={H.data?.sources || []} snapshots={H.snapshots} compact />
              </Card>
              <Summary data={H.data} />
              {H.loading && <Loading text="集計中…" />}
              <HeatmapPanel id={key} snapshot={H.snapshot} data={H.data} mode={mode} device={cfg.dev} syncGroup={syncGroup} maxHeight={820} />
            </div>
          ))}
        </div>
      )}

      {share && <ShareModal site={site} url={url} cfg={cfgA} hash={A.hash} mode={layout === 'single' ? mode : 'click'} onClose={() => setShare(false)} />}
    </div>
  );
}

// ログイン不要の共有ページ
export function SharePage({ token }) {
  const res = useAsync(() => rpc('hm_shared', { p_token: token }), [token]);
  const [mode, setMode] = useState(null);
  if (res.loading) return <div className="share-page"><Loading /></div>;
  if (res.error) return <div className="share-page"><Empty title="共有リンクが無効か、有効期限が切れています" /></div>;
  const { config, site, snapshot, data } = res.data;
  const m = mode || config.mode || 'click';
  return (
    <div className="share-page">
      <header className="share-head">
        <div>
          <div className="muted">{site} ／ {DEVICE_LABEL[config.device]}</div>
          <h2>{shortUrl(config.url)}</h2>
          <div className="muted">{new Date(config.from).toLocaleDateString('ja-JP')} 〜 {new Date(new Date(config.to) - 1).toLocaleDateString('ja-JP')}</div>
        </div>
        <Tabs value={m} onChange={setMode} items={['click', 'scroll', 'attention'].map((x) => ({ value: x, label: MODE_LABEL[x] }))} />
      </header>
      <Summary data={data} />
      {snapshot ? <HeatmapPanel id="share" snapshot={snapshot} data={data} mode={m} device={config.device} /> : <Empty title="デザインが保存されていません" />}
    </div>
  );
}
