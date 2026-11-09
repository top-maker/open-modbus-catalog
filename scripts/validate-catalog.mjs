import { execFile } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import Ajv2020 from 'ajv/dist/2020.js';
import { createHash } from 'node:crypto';
import { SaxesParser } from 'saxes';

const root = new URL('../', import.meta.url);
const schema = JSON.parse(readFileSync(new URL('schema/device.schema.json', root), 'utf8'));
const ajv = new Ajv2020({ allErrors: true });
const validateDevice = ajv.compile(schema);
const allowedFiles = new Set([
  '.github/ISSUE_TEMPLATE/device-feedback.md',
  '.github/workflows/validate.yaml',
  '.gitignore',
  'AGENTS.md',
  'LICENSE',
  'README.md',
  'package-lock.json',
  'package.json',
  'schema/device.schema.json',
  'scripts/check-thing-models.py',
  'scripts/check-thing-models.py.lock',
  'scripts/validate-catalog.mjs',
]);
const slug = '[a-z0-9]+(?:-[a-z0-9]+)*';
const devicePath = new RegExp(`^devices/${slug}/${slug}/device\\.json$`);
const svgTags = new Set(['svg', 'title', 'desc', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan']);
const svgAttributes = new Set('xmlns width height viewBox role aria-labelledby id fill stroke stroke-width stroke-linejoin stroke-linecap transform d x y rx ry cx cy r x1 x2 y1 y2 points font-family text-anchor font-size font-weight letter-spacing'.split(' '));

function checkIllustration(file, path) {
  const fail = () => { throw new Error(`${path}: expected a passive 560 × 560 SVG illustration`); };
  const parser = new SaxesParser();
  parser.on('doctype', fail);
  parser.on('processinginstruction', fail);
  let root = true;
  let background = false;
  parser.on('opentag', ({ name, attributes }) => {
    if (!svgTags.has(name) || Object.keys(attributes).some(key => !svgAttributes.has(key))) fail();
    if (['fill', 'stroke'].some(key => attributes[key] && !['none', '#000', '#fffaf0'].includes(attributes[key]))) fail();
    if (!root) {
      if (name === 'svg' || attributes.xmlns) fail();
      if (!background && name !== 'title' && name !== 'desc') {
        if (name !== 'rect' || attributes.fill !== '#fffaf0' || attributes.width !== '560' ||
            attributes.height !== '560' || attributes.x || attributes.y || attributes.transform) fail();
        background = true;
      }
      return;
    }
    root = false;
    if (name !== 'svg' || attributes.xmlns !== 'http://www.w3.org/2000/svg' ||
        attributes.width !== '560' || attributes.height !== '560' || attributes.viewBox !== '0 0 560 560') fail();
  });
  parser.write(readFileSync(file, 'utf8')).close();
  if (!background) fail();
}

function checkDescription(text, locale, path) {
  const length = [...new Intl.Segmenter(locale, { granularity: 'grapheme' }).segment(text)].length;
  if (text !== text.normalize('NFC').trim() || length < 90 || length > 100) {
    throw new Error(`${path}: ${locale} description must contain 90–100 NFC grapheme clusters`);
  }
}

function readPackageFile(files, allowedFiles, directory, file, path) {
  const asset = directory + file;
  if (!files.has(asset) || allowedFiles.has(asset)) {
    throw new Error(`${path}: missing or duplicate package file ${file}`);
  }
  allowedFiles.add(asset);
  return readFileSync(new URL(asset, root));
}

function parseObject(bytes, file, path) {
  const value = JSON.parse(bytes.toString('utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path}: ${file} must contain a JSON object`);
  }
  return value;
}

function checkThingModels(device, files, allowedFiles, directory, path) {
  const properties = new Map();
  for (const entry of device.thingModels ?? []) {
    const bytes = readPackageFile(files, allowedFiles, directory, entry.path, path);
    const model = parseObject(bytes, entry.path, path);
    if (model['@type'] !== 'tm:ThingModel' || !model.properties || typeof model.properties !== 'object') {
      throw new Error(`${path}: ${entry.path} must be a Thing Model with properties`);
    }
    const names = new Set(Object.keys(model.properties));
    properties.set(entry.path, { names, sha256: createHash('sha256').update(bytes).digest('hex') });
    if (entry.vectors) {
      const vectors = parseObject(readPackageFile(files, allowedFiles, directory, entry.vectors, path), entry.vectors, path);
      const keys = Object.keys(vectors);
      if (keys.length === 0 || keys.some(key => !names.has(key) ||
          !['number', 'boolean', 'string'].includes(typeof vectors[key]))) {
        throw new Error(`${path}: ${entry.vectors} must map Thing Model properties to scalar values`);
      }
    }
    for (const scenario of entry.scenarios ?? []) {
      const document = parseObject(readPackageFile(files, allowedFiles, directory, scenario, path), scenario, path);
      if (Object.hasOwn(document, 'script')) {
        throw new Error(`${path}: ${scenario} must be declarative without a script`);
      }
    }
  }
  for (const record of device.evidence ?? []) {
    const model = properties.get(record.thingModel);
    if (!model) throw new Error(`${path}: evidence references unlisted ${record.thingModel}`);
    if (record.sha256 !== model.sha256) {
      throw new Error(`${path}: evidence for ${record.thingModel} does not match its current bytes`);
    }
    if (record.points.some(point => !model.names.has(point))) {
      throw new Error(`${path}: evidence names a point missing from ${record.thingModel}`);
    }
  }
}

function checkUrl(url, path) {
  const source = URL.parse(url);
  if (!source || source.protocol !== 'https:' || source.username || source.password) {
    throw new Error(`${path}: expected a valid HTTPS URL without credentials`);
  }
}
try {
  const { stdout } = await promisify(execFile)('git', [
    'ls-files', '-z', '--cached', '--others', '--exclude-standard',
  ], { cwd: root });
  const files = new Set(stdout.split('\0').filter(Boolean));
  const ids = new Set();
  const models = new Set();
  for (const path of files) {
    if (!lstatSync(new URL(path.split('/').map(encodeURIComponent).join('/'), root)).isFile()) {
      throw new Error(`Expected a regular file: ${path}`);
    }
  }
  for (const path of files) {
    if (!devicePath.test(path)) continue;
    allowedFiles.add(path);
    const directory = path.slice(0, -'device.json'.length);
    const device = JSON.parse(readFileSync(new URL(path, root), 'utf8'));
    if (!validateDevice(device)) {
      throw new Error(`${path}: ${ajv.errorsText(validateDevice.errors)}`);
    }
    if (`devices/${device.id}/` !== directory) {
      throw new Error(`${path}: device ID must equal its package path ${directory.slice('devices/'.length, -1)}`);
    }
    if (ids.has(device.id)) throw new Error(`${path}: duplicate device ID ${device.id}`);
    ids.add(device.id);

    const model = JSON.stringify([device.manufacturer.toLowerCase(), device.model.toLowerCase()]);
    if (models.has(model)) throw new Error(`${path}: duplicate manufacturer and model`);
    models.add(model);

    checkDescription(device.description, 'en', path);
    for (const [locale, { description }] of Object.entries(device.translations ?? {})) {
      checkDescription(description, locale, path);
    }
    for (const document of device.documents) {
      if (document.url) {
        checkUrl(document.url, path);
        continue;
      }
      const asset = directory + document.path;
      if (!files.has(asset) || allowedFiles.has(asset) ||
          !readFileSync(new URL(asset, root)).subarray(0, 5).equals(Buffer.from('%PDF-'))) {
        throw new Error(`${path}: invalid, missing or duplicate document ${document.path}`);
      }
      allowedFiles.add(asset);
    }
    for (const [index, image] of (device.images ?? []).entries()) {
      const asset = directory + image.path;
      const expected = `images/${String(index + 1).padStart(2, '0')}.svg`;
      if (image.path !== expected || !files.has(asset)) {
        throw new Error(`${path}: expected image ${expected}`);
      }
      checkUrl(image.source.url, path);
      checkIllustration(new URL(asset, root), asset);
      allowedFiles.add(asset);
    }
    checkThingModels(device, files, allowedFiles, directory, path);
  }
  for (const path of files) {
    if (!allowedFiles.has(path)) throw new Error(`Unexpected public file: ${path}`);
  }

  if (ids.size === 0) throw new Error('No device records found');
  console.log(`Validated ${ids.size} device record(s) and the public file allowlist.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
