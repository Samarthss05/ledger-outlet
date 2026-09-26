import { useState, type FormEvent } from 'react';
import { needClient } from './supabase';

export function AuthScreen() {
  const [mode, setMode] = useState<'in' | 'up' | 'reset'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage('');
    try {
      const db = needClient();
      const result = mode === 'reset'
        ? await db.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin })
        : mode === 'up'
          ? await db.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } })
          : await db.auth.signInWithPassword({ email, password });
      if (result.error) throw result.error;
      if (mode === 'reset') setMessage('If this address has an account, a password reset link will arrive if email delivery is available.');
      else if (mode === 'up') setMessage('If this is a new account, check your email for a confirmation link. If you have signed up before, sign in with your existing password instead.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not complete sign in.'); }
    finally { setBusy(false); }
  }
  return <main className="app auth-wrap">
    <div className="auth-brand"><div className="logo">LO</div><div><h1>Ledger Outlet</h1><p>Every delivery accounted for.</p></div></div>
    <section className="card pad auth-card">
      <h2>{mode === 'reset' ? 'Reset your password' : mode === 'up' ? 'Create your account' : 'Welcome back'}</h2>
      <p className="muted">Your supplier, delivery and claim records are private to your account.</p>
      {mode === 'up' && <p className="muted">Already use this email? Sign in with your existing password. Creating the account again will not send another confirmation email.</p>}
      <form onSubmit={submit}>
        <label className="field-label">Email<input className="password-input" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} /></label>
        {mode !== 'reset' && <label className="field-label">Password<input className="password-input" type="password" minLength={8} autoComplete={mode === 'up' ? 'new-password' : 'current-password'} required value={password} onChange={e => setPassword(e.target.value)} /></label>}
        <button className="btn" disabled={busy}>{busy ? 'Please wait…' : mode === 'reset' ? 'Send reset link' : mode === 'up' ? 'Create account' : 'Sign in'}</button>
      </form>
      {message && <p className="auth-message" role="status">{message}</p>}
      <div className="auth-actions">
        <button onClick={() => { setMode(mode === 'up' ? 'in' : 'up'); setMessage(''); }}>{mode === 'up' ? 'Already have an account? Sign in' : 'Create an account'}</button>
        <button onClick={() => { setMode(mode === 'reset' ? 'in' : 'reset'); setMessage(''); }}>{mode === 'reset' ? 'Back to sign in' : 'Forgot password?'}</button>
      </div>
    </section>
  </main>;
}
