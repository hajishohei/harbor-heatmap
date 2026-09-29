import { useState } from 'react';
import { supabase, rpc, q } from '../lib/supabase';
import { useAsync, defaultRange, rangeToTs, fmt, pct } from '../lib/utils';
import { Btn, Card, Empty, ErrorBox, Field, Loading, Modal, Select } from '../components/ui';

const MATCH = [
  { value: 'contains', label: 'を含む' },
  { value: 'equals', label: 'と完全一致' },
  { value: 'prefix', label: 'で始まる' },
  { value: 'regex', label: '正規表現' },
];

function Editor({ site, funnel, onClose, onSaved }) {
  const [name, setName] = useState(funnel?.name || '');
  const [steps, setSteps] = useState(funnel?.steps?.length ? funnel.steps : [
    { name: 'LP', match: 'contains', pattern: '' },
    { name: '申込フォーム', match: 'contains', pattern: '' },
    { name: '完了', match: 'contains', pattern: '' },
  ]);
  const [err, setErr] = useState(null);
  const upd = (i, patch) => setSteps(steps.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const move = (i, d) => {
    const n = [...steps];
    const [x] = n.splice(i, 1);
    n.splice(i + d, 0, x);
    setSteps(n);
  };
  const save = async () => {
    try {
      if (!name.trim()) throw new Error('ファネル名を入力してください');
      const clean = steps.filter((s) => s.pattern.trim());
      if (clean.length < 2) throw new Error('ステップは2つ以上必要です');
      const row = { site_id: site.id, name: name.trim(), steps: clean };
      if (funnel?.id) await q(supabase.from('hm_funnels').update(row).eq('id', funnel.id));
      else await q(supabase.from('hm_funnels').insert(row));
      onSaved();
    } catch (e) { setErr(e); }
  };
  return (
    <Modal wide title={funnel?.id ? 'ファネルを編集' : 'ファネルを作成'} onClose={onClose} footer={<><Btn onClick={onClose}>キャンセル</Btn><Btn kind="primary" onClick={save}>保存</Btn></>}>
      <Field label="ファネル名"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="例：LP→申込完了" /></Field>
      <p className="muted">同じセッション内で、上から順にページを通過した人数を集計します。URLの条件はパス（例：/form）で指定できます。</p>
      {steps.map((s, i) => (
        <div key={i} className="step-row">
          <span className="step-no">{i + 1}</span>
          <input value={s.name} onChange={(e) => upd(i, { name: e.target.value })} placeholder="ステップ名" className="w-160" />
          <input value={s.pattern} onChange={(e) => upd(i, { pattern: e.target.value })} placeholder="/lp" className="grow" />
          <Select value={s.match} onChange={(v) => upd(i, { match: v })} options={MATCH} />
          <button className="icon-btn" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
          <button className="icon-btn" disabled={i === steps.length - 1} onClick={() => move(i, 1)}>↓</button>
          <button className="icon-btn" onClick={() => setSteps(steps.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      <Btn size="sm" onClick={() => setSteps([...steps, { name: '', match: 'contains', pattern: '' }])}>＋ ステップを追加</Btn>
      <ErrorBox error={err} />
    </Modal>
  );
}

function Report({ funnel, range, device }) {
  const r = useAsync(() => rpc('hm_funnel_report', { p_funnel: funnel.id, ...rangeToTs(range.from, range.to), p_device: device || null }), [funnel.id, range.from, range.to, device]);
  if (r.loading) return <Loading />;
  if (r.error) return <ErrorBox error={r.error} />;
  const rows = r.data || [];
  const first = rows[0]?.sessions || 0;
  return (
    <div className="funnel">
      {rows.map((s, i) => {
        const prev = i ? rows[i - 1].sessions : s.sessions;
        const w = first ? Math.max(2, (s.sessions / first) * 100) : 0;
        return (
          <div key={s.step} className="funnel-row">
            <div className="funnel-label"><b>{s.step}. {s.name}</b></div>
            <div className="funnel-bar"><div style={{ width: w + '%' }} /><span>{fmt(s.sessions)}</span></div>
            <div className="funnel-rate">
              <div>全体比 <b>{pct(s.sessions, first)}</b></div>
              {i > 0 && <div className="muted">前ステップから {pct(s.sessions, prev)}（離脱 {fmt(prev - s.sessions)}）</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function Funnels({ site }) {
  const list = useAsync(() => q(supabase.from('hm_funnels').select('*').eq('site_id', site.id).order('created_at')), [site.id]);
  const [edit, setEdit] = useState(null);
  const [range, setRange] = useState(defaultRange(30));
  const [device, setDevice] = useState('');
  const remove = async (f) => {
    if (!confirm(`「${f.name}」を削除しますか？`)) return;
    await q(supabase.from('hm_funnels').delete().eq('id', f.id));
    list.reload();
  };
  return (
    <div className="stack">
      <div className="row gap-8 wrap">
        <input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
        <span className="muted">〜</span>
        <input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
        <Select value={device} onChange={setDevice} options={[{ value: '', label: '全デバイス' }, { value: 'pc', label: 'PC' }, { value: 'sp', label: 'スマホ' }, { value: 'tab', label: 'タブレット' }]} />
        <div className="spacer" />
        <Btn kind="primary" onClick={() => setEdit({})}>＋ ファネルを作成</Btn>
      </div>
      <ErrorBox error={list.error} />
      {list.loading ? <Loading /> : !list.data?.length ? (
        <Card><Empty title="ファネルがまだありません">LP → フォーム → 完了のように、ページの通過順を設定すると、各ステップの到達数と離脱数を確認できます。</Empty></Card>
      ) : list.data.map((f) => (
        <Card key={f.id} title={f.name} actions={<><Btn size="sm" onClick={() => setEdit(f)}>編集</Btn><Btn size="sm" kind="ghost" onClick={() => remove(f)}>削除</Btn></>}>
          <Report funnel={f} range={range} device={device} />
        </Card>
      ))}
      {edit && <Editor site={site} funnel={edit.id ? edit : null} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); list.reload(); }} />}
    </div>
  );
}
