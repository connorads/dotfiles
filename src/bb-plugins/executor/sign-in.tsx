import { useState } from 'react';
import { experimental_copyToClipboard, UrlLink } from '@get-bb/plugin-sdk/app';
import type { SignInView } from './contracts.ts';
import { countdown, message, rpc, useNow } from './store.ts';

/**
 * The device code and where to approve it. The code is shown even with a
 * prefilled link, so the person can check the page asks for the same code.
 */
export function SignInPanel({ signIn, name }: { signIn: SignInView; name: string }) {
  const now = useNow(1_000);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const link = signIn.verificationUriComplete ?? signIn.verificationUri;
  return <div className="ex-signin" role="group" aria-label={`Sign in to ${name}`}>
    <p className="ex-signin-line">
      Approve in Executor, then come back. The page should show <code className="ex-code">{signIn.userCode}</code>.
    </p>
    <div className="ex-signin-actions">
      <UrlLink className="ex-button ex-button-primary" href={link}>Open Executor</UrlLink>
      <button type="button" className="ex-button" onClick={() => {
        void experimental_copyToClipboard({ text: signIn.userCode }).then(setCopied);
      }}>{copied ? 'Copied' : 'Copy code'}</button>
      <button type="button" className="ex-button" onClick={() => {
        rpc().call('cancelSignIn', { id: signIn.id }).catch(cause => setError(message(cause)));
      }}>Cancel</button>
      <span className="ex-muted" aria-label="Code expires in">{countdown(signIn.expiresAt, now)}</span>
    </div>
    {error && <p className="ex-error" role="alert">{error}</p>}
  </div>;
}
