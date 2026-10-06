import { toFetchHandler } from 'srvx/node';

import { createApp } from './app.js';
import { createDatabase } from './db.js';

export function createFetchHandler(app) {
  return { fetch: toFetchHandler(app) };
}

let handlerPromise;

function getHandler() {
  handlerPromise ??= createDatabase().then((db) => createFetchHandler(createApp(db)));
  return handlerPromise;
}

export default {
  async fetch(request) {
    return (await getHandler()).fetch(request);
  },
};
