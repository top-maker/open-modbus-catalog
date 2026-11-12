// Validate catalog structure, safety and source traceability. Presentation
// choices such as description length or illustration style are review rules,
// not checked here.
import { execFile } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import Ajv2020 from 'ajv/dist/2020.js';
import { SaxesParser } from 'saxes';
import { parse } from 'yaml';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const ajv = new Ajv2020({ allErrors: true });
const validator = name => ajv.compile(JSON.parse(read(`schema/${name}.schema.json`)));
const allowedFiles = new Set([
  '.github/ISSUE_TEMPLATE/product-feedback.md',
  '.github/workflows/validate.yaml',
  '.gitignore',
  'AGENTS.md',
  'LICENSE',
  'README.md',
  'categories.yaml',
  'manufacturers.yaml',
  'package-lock.json',
  'package.json',
  'schema/categories.schema.json',
  'schema/manufacturers.schema.json',
  'schema/product.schema.json',
  'schema/simulation-presets.schema.json',
  'scripts/check-thing-models.py',
  'scripts/check-thing-models.py.lock',
  'scripts/simulation.py',
  'scripts/validate-catalog.mjs',
  'simulation-presets.yaml',
]);
const slug = '[a-z0-9]+(?:-[a-z0-9]+)*';
const productPath = new RegExp(`^products/(${slug})/(${slug})/product\\.yaml$`);
const svgTags = new Set(['svg', 'title', 'desc', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan']);
const svgAttributes = new Set('xmlns width height viewBox role aria-labelledby id fill stroke stroke-width stroke-linejoin stroke-linecap transform d x y rx ry cx cy r x1 x2 y1 y2 points font-family text-anchor font-size font-weight letter-spacing'.split(' '));
const colour = /^(none|#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6})$/;

function readYaml(path, validate) {
  const value = parse(read(path));
  if (!validate(value)) throw new Error(`${path}: ${ajv.errorsText(validate.errors)}`);
  return value;
}

// Illustrations must stay passive: a single SVG root of drawing elements, no
// scripts, links, styles, external references or entities.
function checkIllustration(path) {
  const fail = () => { throw new Error(`${path}: expected a passive SVG illustration`); };
  const parser = new SaxesParser();
  parser.on('doctype', fail);
  parser.on('processinginstruction', fail);
  let first = true;
  parser.on('opentag', ({ name, attributes }) => {
    if (!svgTags.has(name) || Object.keys(attributes).some(key => !svgAttributes.has(key))) fail();
    if (['fill', 'stroke'].some(key => attributes[key] && !colour.test(attributes[key]))) fail();
    if (first) {
      if (name !== 'svg' || attributes.xmlns !== 'http://www.w3.org/2000/svg' || !attributes.viewBox) fail();
      first = false;
    } else if (name === 'svg' || attributes.xmlns) fail();
  });
  parser.write(read(path)).close();
}

function checkText(text, path) {
  if (text !== text.normalize('NFC').trim()) throw new Error(`${path}: text must be trimmed NFC`);
}

function checkDefaults({ protocols, defaults }, path) {
  if (defaults?.tcp && !protocols.includes('modbus-tcp')) {
    throw new Error(`${path}: TCP defaults need the modbus-tcp protocol`);
  }
  if (defaults?.serial && !protocols.some(protocol => protocol !== 'modbus-tcp')) {
    throw new Error(`${path}: serial defaults need the modbus-rtu or modbus-ascii protocol`);
  }
}

function checkUrl(url, path) {
  const source = URL.parse(url);
  if (!source || source.protocol !== 'https:' || source.username || source.password) {
    throw new Error(`${path}: expected a valid HTTPS URL without credentials`);
  }
}

function readJsonObject(path) {
  const value = JSON.parse(read(path));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path}: expected a JSON object`);
  return value;
}

// The baseline Thing Model and its simulation data live at fixed paths next to
// product.yaml. The simulation check validates the data against modpoll-wot.
function checkModel(files, directory) {
  const modelPath = `${directory}model.tm.json`;
  const dataPath = `${directory}model.data.json`;
  if (!files.has(modelPath)) {
    if (files.has(dataPath)) throw new Error(`${dataPath}: simulation data needs model.tm.json`);
    return;
  }
  allowedFiles.add(modelPath);
  const model = readJsonObject(modelPath);
  if (model['@type'] !== 'tm:ThingModel' || !model.properties || typeof model.properties !== 'object') {
    throw new Error(`${modelPath}: expected a Thing Model with properties`);
  }
  if (!files.has(dataPath)) return;
  allowedFiles.add(dataPath);
  const data = readJsonObject(dataPath);
  if (data.version !== '1') throw new Error(`${dataPath}: expected simulation data version "1"`);
  const names = [
    ...['initial', 'generators', 'bindings'].flatMap(section => Object.keys(data[section] ?? {})),
    ...Object.values(data.bindings ?? {}),
  ];
  const unknown = names.filter(name => !Object.hasOwn(model.properties, name));
  if (unknown.length) throw new Error(`${dataPath}: unknown properties ${unknown.join(', ')}`);
}

try {
  const { stdout } = await promisify(execFile)('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root });
  const files = new Set(stdout.split('\0').filter(Boolean));
  for (const path of files) {
    if (!lstatSync(new URL(path.split('/').map(encodeURIComponent).join('/'), root)).isFile()) {
      throw new Error(`Expected a regular file: ${path}`);
    }
  }
  const categories = readYaml('categories.yaml', validator('categories'));
  const manufacturers = readYaml('manufacturers.yaml', validator('manufacturers'));
  const presets = readYaml('simulation-presets.yaml', validator('simulation-presets'));
  const unknownPresets = Object.keys(presets).filter(key => key !== 'default' && !Object.hasOwn(categories, key));
  if (unknownPresets.length) throw new Error(`simulation-presets.yaml: unknown categories ${unknownPresets.join(', ')}`);
  const validateProduct = validator('product');
  const modelNumbers = new Set();
  let count = 0;

  for (const path of files) {
    const match = path.match(productPath);
    if (!match) continue;
    allowedFiles.add(path);
    const directory = path.slice(0, -'product.yaml'.length);
    const product = readYaml(path, validateProduct);
    const [, manufacturer] = match;
    if (!Object.hasOwn(manufacturers, manufacturer)) {
      throw new Error(`${path}: manufacturer ${manufacturer} is not listed in manufacturers.yaml`);
    }
    if (!Object.hasOwn(categories, product.category)) {
      throw new Error(`${path}: category ${product.category} is not listed in categories.yaml`);
    }
    const modelNumber = `${manufacturer}\0${product.modelNumber.toLowerCase()}`;
    if (modelNumbers.has(modelNumber)) throw new Error(`${path}: duplicate model number for ${manufacturer}`);
    modelNumbers.add(modelNumber);

    checkText(product.description, path);
    for (const { description } of Object.values(product.translations ?? {})) checkText(description, path);
    checkDefaults(product.communication, path);
    for (const document of product.documents) {
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
    for (const [index, image] of (product.images ?? []).entries()) {
      const asset = directory + image.path;
      const expected = `images/${String(index + 1).padStart(2, '0')}.svg`;
      if (image.path !== expected || !files.has(asset)) throw new Error(`${path}: expected image ${expected}`);
      checkUrl(image.source.url, path);
      checkIllustration(asset);
      allowedFiles.add(asset);
    }
    checkModel(files, directory);
    count++;
  }
  for (const path of files) {
    if (!allowedFiles.has(path)) throw new Error(`Unexpected public file: ${path}`);
  }
  if (count === 0) throw new Error('No product records found');
  console.log(`Validated ${count} product record(s), the lists and the public file allowlist.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
