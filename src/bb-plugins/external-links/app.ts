import { definePluginApp } from '@get-bb/plugin-sdk/app';
import { mountExternalLinks } from './links';
import './app.css';

export default definePluginApp(app => {
  app.contentScripts.register({ id: 'external-links', mount: () => mountExternalLinks(document) });
});
