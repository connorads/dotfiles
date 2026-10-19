import { definePluginApp } from '@get-bb/plugin-sdk/app';
import { TimestampBridge } from './bridge';
import { mountTimestamps } from './labels';
import './app.css';

export default definePluginApp(app => {
  app.slots.experimental_appOverlay({ id: 'timestamps', component: TimestampBridge });
  app.contentScripts.register({ id: 'timestamps', mount: () => mountTimestamps(document) });
});
