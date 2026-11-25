import { useEffect, useRef } from 'react';
import { useBbNavigate } from '@get-bb/plugin-sdk/app';
import { addNavigator } from './store';

/**
 * Mounted beside each message. Only thread surfaces can open file previews, so
 * this hidden marker lends the content script its surface's navigator.
 */
export function NavigatorAnchor() {
  const navigate = useBbNavigate();
  const anchor = useRef<HTMLSpanElement>(null);
  useEffect(() => (anchor.current ? addNavigator({ anchor: anchor.current, navigate }) : undefined), [navigate]);
  return <span ref={anchor} hidden />;
}
