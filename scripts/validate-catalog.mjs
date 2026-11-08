import { execFile } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import Ajv2020 from 'ajv/dist/2020.js';
import { parse } from 'yaml';

const root = new URL('../', import.meta.url);
const schema = JSON.parse(readFileSync(new URL('schema/device.schema.json', root), 'utf8'));
const ajv = new Ajv2020({ allErrors: true });
const validateDevice = ajv.compile(schema);
const allowedFiles = new Set([
  '.github/ISSUE_TEMPLATE/device-feedback.md',
  '.github/workflows/validate.yaml',
  '.gitignore',
  'AGENTS.md',
  'README.md',
  'package-lock.json',
  'package.json',
  'schema/device.schema.json',
  'scripts/validate-catalog.mjs',
]);
const devicePath = /^devices\/([^/]+)\.yaml$/;
try {
  const { stdout } = await promisify(execFile)('git', [
    'ls-files', '-z', '--cached', '--others', '--exclude-standard',
  ], { cwd: root });
  const files = new Set(stdout.split('\0').filter(Boolean));
  const ids = new Set();
  const models = new Set();
  for (const path of files) {
    const match = path.match(devicePath);
    if (!match && !allowedFiles.has(path)) {
      throw new Error(`Unexpected public file: ${path}`);
    }

    const file = new URL(path.split("/").map(encodeURIComponent).join("/"), root);
    if (!lstatSync(file).isFile()) {
      throw new Error(`Expected a regular file: ${path}`);
    }
    if (!match) continue;

    const device = parse(readFileSync(file, 'utf8'), { maxAliasCount: 0 });
    if (!validateDevice(device)) {
      throw new Error(`${path}: ${ajv.errorsText(validateDevice.errors)}`);
    }
    if (ids.has(device.id)) {
      throw new Error(`${path}: duplicate device ID ${device.id}`);
    }
    if (device.id !== match[1]) {
      throw new Error(`${path}: filename must match device ID ${device.id}`);
    }
    ids.add(device.id);

    const model = JSON.stringify([device.manufacturer.toLowerCase(), device.model.toLowerCase()]);
    if (models.has(model)) {
      throw new Error(`${path}: duplicate manufacturer and model`);
    }
    models.add(model);

    for (const [index, { url }] of device.sources.entries()) {
      const source = URL.parse(url);
      if (!source || source.protocol !== 'https:' || source.username || source.password) {
        throw new Error(`${path}: source ${index + 1} must be a valid HTTPS URL without credentials`);
      }
    }
  }

  if (ids.size === 0) throw new Error('No device records found');
  console.log(`Validated ${ids.size} device record(s) and the public file allowlist.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
