import { definePluginApp } from '@get-bb/plugin-sdk/app';
import { TimerBridge } from './bridge';
import { mountWorkflowTimers } from './timers';
import './app.css';

export default definePluginApp(app => {
  app.slots.experimental_appOverlay({ id: 'workflow-timers', component: TimerBridge });
  app.contentScripts.register({ id: 'workflow-timers', mount: () => mountWorkflowTimers(document) });
});
