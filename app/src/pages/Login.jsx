import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { Btn, ErrorBox, Field } from '../components/ui';

export default function Login() {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr(null); setMsg(''); setBusy(true);
    try {
      const redirect = location.origin + location.pathname;
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else if (mode === 'signup') {
        if (password.length < 8) throw new Error('パスワードは8文字以上にしてください');
        const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: redirect } });
        if (error) throw error;
        if (!data.session) setMsg('確認メールを送信しました。メール内のリンクを開くとログインできます。');
      } else {
        const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirect, shouldCreateUser: false } });
        if (error) throw error;
        setMsg('ログイン用のリンクをメールで送信しました。');
      }
    } catch (x) {
      const m = String(x.message || x);
      setErr(new Error(/Invalid login/i.test(m) ? 'メールアドレスまたはパスワードが違います' : /already registered/i.test(m) ? 'このメールアドレスは登録済みです。ログインしてください' : m));
    }
    setBusy(false);
  };

  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <div className="brand-lg"><span className="brand-mark" />HarboR Heatmap</div>
        <p className="muted">ヒートマップとポップアップで、Webサイトの成果を改善する社内ツール</p>
        <div className="seg seg-full">
          <button type="button" className={mode === 'login' ? 'on' : ''} onClick={() => setMode('login')}>ログイン</button>
          <button type="button" className={mode === 'signup' ? 'on' : ''} onClick={() => setMode('signup')}>新規登録</button>
          <button type="button" className={mode === 'magic' ? 'on' : ''} onClick={() => setMode('magic')}>メールでログイン</button>
        </div>
        <Field label="メールアドレス"><input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@harbor-live.com" autoComplete="email" /></Field>
        {mode !== 'magic' && (
          <Field label="パスワード"><input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} /></Field>
        )}
        <ErrorBox error={err} />
        {msg && <div className="ok-box">{msg}</div>}
        <Btn kind="primary" type="submit" disabled={busy} className="w-full">
          {mode === 'login' ? 'ログイン' : mode === 'signup' ? 'アカウントを作成' : 'ログインリンクを送る'}
        </Btn>
        <p className="muted small">@harbor-live.com のアドレスで登録できます。社外の方は管理者にメンバー追加を依頼してください。</p>
      </form>
    </div>
  );
}
