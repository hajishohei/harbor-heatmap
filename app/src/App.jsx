import { useEffect, useState } from 'react';
import { supabase, rpc, q } from './lib/supabase';
import { useRoute, useAsync, go } from './lib/utils';
import { Empty, Loading } from './components/ui';
import Login from './pages/Login';
import Sites, { Members } from './pages/Sites';
import Dashboard from './pages/Dashboard';
import HeatmapPage, { SharePage } from './pages/Heatmap';
import Popups from './pages/Popups';
import PopupEditor from './pages/PopupEditor';
import CvTags from './pages/CvTags';
import Funnels from './pages/Funnels';
import SiteSettings from './pages/SiteSettings';

const SITE_TABS = [
  { key: 'dashboard', label: 'ダッシュボード' },
  { key: 'heatmap', label: 'ヒートマップ' },
  { key: 'popups', label: 'ポップアップ' },
  { key: 'cv', label: 'CV設定' },
  { key: 'funnels', label: 'ファネル分析' },
  { key: 'settings', label: '設定・タグ' },
];

function SiteLayout({ siteId, tab, route }) {
  const site = useAsync(async () => {
    const s = await q(supabase.from('hm_sites').select('*').eq('id', siteId).single());
    const d = new Date();
    const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
    const u = await q(supabase.from('hm_site_usage').select('pv').eq('site_id', siteId).eq('month', m));
    return { ...s, usage: u[0]?.pv || 0 };
  }, [siteId]);
  const sites = useAsync(() => q(supabase.from('hm_sites').select('id,name').order('created_at')), []);

  if (site.loading && !site.data) return <Loading />;
  if (site.error) return <Empty title="サイトが見つかりません" />;
  const s = site.data;
  const sub = route.parts[3];

  let body = null;
  if (tab === 'dashboard') body = <Dashboard site={s} />;
  else if (tab === 'heatmap') body = <HeatmapPage site={s} route={route} />;
  else if (tab === 'popups') body = sub ? <PopupEditor key={sub} site={s} popupId={sub} /> : <Popups site={s} />;
  else if (tab === 'cv') body = <CvTags site={s} />;
  else if (tab === 'funnels') body = <Funnels site={s} />;
  else if (tab === 'settings') body = <SiteSettings site={s} onChanged={site.reload} />;

  return (
    <div className="page page-wide">
      <div className="site-head">
        <select className="site-switch" value={siteId} onChange={(e) => go(`/site/${e.target.value}/${tab}`)}>
          {(sites.data || [{ id: s.id, name: s.name }]).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        <nav className="site-tabs">
          {SITE_TABS.map((t) => (
            <a key={t.key} href={`#/site/${siteId}/${t.key}`} className={tab === t.key ? 'on' : ''}>{t.label}</a>
          ))}
        </nav>
      </div>
      {body}
    </div>
  );
}

export default function App() {
  const route = useRoute();
  const [session, setSession] = useState(undefined);
  const [member, setMember] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) { setMember(null); return; }
    rpc('hm_is_member').then(setMember).catch(() => setMember(false));
  }, [session?.user?.id]);

  // 外部共有ページはログイン不要
  if (route.parts[0] === 'share') return <SharePage token={route.parts[1]} />;

  if (session === undefined) return <Loading />;
  if (!session) return <Login />;
  if (member === null) return <Loading />;
  if (!member) {
    return (
      <div className="login">
        <div className="login-card">
          <Empty title="このアカウントには利用権限がありません">
            {session.user.email} でログインしています。@harbor-live.com のアドレスを使うか、管理者にメンバー追加を依頼してください。
          </Empty>
          <button className="btn btn-default" onClick={() => supabase.auth.signOut()}>ログアウト</button>
        </div>
      </div>
    );
  }

  const [p0, p1, p2] = route.parts;
  let content;
  if (p0 === 'site' && p1) content = <SiteLayout siteId={p1} tab={p2 || 'dashboard'} route={route} />;
  else if (p0 === 'members') content = <Members />;
  else content = <Sites />;

  return (
    <div className="app">
      <header className="topbar">
        <a href="#/" className="brand"><span className="brand-mark" />HarboR Heatmap</a>
        <nav className="topnav">
          <a href="#/" className={!p0 || p0 === 'site' ? 'on' : ''}>サイト</a>
          <a href="#/members" className={p0 === 'members' ? 'on' : ''}>メンバー</a>
        </nav>
        <div className="spacer" />
        <span className="muted small">{session.user.email}</span>
        <button className="btn btn-ghost btn-sm" onClick={() => supabase.auth.signOut()}>ログアウト</button>
      </header>
      <main>{content}</main>
    </div>
  );
}
