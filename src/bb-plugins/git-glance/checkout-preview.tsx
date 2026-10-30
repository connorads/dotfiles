import { useEffect, useState } from 'react';
import { ChipPopover } from '@bb-plugins/chip';
import { useRpc } from '@get-bb/plugin-sdk/app';
import type { rpcContract } from './contracts.ts';
import type { CheckoutLink } from './checkout-links.ts';
import { chip } from './popover.tsx';
import { renew } from './repo-store.ts';
import { message } from './ui.tsx';

export function CheckoutPreview({ target, onOpened, onClose }: {
  target: CheckoutLink; onOpened: () => void; onClose: () => void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void rpc.call('openCheckout', target).then(async () => {
      await renew(target.threadId);
      if (live) onOpened();
    }).catch(cause => { if (live) setError(message(cause)); });
    return () => { live = false; };
  }, [rpc, target]);
  return <ChipPopover className="gg-dialog" panelClassName="gg-panel" aria-label="Open Git checkout" anchor={null}
    trigger={() => chip(target.threadId)} width={600} instant onClose={onClose}>
    <section className="gg-folder-picker">
      <header className="gg-eyebrow"><strong>Open Git checkout</strong><span className="gg-spacer" />
        <button type="button" className="gg-ghost" onClick={onClose}>Close</button></header>
      <p className="gg-folder-path">{target.hostId} · {target.path}</p>
      {error ? <p className="gg-note gg-danger" role="alert">{error}</p> : <p className="gg-note" role="status">Opening checkout…</p>}
    </section>
  </ChipPopover>;
}
