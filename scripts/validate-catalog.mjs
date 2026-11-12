// Validate catalog structure, safety and source traceability. The rules live in
// catalog-rules.mjs; this entry point prints every problem and sets the exit code.
import { validateCatalog } from './catalog-rules.mjs';

const { errors, count } = validateCatalog(new URL('../', import.meta.url));
if (errors.length) {
  console.error(errors.join('\n'));
  console.error(`${errors.length} problem(s) found.`);
  process.exitCode = 1;
} else {
  console.log(`Validated ${count} product record(s), the lists and the public file allowlist.`);
}
