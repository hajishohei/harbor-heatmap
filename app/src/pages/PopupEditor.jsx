import { useEffect, useState } from 'react';
import { supabase, q } from '../lib/supabase';
import { useAsync, go, uid } from '../lib/utils';
import { Btn, Card, Check, ErrorBox, Field, Loading, Select, Toggle } from '../components/ui';
import { KIND_LABEL } from './Popups';

const MATCH = [
  { value: 'contains', label: 'を含む' },
  { value: 'equals', label: 'と完全一致' },
  { value: 'prefix', label: 'で始まる' },
  { value: 'regex', label: '正規表現' },
];
const DAYS = ['日', '月', '火', '水', '木', '金', '土'];

function defaults(kind) {
  const base = {
    name: '', kind, status: 'paused', priority: 0,
    triggers: kind === 'bar' || kind === 'corner' ? { load: true, load_delay: 0 } : { exit: true, predict: true },
    conditions: { devices: ['pc', 'sp', 'tab'], visitor: 'all' },
    settings: { freq: 'session', optimize: 'ab', goal: 'click', pass_params: true, overlay_close: true, color: '#e8543f' },
    scenario: {},
  };
  if (kind === 'scenario') {
    const s1 = uid(), s2 = uid(), r1 = uid(), r2 = uid();
    base.scenario = {
      steps: [
        { id: s1, question: 'いま一番気になっていることは？', choices: [{ label: '価格', next: s2 }, { label: '効果', next: s2 }] },
        { id: s2, question: 'いつ頃から始めたいですか？', choices: [{ label: 'すぐに', result: r1 }, { label: 'まだ検討中', result: r2 }] },
      ],
      results: [
        { id: r1, title: 'まずは無料相談がおすすめです', text: '', link_url: '', button: '無料相談を予約する' },
        { id: r2, title: '資料で比較してみませんか？', text: '', link_url: '', button: '資料をダウンロード' },
      ],
    };
  }
  return base;
}

async function uploadImage(siteId, file) {
  const ext = (file.name.split('.').pop() || 'png').toLowerCase();
  const path = `${siteId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage.from('hm-creatives').upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw new Error(error.message);
  return supabase.storage.from('hm-creatives').getPublicUrl(path).data.publicUrl;
}

function ImageInput({ siteId, value, onChange }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  return (
    <div className="image-input">
      {value ? <img src={value} alt="" /> : <div className="image-ph">画像なし</div>}
      <div className="stack-sm grow">
        <input value={value || ''} onChange={(e) => onChange(e.target.value)} placeholder="画像URL（またはアップロード）" />
        <label className="btn btn-default btn-sm">
          {busy ? 'アップロード中…' : '画像をアップロード'}
          <input type="file" accept="image/*" hidden onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            setBusy(true); setErr(null);
            try { onChange(await uploadImage(siteId, f)); } catch (x) { setErr(x); }
            setBusy(false);
          }} />
        </label>
        <ErrorBox error={err} />
      </div>
    </div>
  );
}

function RuleList({ value = [], onChange, placeholder }) {
  return (
    <div className="stack-sm">
      {value.map((r, i) => (
        <div key={i} className="row gap-8">
          <input className="grow" value={r.pattern} placeholder={placeholder} onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, pattern: e.target.value } : x)))} />
          <Select value={r.match} onChange={(v) => onChange(value.map((x, j) => (j === i ? { ...x, match: v } : x)))} options={MATCH} />
          <button className="icon-btn" onClick={() => onChange(value.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      <div><Btn size="sm" onClick={() => onChange([...value, { match: 'contains', pattern: '' }])}>＋ 条件を追加</Btn></div>
    </div>
  );
}

function CreativeEditor({ siteId, list, setList, kind }) {
  const upd = (i, patch) => setList(list.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const add = () => setList([...list, { _new: true, name: String.fromCharCode(65 + list.length), type: 'image', image_url: '', html: '', link_url: '', alt: '', enabled: true }]);
  return (
    <div className="stack">
      {list.map((c, i) => (
        <div key={c.id || i} className={`creative ${c.enabled ? '' : 'disabled'}`}>
          <div className="creative-head">
            <input className="w-120" value={c.name} onChange={(e) => upd(i, { name: e.target.value })} />
            <Select value={c.type} onChange={(v) => upd(i, { type: v })} options={[{ value: 'image', label: '画像バナー' }, { value: 'html', label: 'HTML' }]} />
            <Toggle checked={c.enabled} onChange={(v) => upd(i, { enabled: v })} label="配信" />
            <div className="spacer" />
            <button className="icon-btn" onClick={() => setList(list.filter((_, j) => j !== i))} aria-label="削除">×</button>
          </div>
          {c.type === 'image' ? (
            <>
              <ImageInput siteId={siteId} value={c.image_url} onChange={(v) => upd(i, { image_url: v })} />
              <Field label="代替テキスト"><input value={c.alt || ''} onChange={(e) => upd(i, { alt: e.target.value })} /></Field>
            </>
          ) : (
            <Field label="HTML" hint="リンク（aタグ）のクリックはクリック数として計測されます。">
              <textarea rows={6} className="mono" value={c.html || ''} onChange={(e) => upd(i, { html: e.target.value })}
                placeholder={'<div style="padding:24px;text-align:center">\n  <p>今だけ初回50%OFF</p>\n  <a href="https://example.com">詳しく見る</a>\n</div>'} />
            </Field>
          )}
          <Field label="リンク先URL" hint="電話発信は tel:0300000000、LINEは友だち追加URLを入力"><input value={c.link_url || ''} onChange={(e) => upd(i, { link_url: e.target.value })} placeholder="https://" /></Field>
        </div>
      ))}
      <div><Btn onClick={add}>＋ クリエイティブを追加{kind !== 'scenario' && list.length >= 1 ? '（ABテスト）' : ''}</Btn></div>
    </div>
  );
}

function ScenarioEditor({ siteId, sc, setSc }) {
  const steps = sc.steps || [];
  const results = sc.results || [];
  const setSteps = (s) => setSc({ ...sc, steps: s });
  const setResults = (r) => setSc({ ...sc, results: r });
  const updStep = (i, patch) => setSteps(steps.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const updChoice = (i, k, patch) => updStep(i, { choices: steps[i].choices.map((c, j) => (j === k ? { ...c, ...patch } : c)) });
  const nextOptions = [
    ...steps.map((s, i) => ({ value: 'step:' + s.id, label: `→ Q${i + 1}へ` })),
    ...results.map((r, i) => ({ value: 'result:' + r.id, label: `→ 結果${i + 1}：${r.title || ''}` })),
  ];
  return (
    <div className="stack">
      <p className="muted">質問に答えてもらい、回答に合わせた結果（おすすめ・特典）を表示します。最初の質問から表示されます。</p>
      {steps.map((s, i) => (
        <div key={s.id} className="creative">
          <div className="creative-head"><b>Q{i + 1}</b><div className="spacer" /><button className="icon-btn" onClick={() => setSteps(steps.filter((_, j) => j !== i))}>×</button></div>
          <Field label="質問文"><input value={s.question} onChange={(e) => updStep(i, { question: e.target.value })} /></Field>
          <Field label="画像（任意）"><ImageInput siteId={siteId} value={s.image_url} onChange={(v) => updStep(i, { image_url: v })} /></Field>
          <Field label="選択肢">
            <div className="stack-sm">
              {(s.choices || []).map((c, k) => (
                <div key={k} className="row gap-8">
                  <input className="grow" value={c.label} onChange={(e) => updChoice(i, k, { label: e.target.value })} placeholder="選択肢" />
                  <Select value={c.result ? 'result:' + c.result : c.next ? 'step:' + c.next : ''}
                    onChange={(v) => {
                      const [t, id] = v.split(':');
                      updChoice(i, k, t === 'result' ? { result: id, next: null } : { next: id, result: null });
                    }}
                    options={[{ value: '', label: '次へ（未設定）' }, ...nextOptions.filter((o) => o.value !== 'step:' + s.id)]} />
                  <button className="icon-btn" onClick={() => updStep(i, { choices: s.choices.filter((_, j) => j !== k) })}>×</button>
                </div>
              ))}
              <div><Btn size="sm" onClick={() => updStep(i, { choices: [...(s.choices || []), { label: '' }] })}>＋ 選択肢</Btn></div>
            </div>
          </Field>
        </div>
      ))}
      <div><Btn onClick={() => setSteps([...steps, { id: uid(), question: '', choices: [{ label: '' }, { label: '' }] }])}>＋ 質問を追加</Btn></div>
      <h4>結果</h4>
      {results.map((r, i) => (
        <div key={r.id} className="creative">
          <div className="creative-head"><b>結果{i + 1}</b><div className="spacer" /><button className="icon-btn" onClick={() => setResults(results.filter((_, j) => j !== i))}>×</button></div>
          <Field label="見出し"><input value={r.title} onChange={(e) => setResults(results.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} /></Field>
          <Field label="本文"><textarea rows={3} value={r.text || ''} onChange={(e) => setResults(results.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} /></Field>
          <Field label="画像（任意）"><ImageInput siteId={siteId} value={r.image_url} onChange={(v) => setResults(results.map((x, j) => (j === i ? { ...x, image_url: v } : x)))} /></Field>
          <div className="grid-2">
            <Field label="ボタンの文言"><input value={r.button || ''} onChange={(e) => setResults(results.map((x, j) => (j === i ? { ...x, button: e.target.value } : x)))} /></Field>
            <Field label="ボタンのリンク先"><input value={r.link_url || ''} onChange={(e) => setResults(results.map((x, j) => (j === i ? { ...x, link_url: e.target.value } : x)))} placeholder="https://" /></Field>
          </div>
        </div>
      ))}
      <div><Btn onClick={() => setResults([...results, { id: uid(), title: '', text: '', link_url: '', button: '詳しく見る' }])}>＋ 結果を追加</Btn></div>
    </div>
  );
}

// エディタ内の簡易プレビュー
function Preview({ p, creatives, device }) {
  const cr = creatives.find((c) => c.enabled) || creatives[0];
  const s = p.settings || {};
  const w = device === 'sp' ? 340 : 560;
  const body = (() => {
    if (p.kind === 'scenario') {
      const st = p.scenario?.steps?.[0];
      if (!st) return <div className="pv-empty">質問を追加してください</div>;
      return (
        <div className="pv-sc" style={{ '--c': s.color }}>
          <small>Q1</small>
          {st.image_url && <img src={st.image_url} alt="" />}
          <h4>{st.question}</h4>
          {(st.choices || []).map((c, i) => <div key={i} className="pv-ch">{c.label || '選択肢'}</div>)}
        </div>
      );
    }
    if (!cr) return <div className="pv-empty">クリエイティブを追加してください</div>;
    if (cr.type === 'html') return <div className="pv-html" dangerouslySetInnerHTML={{ __html: cr.html || '' }} />;
    return cr.image_url ? <img src={cr.image_url} alt="" /> : <div className="pv-empty">画像を設定してください</div>;
  })();
  return (
    <div className={`pv pv-${device}`} style={{ width: w }}>
      <div className="pv-page">{Array.from({ length: 8 }).map((_, i) => <i key={i} />)}</div>
      {(p.kind === 'modal' || p.kind === 'scenario') && (
        <div className="pv-ov"><div className="pv-box" style={{ maxWidth: Math.min(w - 30, s.width || 480) }}><span className="pv-x">×</span>{body}</div></div>
      )}
      {p.kind === 'bar' && <div className="pv-bar"><span className="pv-x">×</span>{body}</div>}
      {p.kind === 'corner' && <div className="pv-corner" style={{ width: Math.min(s.width || 240, w * 0.6) }}><span className="pv-x">×</span>{body}</div>}
    </div>
  );
}

export default function PopupEditor({ site, popupId }) {
  const isNew = popupId === 'new';
  const loaded = useAsync(async () => {
    const others = await q(supabase.from('hm_popups').select('id,name,kind').eq('site_id', site.id));
    if (isNew) return { popup: null, creatives: [], others };
    const popup = await q(supabase.from('hm_popups').select('*').eq('id', popupId).single());
    const creatives = await q(supabase.from('hm_creatives').select('*').eq('popup_id', popupId).order('created_at'));
    return { popup, creatives, others };
  }, [popupId]);

  const [p, setP] = useState(null);
  const [crs, setCrs] = useState([]);
  const [removed, setRemoved] = useState([]);
  const [err, setErr] = useState(null);
  const [saving, setSaving] = useState(false);
  const [pvDevice, setPvDevice] = useState('pc');
  const [previewUrl, setPreviewUrl] = useState(site.domains?.[0] ? `https://${site.domains[0]}/` : '');

  useEffect(() => {
    if (!loaded.data) return;
    setP(loaded.data.popup || { ...defaults('modal'), name: '新しいポップアップ' });
    setCrs(loaded.data.creatives.length ? loaded.data.creatives : [{ _new: true, name: 'A', type: 'image', image_url: '', html: '', link_url: '', alt: '', enabled: true }]);
  }, [loaded.data]);

  if (loaded.loading || !p) return <Loading />;
  if (loaded.error) return <ErrorBox error={loaded.error} />;

  const set = (patch) => setP({ ...p, ...patch });
  const setT = (patch) => set({ triggers: { ...p.triggers, ...patch } });
  const setC = (patch) => set({ conditions: { ...p.conditions, ...patch } });
  const setS = (patch) => set({ settings: { ...p.settings, ...patch } });
  const t = p.triggers || {};
  const c = p.conditions || {};
  const s = p.settings || {};

  const setCrsTracked = (next) => {
    const ids = new Set(next.filter((x) => x.id).map((x) => x.id));
    setRemoved([...removed, ...crs.filter((x) => x.id && !ids.has(x.id)).map((x) => x.id)]);
    setCrs(next);
  };

  const changeKind = (kind) => {
    const d = defaults(kind);
    setP({ ...p, kind, triggers: d.triggers, scenario: kind === 'scenario' && !p.scenario?.steps ? d.scenario : p.scenario });
  };

  const save = async (activate) => {
    setSaving(true); setErr(null);
    try {
      if (!p.name.trim()) throw new Error('名前を入力してください');
      const row = {
        site_id: site.id, name: p.name.trim(), kind: p.kind, priority: Number(p.priority) || 0,
        status: activate === undefined ? p.status : activate ? 'active' : 'paused',
        triggers: p.triggers, conditions: p.conditions, settings: p.settings, scenario: p.scenario || {},
        updated_at: new Date().toISOString(),
      };
      let id = p.id;
      if (id) await q(supabase.from('hm_popups').update(row).eq('id', id));
      else id = (await q(supabase.from('hm_popups').insert(row).select().single())).id;
      if (removed.length) await q(supabase.from('hm_creatives').delete().in('id', removed));
      if (p.kind !== 'scenario') {
        for (const cr of crs) {
          const r = { popup_id: id, site_id: site.id, name: cr.name || 'A', type: cr.type, image_url: cr.image_url || null, html: cr.html || null, link_url: cr.link_url || null, alt: cr.alt || null, enabled: cr.enabled };
          if (cr.id) await q(supabase.from('hm_creatives').update(r).eq('id', cr.id));
          else await q(supabase.from('hm_creatives').insert(r));
        }
      }
      go(`/site/${site.id}/popups`);
    } catch (e) { setErr(e); }
    setSaving(false);
  };

  const cornerTargets = (loaded.data.others || []).filter((o) => o.id !== p.id && (o.kind === 'modal' || o.kind === 'scenario'));

  return (
    <div className="editor">
      <div className="editor-main stack">
        <Card title="基本設定">
          <div className="grid-2">
            <Field label="名前"><input value={p.name} onChange={(e) => set({ name: e.target.value })} /></Field>
            <Field label="種類"><Select value={p.kind} onChange={changeKind} options={Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label }))} /></Field>
          </div>
          <Field label="優先度" hint="同じタイミングで複数の表示条件を満たしたとき、数字が大きいものを優先します。">
            <input type="number" className="w-120" value={p.priority} onChange={(e) => set({ priority: e.target.value })} />
          </Field>
        </Card>

        <Card title={p.kind === 'scenario' ? 'シナリオ' : 'クリエイティブ'}>
          {p.kind === 'scenario' ? <ScenarioEditor siteId={site.id} sc={p.scenario || {}} setSc={(sc) => set({ scenario: sc })} /> : (
            <>
              <CreativeEditor siteId={site.id} list={crs} setList={setCrsTracked} kind={p.kind} />
              {crs.length > 1 && (
                <div className="subbox">
                  <div className="grid-2">
                    <Field label="ABテストの配信方法">
                      <Select value={s.optimize || 'ab'} onChange={(v) => setS({ optimize: v })} options={[
                        { value: 'ab', label: '均等に配信（ABテスト）' },
                        { value: 'auto', label: '自動最適化（成果の良いものに寄せる）' },
                      ]} />
                    </Field>
                    <Field label="最適化の指標">
                      <Select value={s.goal || 'click'} onChange={(v) => setS({ goal: v })} options={[{ value: 'click', label: 'クリック率（CTR）' }, { value: 'cv', label: 'CV率（CTVR）' }]} />
                    </Field>
                  </div>
                  <p className="muted small">自動最適化は、直近30日の実績をもとに成果の良いクリエイティブへ配信を自動で寄せます（Thompson Sampling）。実績が少ないうちは均等に近い配分になります。</p>
                </div>
              )}
            </>
          )}
        </Card>

        <Card title="表示タイミング（トリガー）">
          <p className="muted small">いずれかの条件を満たしたときに表示します。</p>
          <div className="trigger-grid">
            <Check checked={t.exit} onChange={(v) => setT({ exit: v })} label="離脱しそうなとき（PC：カーソルが画面外へ／上方向に素早く移動）" />
            <Check checked={t.predict} onChange={(v) => setT({ predict: v })} label="AIスマホ離脱予測（滞在時間・スクロール・操作の止まり・上方向への高速スクロール・端スワイプから判定）" />
            <div className="row gap-8"><Check checked={t.load} onChange={(v) => setT({ load: v })} label="ページ表示時" />{t.load && <><input type="number" min="0" className="w-80" value={t.load_delay || 0} onChange={(e) => setT({ load_delay: Number(e.target.value) })} /><span>秒後</span></>}</div>
            <div className="row gap-8"><Check checked={!!t.time} onChange={(v) => setT({ time: v ? 15 : null })} label="閲覧時間" />{!!t.time && <><input type="number" min="1" className="w-80" value={t.time} onChange={(e) => setT({ time: Number(e.target.value) })} /><span>秒経過</span></>}</div>
            <div className="row gap-8"><Check checked={!!t.scroll} onChange={(v) => setT({ scroll: v ? 50 : null })} label="スクロール" />{!!t.scroll && <><input type="number" min="1" max="100" className="w-80" value={t.scroll} onChange={(e) => setT({ scroll: Number(e.target.value) })} /><span>%到達</span></>}</div>
            <Check checked={t.reverse_top} onChange={(v) => setT({ reverse_top: v })} label="下までスクロールした後、最上部まで戻ったとき（逆スクロール）" />
            <Check checked={t.return_page} onChange={(v) => setT({ return_page: v })} label="別タブから戻ってきたとき（ウェルカムバック）" />
            <Check checked={t.return_visit} onChange={(v) => setT({ return_visit: v })} label="リピート訪問のとき（ページ表示時）" />
            <div className="row gap-8"><Check checked={!!t.click_selector} onChange={(v) => setT({ click_selector: v ? '.hm-open' : null })} label="特定の要素をクリックしたとき" />{!!t.click_selector && <input className="grow mono" value={t.click_selector} onChange={(e) => setT({ click_selector: e.target.value })} placeholder="CSSセレクタ" />}</div>
          </div>
          {p.kind === 'corner' && (
            <Field label="右下バナーをクリックしたときの動作" hint="「リンク先へ移動」以外を選ぶと、バナークリックで選んだポップアップを画面中央に表示します。">
              <Select value={s.open_popup || ''} onChange={(v) => setS({ open_popup: v || null })}
                options={[{ value: '', label: 'リンク先へ移動' }, ...cornerTargets.map((o) => ({ value: o.id, label: `「${o.name}」を表示` }))]} />
            </Field>
          )}
        </Card>

        <Card title="表示条件">
          <Field label="デバイス">
            <div className="row gap-12">
              {[['pc', 'PC'], ['sp', 'スマホ'], ['tab', 'タブレット']].map(([k, l]) => (
                <Check key={k} checked={(c.devices || []).includes(k)} label={l}
                  onChange={(v) => setC({ devices: v ? [...(c.devices || []), k] : (c.devices || []).filter((x) => x !== k) })} />
              ))}
            </div>
          </Field>
          <div className="grid-2">
            <Field label="配信期間"><div className="row gap-4"><input type="date" value={c.start || ''} onChange={(e) => setC({ start: e.target.value || null })} /><span>〜</span><input type="date" value={c.end || ''} onChange={(e) => setC({ end: e.target.value || null })} /></div></Field>
            <Field label="時間帯"><div className="row gap-4"><input type="time" value={c.time_from || ''} onChange={(e) => setC({ time_from: e.target.value || null })} /><span>〜</span><input type="time" value={c.time_to || ''} onChange={(e) => setC({ time_to: e.target.value || null })} /></div></Field>
          </div>
          <Field label="曜日" hint="未選択のときは毎日表示します。">
            <div className="row gap-8">
              {DAYS.map((d, i) => (
                <Check key={i} checked={(c.days || []).includes(i)} label={d}
                  onChange={(v) => setC({ days: v ? [...(c.days || []), i] : (c.days || []).filter((x) => x !== i) })} />
              ))}
            </div>
          </Field>
          <Field label="表示するページ（URL）" hint="未設定のときはタグを設置した全ページで表示します。">
            <RuleList value={c.url_include || []} onChange={(v) => setC({ url_include: v })} placeholder="/lp" />
          </Field>
          <Field label="表示しないページ（URL）"><RuleList value={c.url_exclude || []} onChange={(v) => setC({ url_exclude: v })} placeholder="/thanks" /></Field>
          <div className="grid-2">
            <Field label="流入元" hint="カンマ区切り。utm_source または参照元ドメインに含まれる文字で判定（例：google, instagram）">
              <input value={(c.sources || []).join(', ')} onChange={(e) => setC({ sources: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} />
            </Field>
            <Field label="訪問者">
              <Select value={c.visitor || 'all'} onChange={(v) => setC({ visitor: v })} options={[{ value: 'all', label: 'すべて' }, { value: 'new', label: '新規のみ' }, { value: 'return', label: 'リピーターのみ' }]} />
            </Field>
          </div>
          <Field label="表示頻度">
            <Select value={s.freq || 'session'} onChange={(v) => setS({ freq: v })} options={[
              { value: 'session', label: '1セッションに1回' },
              { value: 'day', label: '1日1回' },
              { value: 'visitor', label: '訪問者ごとに1回だけ' },
              { value: 'always', label: 'ページ表示ごと' },
            ]} />
          </Field>
        </Card>

        <Card title="表示オプション">
          <div className="grid-2">
            <Field label="幅（px）" hint="画面中央・右下の場合"><input type="number" value={s.width || ''} placeholder={p.kind === 'corner' ? '240' : '480'} onChange={(e) => setS({ width: e.target.value ? Number(e.target.value) : null })} /></Field>
            <Field label="テーマカラー" hint="シナリオのボタン色など"><input type="color" value={s.color || '#e8543f'} onChange={(e) => setS({ color: e.target.value })} /></Field>
          </div>
          <div className="stack-sm">
            <Check checked={s.pass_params} onChange={(v) => setS({ pass_params: v })} label="URLパラメータを引き継ぐ（utm_source などをリンク先に付与）" />
            <Check checked={s.new_tab} onChange={(v) => setS({ new_tab: v })} label="リンクを新しいタブで開く" />
            {(p.kind === 'modal' || p.kind === 'scenario') && <Check checked={s.overlay_close !== false} onChange={(v) => setS({ overlay_close: v })} label="背景クリックで閉じる" />}
          </div>
        </Card>
        <ErrorBox error={err} />
      </div>

      <aside className="editor-side">
        <div className="sticky stack">
          <Card title="プレビュー" actions={<div className="seg"><button className={pvDevice === 'pc' ? 'on' : ''} onClick={() => setPvDevice('pc')}>PC</button><button className={pvDevice === 'sp' ? 'on' : ''} onClick={() => setPvDevice('sp')}>SP</button></div>}>
            <Preview p={p} creatives={crs} device={pvDevice} />
          </Card>
          <Card title="実サイトで確認">
            <p className="muted small">保存後、タグを設置したページのURLに <code>?hm_preview=ID</code> を付けて開くと、条件に関係なく表示できます（計測はされません）。</p>
            <div className="row gap-8">
              <input className="grow" value={previewUrl} onChange={(e) => setPreviewUrl(e.target.value)} placeholder="https://" />
              <Btn disabled={!p.id || !previewUrl} onClick={() => {
                const u = new URL(previewUrl);
                u.searchParams.set('hm_preview', p.id);
                window.open(u.toString(), '_blank');
              }}>開く</Btn>
            </div>
          </Card>
          <div className="row gap-8">
            <Btn onClick={() => go(`/site/${site.id}/popups`)}>戻る</Btn>
            <div className="spacer" />
            <Btn onClick={() => save()} disabled={saving}>保存</Btn>
            <Btn kind="primary" onClick={() => save(true)} disabled={saving}>保存して配信開始</Btn>
          </div>
        </div>
      </aside>
    </div>
  );
}
