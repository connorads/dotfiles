import { useState } from 'react';
import { experimental_copyToClipboard, UrlLink } from '@get-bb/plugin-sdk/app';
import type { SignInView } from './contracts.ts';
import { countdown, message, rpc, useNow } from './store.ts';

/**
 * Where to approve a pending sign-in. A browser sign-in returns to BB by
 * itself; a code sign-in shows the code even with a prefilled link, so the
 * person can check the page asks for the same one.
 */
export function SignInPanel({ signIn, name }: { signIn: SignInView; name: string }) {
  const now = useNow(1_000);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return <div className="ex-signin" role="group" aria-label={`Sign in to ${name}`}>
    {signIn.kind === 'browser'
      ? <p className="ex-signin-line">Finish signing in to {name} in your browser. BB picks it up when you approve.</p>
      : <p className="ex-signin-line">
        Approve in Executor, then come back. The page should show <code className="ex-code">{signIn.userCode}</code>.
      </p>}
    <div className="ex-signin-actions">
      <UrlLink className="ex-button ex-button-primary"
        href={signIn.kind === 'browser' ? signIn.url : signIn.verificationUriComplete ?? signIn.verificationUri}>
        {signIn.kind === 'browser' ? 'Open sign-in page' : 'Open Executor'}
      </UrlLink>
      {signIn.kind === 'device' && <button type="button" className="ex-button" onClick={() => {
        void experimental_copyToClipboard({ text: signIn.userCode }).then(setCopied);
      }}>{copied ? 'Copied' : 'Copy code'}</button>}
      <button type="button" className="ex-button" onClick={() => {
        rpc().call('cancelSignIn', { id: signIn.id }).catch(cause => setError(message(cause)));
      }}>Cancel</button>
      <span className="ex-muted" aria-label="Expires in">{countdown(signIn.expiresAt, now)}</span>
    </div>
    {error && <p className="ex-error" role="alert">{error}</p>}
  </div>;
}
