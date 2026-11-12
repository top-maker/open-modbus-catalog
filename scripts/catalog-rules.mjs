// Catalog rules: structure, safety and source traceability. Presentation
// choices such as description length or illustration style are review rules,
// not checked here.
//
// `validateCatalog` reports every problem it finds instead of stopping at the
// first one, so a contributor can fix a record in one pass.
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { SaxesParser } from 'saxes';
import { LineCounter, parseDocument } from 'yaml';

const allowedRootFiles = [
  '.github/ISSUE_TEMPLATE/product-feedback.md',
  '.github/dependabot.yaml',
  '.github/pull_request_template.md',
  '.github/workflows/validate.yaml',
  '.gitignore',
  'AGENTS.md',
  '.github/CODEOWNERS',
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
  'scripts/catalog-rules.mjs',
  'scripts/check-thing-models.py',
  'scripts/check-thing-models.py.lock',
  'scripts/simulation.py',
  'scripts/validate-catalog.mjs',
  'simulation-presets.yaml',
  'test/validate-catalog.test.mjs',
];
const slug = '[a-z0-9]+(?:-[a-z0-9]+)*';
const productPath = new RegExp(`^products/(${slug})/(${slug})/product\\.yaml$`);
const svgTags = new Set(['svg', 'title', 'desc', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan']);
const svgAttributes = new Set('xmlns width height viewBox role aria-labelledby id fill stroke stroke-width stroke-linejoin stroke-linecap transform d x y rx ry cx cy r x1 x2 y1 y2 points font-family text-anchor font-size font-weight letter-spacing'.split(' '));
const colour = /^(none|#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6})$/;
const ignoredDirectories = new Set(['.git', 'node_modules', '__pycache__']);

/** The files of the catalog: Git's view in a checkout, a directory walk otherwise. */
export function listFiles(root) {
  try {
    const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] });
    return new Set(out.toString().split('\0').filter(Boolean));
  } catch {
    const files = new Set();
    const walk = directory => {
      for (const entry of readdirSync(new URL(directory, root), { withFileTypes: true })) {
        if (ignoredDirectories.has(entry.name)) continue;
        const path = directory + entry.name;
        if (entry.isDirectory()) walk(`${path}/`);
        else files.add(path);
      }
    };
    walk('');
    return files;
  }
}

/** Checks the catalog under `root` (a directory URL) and returns every problem. */
export function validateCatalog(root, files = listFiles(root)) {
  const errors = [];
  const fail = (path, message, line) => errors.push(`${path}${line ? `:${line}` : ''}: ${message}`);
  const guard = (path, action) => {
    try {
      action();
    } catch (error) {
      fail(path, error.message);
    }
  };
  const fileUrl = path => new URL(path.split('/').map(encodeURIComponent).join('/'), root);
  const read = path => readFileSync(fileUrl(path), 'utf8');
  const ajv = new Ajv2020({ allErrors: true });
  const validator = name => ajv.compile(JSON.parse(readFileSync(new URL(`schema/${name}.schema.json`, root), 'utf8')));
  const allowedFiles = new Set(allowedRootFiles);

  // The first rule that matches a point gives its value, so a rule whose
  // conditions an earlier rule of the same list already covers is never used.
  function checkPresets(presets) {
    const covers = (earlier, later) =>
      (earlier.unit === undefined || earlier.unit === later.unit) &&
      (earlier.type === undefined || earlier.type === later.type) &&
      (earlier.name === undefined || (later.name !== undefined && later.name.toLowerCase().includes(earlier.name.toLowerCase())));
    for (const [list, rules] of Object.entries(presets)) {
      rules.forEach((rule, index) => {
        const first = rules.slice(0, index).findIndex(earlier => covers(earlier, rule));
        if (first >= 0) fail('simulation-presets.yaml', `${list}: rule ${index + 1} is never used, rule ${first + 1} matches first`);
      });
    }
  }
  let count = 0;

  // Schema errors name the line of the offending YAML node.
  function readYaml(path, validate) {
    const lines = new LineCounter();
    const document = parseDocument(read(path), { lineCounter: lines });
    for (const error of document.errors) fail(path, error.message.split('\n')[0], error.linePos?.[0].line);
    if (document.errors.length) return null;
    const value = document.toJS();
    if (!validate(value)) {
      for (const { instancePath, message, params } of validate.errors) {
        const keys = instancePath.split('/').slice(1).map(key => (/^\d+$/.test(key) ? Number(key) : key.replace(/~1/g, '/').replace(/~0/g, '~')));
        const offset = (document.getIn(keys, true)?.range ?? document.contents?.range)?.[0];
        const where = instancePath ? ` ${instancePath}` : '';
        const extra = params?.additionalProperty ? ` (${params.additionalProperty})` : '';
        fail(path, `${where.trim()} ${message}${extra}`.trim(), offset === undefined ? undefined : lines.linePos(offset).line);
      }
      return null;
    }
    return value;
  }

  // Illustrations must stay passive: a single SVG root of drawing elements, no
  // scripts, links, styles, external references or entities.
  function checkIllustration(path) {
    const reject = () => { throw new Error('expected a passive SVG illustration'); };
    const parser = new SaxesParser();
    parser.on('doctype', reject);
    parser.on('processinginstruction', reject);
    let first = true;
    parser.on('opentag', ({ name, attributes }) => {
      if (!svgTags.has(name) || Object.keys(attributes).some(key => !svgAttributes.has(key))) reject();
      if (['fill', 'stroke'].some(key => attributes[key] && !colour.test(attributes[key]))) reject();
      if (first) {
        if (name !== 'svg' || attributes.xmlns !== 'http://www.w3.org/2000/svg' || !attributes.viewBox) reject();
        first = false;
      } else if (name === 'svg' || attributes.xmlns) reject();
    });
    parser.write(read(path)).close();
  }

  // Every string a record carries is trimmed NFC, so equal text compares equal.
  function checkText(value, path, where = '') {
    if (typeof value === 'string') {
      if (value !== value.normalize('NFC').trim()) fail(path, `${where || 'text'} must be trimmed NFC`);
    } else if (Array.isArray(value)) {
      value.forEach((item, index) => checkText(item, path, `${where}/${index}`));
    } else if (value && typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) checkText(item, path, `${where}/${key}`);
    }
  }

  function checkDefaults({ protocols, defaults }, path) {
    if (defaults?.tcp && !protocols.includes('modbus-tcp')) fail(path, 'TCP defaults need the modbus-tcp protocol');
    if (defaults?.serial && !protocols.some(protocol => protocol !== 'modbus-tcp')) {
      fail(path, 'serial defaults need the modbus-rtu or modbus-ascii protocol');
    }
  }

  function checkUrl(url, path) {
    const source = URL.parse(url);
    if (!source || source.protocol !== 'https:' || source.username || source.password) {
      fail(path, `expected a valid HTTPS URL without credentials: ${url}`);
    }
  }

  function readJsonObject(path) {
    let value;
    try {
      value = JSON.parse(read(path));
    } catch (error) {
      fail(path, `invalid JSON: ${error.message}`);
      return null;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      fail(path, 'expected a JSON object');
      return null;
    }
    return value;
  }

  // The baseline Thing Model and its simulation data live at fixed paths next to
  // product.yaml. The simulation check validates the data against modpoll-wot.
  function checkModel(directory) {
    const modelPath = `${directory}model.tm.json`;
    const dataPath = `${directory}model.data.json`;
    if (!files.has(modelPath)) {
      if (files.has(dataPath)) fail(dataPath, 'simulation data needs model.tm.json');
      return;
    }
    allowedFiles.add(modelPath);
    if (files.has(dataPath)) allowedFiles.add(dataPath);
    const model = readJsonObject(modelPath);
    if (!model) return;
    if (model['@type'] !== 'tm:ThingModel' || !model.properties || typeof model.properties !== 'object') {
      fail(modelPath, 'expected a Thing Model with properties');
      return;
    }
    if (!files.has(dataPath)) return;
    const data = readJsonObject(dataPath);
    if (!data) return;
    if (data.version !== '1') fail(dataPath, 'expected simulation data version "1"');
    const names = [
      ...['initial', 'generators', 'bindings'].flatMap(section => Object.keys(data[section] ?? {})),
      ...Object.values(data.bindings ?? {}),
    ];
    const unknown = names.filter(name => !Object.hasOwn(model.properties, name));
    if (unknown.length) fail(dataPath, `unknown properties ${unknown.join(', ')}`);
  }

  function checkProduct(path, directory, manufacturer, product, lists, seen) {
    const { categories, manufacturers } = lists;
    if (!Object.hasOwn(manufacturers, manufacturer)) fail(path, `manufacturer ${manufacturer} is not listed in manufacturers.yaml`);
    if (!Object.hasOwn(categories, product.category)) fail(path, `category ${product.category} is not listed in categories.yaml`);
    // A model number and its aliases are search keys: none may name another product.
    for (const name of [product.modelNumber, ...(product.aliases ?? [])]) {
      const key = `${manufacturer}\0${name.toLowerCase()}`;
      const owner = seen.get(key);
      if (owner && owner !== path) fail(path, `${name} is already used by ${owner}`);
      else seen.set(key, path);
    }
    checkText(product, path);
    checkDefaults(product.communication, path);
    const documentUrls = new Set();
    for (const document of product.documents) {
      if (document.url) {
        documentUrls.add(document.url);
        checkUrl(document.url, path);
        continue;
      }
      const asset = directory + document.path;
      if (!files.has(asset) || allowedFiles.has(asset) ||
          !readFileSync(fileUrl(asset)).subarray(0, 5).equals(Buffer.from('%PDF-'))) {
        fail(path, `invalid, missing or duplicate document ${document.path}`);
      } else {
        allowedFiles.add(asset);
      }
    }
    for (const [index, image] of (product.images ?? []).entries()) {
      const asset = directory + image.path;
      const expected = `images/${String(index + 1).padStart(2, '0')}.svg`;
      if (image.path !== expected || !files.has(asset)) {
        fail(path, `expected image ${expected}`);
        continue;
      }
      allowedFiles.add(asset);
      checkUrl(image.source.url, path);
      // An illustration is drawn from a listed document, so its source is traceable.
      if (!documentUrls.has(image.source.url)) fail(path, `image ${image.path} source is not one of the documents`);
      guard(asset, () => checkIllustration(asset));
    }
    checkModel(directory);
    count++;
  }

  for (const path of files) {
    if (!lstatSync(fileUrl(path)).isFile()) fail(path, 'expected a regular file');
  }
  const lists = {};
  guard('catalog', () => {
    lists.categories = readYaml('categories.yaml', validator('categories'));
    lists.manufacturers = readYaml('manufacturers.yaml', validator('manufacturers'));
    const presets = readYaml('simulation-presets.yaml', validator('simulation-presets'));
    if (presets) checkPresets(presets);
    if (presets && lists.categories) {
      const unknown = Object.keys(presets).filter(key => key !== 'default' && !Object.hasOwn(lists.categories, key));
      if (unknown.length) fail('simulation-presets.yaml', `unknown categories ${unknown.join(', ')}`);
    }
  });
  if (lists.categories && lists.manufacturers) {
    const validateProduct = validator('product');
    const seen = new Map();
    for (const path of [...files].sort()) {
      const match = path.match(productPath);
      if (!match) continue;
      allowedFiles.add(path);
      const product = readYaml(path, validateProduct);
      if (product) guard(path, () => checkProduct(path, path.slice(0, -'product.yaml'.length), match[1], product, lists, seen));
    }
    if (count === 0 && errors.length === 0) fail('products', 'No product records found');
  }
  for (const path of files) {
    if (!allowedFiles.has(path)) fail(path, 'Unexpected public file');
  }
  return { errors, count };
}
