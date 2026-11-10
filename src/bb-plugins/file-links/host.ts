import { stat } from 'node:fs/promises';
import { experimental_defineHostEntry } from '@get-bb/plugin-sdk';
import { hostContract } from './contracts';

export default experimental_defineHostEntry({
  contract:hostContract,
  handlers:{
    async exists({path}) {
      try { return (await stat(path)).isFile(); }
      catch(error) {
        if (error instanceof Error && 'code' in error && (error.code==='ENOENT' || error.code==='ENOTDIR')) return false;
        throw error;
      }
    },
  },
});
