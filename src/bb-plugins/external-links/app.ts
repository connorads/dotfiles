import { definePluginApp } from '@get-bb/plugin-sdk/app';
import { mountExternalLinks } from './links';
import { mountFileIcons } from './files';
import './app.css';

export default definePluginApp(app => {
  app.contentScripts.register({ id: 'external-links', mount: () => mountExternalLinks(document) });
  app.contentScripts.register({ id: 'file-preview-icons', mount: () => mountFileIcons(document) });
});
