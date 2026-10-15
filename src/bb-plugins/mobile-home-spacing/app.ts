import { definePluginApp } from '@get-bb/plugin-sdk/app';
import { mountMobileHomeSpacing } from './layout';

export default definePluginApp(app => {
  app.contentScripts.register({
    id: 'mobile-home-spacing',
    mount: () => mountMobileHomeSpacing(document),
  });
});
