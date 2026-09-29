import { useState } from 'react';
import { supabase, q } from '../lib/supabase';
import { useAsync, fmt, go } from '../lib/utils';
import { Btn, Card, Empty, ErrorBox, Field, Loading, Modal } from '../components/ui';

export default function Sites() {
  const sites = useAsync(async () => {
    const list = await q(supabase.from('hm_sites').select('*').order('created_at'));
    const month = new Date();
    const m = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}-01`;
    const usage = await q(supabase.from('hm_site_usage').select('site_id,pv').eq('month', m));
    return list.map((s) => ({ ...s, usage: usage.find((u) => u.site_id === s.id)?.pv || 0 }));
  }, []);
  const [creating, setCreating] = useState(false);
  const [f, setF] = useState({ name: '', domain: '' });
  const [err, setErr] = useState(null);

  const create = async () => {
    setErr(null);
    try {
      if (!f.name.trim()) throw new Error('サイト名を入力してください');
      const domain = f.domain.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();
      const row = await q(supabase.from('hm_sites').insert({ name: f.name.trim(), domains: domain ? [domain] : [] }).select().single());
      go(`/site/${row.id}/settings`);
    } catch (e) { setErr(e); }
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1>サイト</h1>
        <Btn kind="primary" onClick={() => setCreating(true)}>＋ サイトを追加</Btn>
      </div>
      <ErrorBox error={sites.error} />
      {sites.loading ? <Loading /> : !sites.data?.length ? (
        <Card><Empty title="まだサイトがありません">「サイトを追加」から計測したいサイトを登録すると、計測タグが発行されます。</Empty></Card>
      ) : (
        <div className="site-grid">
          {sites.data.map((s) => (
            <button key={s.id} className="site-card" onClick={() => go(`/site/${s.id}/dashboard`)}>
              <div className="site-name">{s.name}</div>
              <div className="site-domain">{(s.domains || []).join(', ') || 'ドメイン未設定'}</div>
              <div className="site-usage">
                <span>今月 {fmt(s.usage)} PV</span>
                <div className="mini-bar"><i style={{ width: Math.min(100, (s.usage / s.pv_limit) * 100) + '%' }} /></div>
              </div>
            </button>
          ))}
        </div>
      )}
      {creating && (
        <Modal title="サイトを追加" onClose={() => setCreating(false)} footer={<><Btn onClick={() => setCreating(false)}>キャンセル</Btn><Btn kind="primary" onClick={create}>作成してタグを発行</Btn></>}>
          <Field label="サイト名"><input autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="例：LIVE BASE 採用LP" /></Field>
          <Field label="ドメイン" hint="計測を許可するドメイン。あとから複数追加できます。"><input value={f.domain} onChange={(e) => setF({ ...f, domain: e.target.value })} placeholder="example.com" /></Field>
          <ErrorBox error={err} />
        </Modal>
      )}
    </div>
  );
}

export function Members() {
  const list = useAsync(() => q(supabase.from('hm_allowed_emails').select('*').order('created_at')), []);
  const [email, setEmail] = useState('');
  const [err, setErr] = useState(null);
  const add = async () => {
    setErr(null);
    try {
      if (!/^[^@\s]+@[^@\s]+$/.test(email.trim())) throw new Error('メールアドレスを入力してください');
      await q(supabase.from('hm_allowed_emails').insert({ email: email.trim().toLowerCase() }));
      setEmail('');
      list.reload();
    } catch (e) { setErr(e); }
  };
  const remove = async (e) => {
    if (!confirm(`${e} の利用権限を削除しますか？`)) return;
    await q(supabase.from('hm_allowed_emails').delete().eq('email', e));
    list.reload();
  };
  return (
    <div className="page">
      <div className="page-head"><h1>メンバー</h1></div>
      <Card title="利用できる人">
        <p><b>@harbor-live.com</b> のメールアドレスでアカウントを作成した人は、自動的に利用できます。</p>
        <p className="muted">社外の人（外部パートナーなど）に使ってもらう場合は、下にメールアドレスを追加してください。追加後、その人がそのアドレスでアカウントを作成するとログインできます。</p>
        <div className="row gap-8">
          <input className="grow" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="partner@example.com" />
          <Btn kind="primary" onClick={add}>追加</Btn>
        </div>
        <ErrorBox error={err || list.error} />
        {list.data?.length > 0 && (
          <table className="table mt-12">
            <tbody>
              {list.data.map((r) => (
                <tr key={r.email}><td>{r.email}</td><td className="right"><Btn size="sm" kind="ghost" onClick={() => remove(r.email)}>削除</Btn></td></tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
