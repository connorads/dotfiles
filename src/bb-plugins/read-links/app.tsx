import { definePluginApp } from '@get-bb/plugin-sdk/app';
import { TargetBridge } from './bridge';
import { NavigatorAnchor } from './nav';
import { mountReadLinks } from './rows';
import './app.css';

export default definePluginApp(app => {
  app.slots.experimental_appOverlay({ id: 'targets', component: TargetBridge });
  app.slots.experimental_messageMetadata({ id: 'navigator', placement: 'actionRow', component: NavigatorAnchor });
  app.contentScripts.register({ id: 'read-links', mount: () => mountReadLinks(document) });
});
