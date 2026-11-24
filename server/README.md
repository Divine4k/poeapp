# Map Companion server

What the app talks to: accounts, finished sessions and the inventory pictures of their maps, the shared item list, and troubleshooting reports.
It runs on Cloudflare's free plan as one Worker (`worker.js`) with a D1 database (`DB`) and an R2 bucket (`BUCKET`).

## Setting it up in the Cloudflare dashboard

1. **Storage & Databases, D1:** create a database named `poeapp`. Open its Console tab, paste `schema.sql` and run it.
2. **R2:** switch R2 on (it asks for a payment card; the free allowance costs nothing) and create a bucket named `poeapp`.
3. **Workers & Pages:** create a Worker named `poeapp`, open "Edit code", replace everything with `worker.js` and deploy.
4. **The Worker's Settings, Bindings:** add the D1 database as `DB` and the R2 bucket as `BUCKET`.
5. Put the Worker's address into `SERVER` at the top of `src/cloud.js`. With that line empty, the app has no accounts and asks nobody to register.

The running one is `https://poeapp.divine4k.workers.dev`: Worker `poeapp`, D1 database `poeapp`, R2 bucket `poeapp`. The dashboard editor holds a minified copy of `worker.js`; after changing `worker.js`, paste it in again and deploy.

## What is stored

| Where | What |
|---|---|
| D1 `users` | Name, a random salt and a salted hash. The password itself never reaches the server: the app stretches it with scrypt first. |
| D1 `tokens` | A hash of each login token. Logging out deletes it. |
| D1 `sessions` | One row per uploaded session, for listing: times, strategy name, totals. |
| D1 `hits` | Counters that slow down password guessing, mass registration and flooding the item list. |
| D1 `items` | The shared item list, one row per picture, with who added it. |
| D1 `meta` | Notes the server keeps for itself (that the old item list was taken over). |
| R2 `sessions/<user>/<id>.json` | The session as the app saved it: maps, loot, costs. |
| R2 `pictures/<user>/<map>.json` | The inventory pictures of one map. |
| R2 `shared/items.json` | The item list as one file, rewritten after every change; this is what the apps download. |
| R2 `reports/<user>/<file>` | Reports sent with F9. |

Every upload is written under the account that sent it, so nobody can change another person's data. In the item list, a picture can be renamed or removed by the account that added it, or by an owner of the list: an account with `admin` set to 1 in `users` (set it in the D1 console: `UPDATE users SET admin = 1 WHERE name_key = 'thename';`).

The item list used to live in the `poeappitemdata` repository on GitHub. The first time the server is asked for the list, it copies it from there once. Reading other people's sessions needs an account. Deleting an account removes its rows and files.

## Tests

`npm test` in the repository root runs `test/cloud.test.js`, which runs this Worker against a real SQL engine with the app's own client talking to it.
