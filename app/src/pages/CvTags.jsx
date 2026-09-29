import { useState } from 'react';
import { supabase, q } from '../lib/supabase';
import { useAsync, fmt, daysAgo } from '../lib/utils';
import { Btn, Card, Empty, ErrorBox, Field, Loading, Modal, Select, Toggle } from '../components/ui';

export const CV_TYPES = [
  { value: 'url', label: 'ページ表示（サンクスページ）', hint: '指定したURLのページが表示されたらCV。例：/thanks' },
  { value: 'line', label: 'LINE友だち追加', hint: 'line.me / lin.ee へのリンクのクリックをCVとして計測。特定のURLに絞る場合のみパターンを入力' },
  { value: 'asp', label: 'ASP（アフィリエイト）リンククリック', hint: 'A8.net・もしも・バリューコマース等の主要ASPのリンククリックを自動判定。特定のリンクに絞る場合のみパターンを入力' },
  { value: 'click_url', label: 'リンククリック（リンク先URL）', hint: 'リンク先URLが条件に一致するリンクのクリック。例：tel: / https://form.example.com' },
  { value: 'selector', label: '要素クリック（CSSセレクタ）', hint: 'CSSセレクタに一致する要素のクリック。例：#apply-button, .cta' },
];
const TYPE_LABEL = Object.fromEntries(CV_TYPES.map((t) => [t.value, t.label]));
const MATCH = [
  { value: 'contains', label: 'を含む' },
  { value: 'equals', label: 'と完全一致' },
  { value: 'prefix', label: 'で始まる' },
  { value: 'regex', label: '正規表現' },
];

function Editor({ site, tag, onClose, onSaved }) {
  const [f, setF] = useState(tag || { name: '', type: 'url', match: 'contains', pattern: '', enabled: true });
  const [err, setErr] = useState(null);
  const type = CV_TYPES.find((t) => t.value === f.type);
  const optional = f.type === 'line' || f.type === 'asp';
  const save = async () => {
    try {
      if (!f.name.trim()) throw new Error('CV名を入力してください');
      if (!optional && !f.pattern.trim()) throw new Error('条件を入力してください');
      const row = { site_id: site.id, name: f.name.trim(), type: f.type, match: f.type === 'selector' ? 'contains' : f.match, pattern: f.pattern.trim(), enabled: f.enabled };
      if (tag?.id) await q(supabase.from('hm_cv_tags').update(row).eq('id', tag.id));
      else await q(supabase.from('hm_cv_tags').insert(row));
      onSaved();
    } catch (e) { setErr(e); }
  };
  return (
    <Modal title={tag?.id ? 'CV設定を編集' : 'CV設定を追加'} onClose={onClose} footer={<><Btn onClick={onClose}>キャンセル</Btn><Btn kind="primary" onClick={save}>保存</Btn></>}>
      <Field label="CV名"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="例：お問い合わせ完了" /></Field>
      <Field label="計測方法" hint={type?.hint}>
        <Select value={f.type} onChange={(v) => setF({ ...f, type: v })} options={CV_TYPES} />
      </Field>
      <Field label={f.type === 'selector' ? 'CSSセレクタ' : optional ? '条件（任意）' : '条件'}>
        <div className="row gap-8">
          <input className="grow" value={f.pattern} onChange={(e) => setF({ ...f, pattern: e.target.value })}
            placeholder={f.type === 'selector' ? '#apply-button' : f.type === 'url' ? '/thanks' : 'https://'} />
          {f.type !== 'selector' && <Select value={f.match} onChange={(v) => setF({ ...f, match: v })} options={MATCH} />}
        </div>
      </Field>
      <Toggle checked={f.enabled} onChange={(v) => setF({ ...f, enabled: v })} label="有効" />
      <ErrorBox error={err} />
    </Modal>
  );
}

export default function CvTags({ site }) {
  const tags = useAsync(() => q(supabase.from('hm_cv_tags').select('*').eq('site_id', site.id).order('created_at')), [site.id]);
  const counts = useAsync(async () => {
    const rows = await q(supabase.from('hm_conversions').select('cv_tag_id').eq('site_id', site.id).gte('created_at', daysAgo(29).toISOString()).limit(20000));
    const m = {};
    rows.forEach((r) => { m[r.cv_tag_id] = (m[r.cv_tag_id] || 0) + 1; });
    return m;
  }, [site.id]);
  const [edit, setEdit] = useState(null);

  const remove = async (t) => {
    if (!confirm(`「${t.name}」を削除しますか？計測済みのCVデータも削除されます。`)) return;
    await q(supabase.from('hm_cv_tags').delete().eq('id', t.id));
    tags.reload();
  };

  return (
    <div className="stack">
      <Card title="CV計測の設定" actions={<Btn kind="primary" onClick={() => setEdit({})}>＋ CVを追加</Btn>} pad={false}>
        <ErrorBox error={tags.error} />
        {tags.loading ? <div className="card-body"><Loading /></div> : !tags.data?.length ? (
          <div className="card-body">
            <Empty title="CV設定がまだありません">サンクスページの表示、LINE友だち追加、ASPリンクのクリックなどをCVとして計測できます。設定するとヒートマップで「CVした訪問者／しなかった訪問者」を比較できます。</Empty>
          </div>
        ) : (
          <table className="table">
            <thead><tr><th>CV名</th><th>計測方法</th><th>条件</th><th className="num">直近30日</th><th>状態</th><th /></tr></thead>
            <tbody>
              {tags.data.map((t) => (
                <tr key={t.id}>
                  <td className="cell-title">{t.name}</td>
                  <td>{TYPE_LABEL[t.type]}</td>
                  <td className="mono">{t.pattern ? `${t.pattern} ${MATCH.find((m) => m.value === t.match)?.label || ''}` : '（自動判定）'}</td>
                  <td className="num">{fmt(counts.data?.[t.id] || 0)}</td>
                  <td>{t.enabled ? <span className="badge badge-on">有効</span> : <span className="badge">停止</span>}</td>
                  <td className="nowrap right">
                    <Btn size="sm" onClick={() => setEdit(t)}>編集</Btn>
                    <Btn size="sm" kind="ghost" onClick={() => remove(t)}>削除</Btn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Card title="タグから直接CVを送る（任意）">
        <p className="muted">フォーム送信完了など、ページ遷移がないCVは、完了時に次のJavaScriptを実行すると計測できます。</p>
        <pre className="code">{`window.hm && window.hm.cv('CV設定のID');`}</pre>
        {tags.data?.length > 0 && (
          <div className="id-list">{tags.data.map((t) => <div key={t.id}><span>{t.name}</span><code>{t.id}</code></div>)}</div>
        )}
      </Card>
      {edit && <Editor site={site} tag={edit.id ? edit : null} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); tags.reload(); }} />}
    </div>
  );
}
