// W3C WoT validation of every baseline Thing Model with Eclipse Thingweb
// Playground: the Thing Model JSON Schema and Playground's additional
// assertions. JSON-LD checks are off because they fetch contexts over the
// network. The other static checks are in check-thing-models.py.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { listFiles } from './catalog-rules.mjs';

const { tmValidator } = createRequire(import.meta.url)('@thing-description-playground/core');
const root = new URL('../', import.meta.url);
const models = [...listFiles(root)].filter(path => /^products\/[^/]+\/[^/]+\/model\.tm\.json$/.test(path)).sort();

let failed = 0;
for (const path of models) {
  const messages = [];
  const { report, details } = await tmValidator(readFileSync(new URL(path, root), 'utf8'), message => messages.push(message),
    { checkDefaults: false, checkJsonLd: false });
  const failures = [...Object.entries(report), ...Object.entries(details)].filter(([, result]) => result === 'failed');
  const label = path.slice('products/'.length, -'/model.tm.json'.length);
  if (failures.length) {
    failed += 1;
    console.error(`✗ ${label}: ${failures.map(([name]) => name).join(', ')}\n  ${messages.join('\n  ')}`);
  } else {
    console.log(`✓ ${label}: W3C WoT (Thingweb Playground)`);
  }
}
if (failed) {
  console.error(`${failed} Thing Model(s) failed W3C WoT validation.`);
  process.exitCode = 1;
}
