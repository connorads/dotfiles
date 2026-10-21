import { definePluginApp } from '@get-bb/plugin-sdk/app';
import { mountFileHistory } from './history';
import './app.css';

export default definePluginApp(app => {
  app.contentScripts.register({ id: 'file-history', mount: () => mountFileHistory(document) });
});
