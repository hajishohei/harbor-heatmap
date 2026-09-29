import { useState } from 'react';
import { supabase, q } from '../lib/supabase';
import { fmt, go } from '../lib/utils';
import { Btn, Card, Copy, ErrorBox, Field } from '../components/ui';

export function tagSnippet(site) {
  return `<script async src="${location.origin}/t.js" data-key="${site.site_key}"></script>`;
}

export default function SiteSettings({ site, onChanged }) {
  const [f, setF] = useState({
    name: site.name,
    domains: (site.domains || []).join('\n'),
    retention_days: site.retention_days,
    pv_limit: site.pv_limit,
    snapshot_versions: site.snapshot_versions,
  });
  const [err, setErr] = useState(null);
  const [saved, setSaved] = useState(false);
  const snippet = tagSnippet(site);

  const save = async () => {
    setErr(null); setSaved(false);
    try {
      const domains = f.domains.split(/[\s,]+/).map((d) => d.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase()).filter(Boolean);
      await q(supabase.from('hm_sites').update({
        name: f.name.trim(), domains,
        retention_days: Math.max(7, Math.min(400, Number(f.retention_days) || 180)),
        pv_limit: Math.max(1000, Number(f.pv_limit) || 200000),
        snapshot_versions: Math.max(1, Math.min(10, Number(f.snapshot_versions) || 5)),
      }).eq('id', site.id));
      setSaved(true);
      onChanged();
    } catch (e) { setErr(e); }
  };
  const remove = async () => {
    if (!confirm(`サイト「${site.name}」と、すべての計測データ・ポップアップを削除します。元に戻せません。よろしいですか？`)) return;
    await q(supabase.from('hm_sites').delete().eq('id', site.id));
    go('/');
  };

  return (
    <div className="stack">
      <Card title="計測タグ">
        <p>次のタグを、計測したいすべてのページの <code>&lt;head&gt;</code> 内に貼り付けてください。ヒートマップ・ポップアップ・CV計測がこの1行で動きます。</p>
        <Copy text={snippet} />
        <details className="howto">
          <summary>Googleタグマネージャーで設置する場合</summary>
          <ol>
            <li>タグ →「新規」→ タグの種類で「カスタムHTML」を選ぶ</li>
            <li>上のタグをそのまま貼り付ける</li>
            <li>トリガーに「All Pages（すべてのページ）」を設定して公開</li>
          </ol>
        </details>
        <details className="howto">
          <summary>WordPressで設置する場合</summary>
          <p>「外観 → テーマファイルエディター → functions.php」の末尾、またはコード挿入用プラグイン（WPCode など）のヘッダー欄に次を追加します。</p>
          <pre className="code">{`add_action('wp_head', function () {
  echo '${snippet.replace(/'/g, "\\'")}';
});`}</pre>
        </details>
        {!(site.domains || []).length && (
          <div className="warn-box">計測を許可するドメインが未設定です。下の「計測するドメイン」を設定すると、他のサイトにタグを貼られても計測されなくなります。</div>
        )}
      </Card>

      <Card title="サイト設定">
        <div className="grid-2">
          <Field label="サイト名"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="今月の計測PV"><div className="plain">{fmt(site.usage)} / {fmt(site.pv_limit)}</div></Field>
        </div>
        <Field label="計測するドメイン" hint="1行に1つ。サブドメインも含めて計測します（例：example.com）">
          <textarea rows={3} value={f.domains} onChange={(e) => setF({ ...f, domains: e.target.value })} placeholder="example.com" />
        </Field>
        <div className="grid-3">
          <Field label="データ保存期間（日）" hint="7〜400日"><input type="number" value={f.retention_days} onChange={(e) => setF({ ...f, retention_days: e.target.value })} /></Field>
          <Field label="月間PV上限" hint="超えると翌月まで計測を止めます"><input type="number" value={f.pv_limit} onChange={(e) => setF({ ...f, pv_limit: e.target.value })} /></Field>
          <Field label="デザイン保存数" hint="ページ×デバイスごと（1〜10）"><input type="number" value={f.snapshot_versions} onChange={(e) => setF({ ...f, snapshot_versions: e.target.value })} /></Field>
        </div>
        <ErrorBox error={err} />
        <div className="row gap-8">
          <Btn kind="primary" onClick={save}>保存</Btn>
          {saved && <span className="ok-text">保存しました</span>}
        </div>
      </Card>

      <Card title="サイトの削除">
        <p className="muted">サイトを削除すると、計測データ・ポップアップ・CV設定がすべて削除されます。</p>
        <Btn kind="danger" onClick={remove}>このサイトを削除</Btn>
      </Card>
    </div>
  );
}
