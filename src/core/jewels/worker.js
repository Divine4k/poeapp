'use strict';
// Runs the timeless jewel work away from the main process, so the app does not freeze while a
// Glorious Vanity search (1 to 2 seconds) runs. Started by jewels.js, which downloads the tables
// first (through the app's own web requests, which respect the Windows proxy); this only reads
// them from disk.
const { parentPort, workerData } = require('worker_threads');
const D = require('./data');
const T = require('./timeless');
const { Tables } = require('./tables');

const data = D.load();
const tables = new Tables({
  dir: workerData.dir,
  fetchImpl: () => { throw new Error('The jewel table is not downloaded yet.'); },
});

parentPort.on('message', async ({ id, op, args }) => {
  try {
    const jewel = T.jewelByKey(args.jewel);
    if (!jewel) throw new Error('Unknown jewel');
    const table = await tables.get(jewel.type);
    let result;
    if (op === 'describe') result = T.describe(data, table, args);
    else if (op === 'search') result = T.search(data, table, args);
    else if (op === 'rank') result = T.rank(data, table, args);
    else if (op === 'prepare') result = true;
    else throw new Error(`Unknown job ${op}`);
    parentPort.postMessage({ id, result });
  } catch (e) {
    parentPort.postMessage({ id, error: e.message || String(e) });
  }
});
