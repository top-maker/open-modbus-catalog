// The validator is the gate for safety and traceability, so each rule is shown
// to reject the bad data it exists for, not only to accept good data.
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';
import { stringify } from 'yaml';
import { listFiles, validateCatalog } from '../scripts/catalog-rules.mjs';

const repository = new URL('../', import.meta.url);
const documentUrl = 'https://example.com/datasheet.pdf';
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect x="1" y="1" width="8" height="8" fill="none" stroke="#000"/></svg>';
const directories = [];

function baseProduct() {
  return {
    modelNumber: 'TEST-1',
    category: 'analog-input-module',
    description: 'A test module.',
    communication: { protocols: ['modbus-tcp'] },
    documents: [{ type: 'datasheet', title: 'Datasheet', url: documentUrl, reference: 'page 1' }],
  };
}

function image(overrides = {}) {
  return {
    path: 'images/01.svg',
    alt: 'Front view',
    view: 'front-orthographic',
    source: { url: documentUrl, reference: 'figure 1' },
    rights: 'Independently drawn.',
    ...overrides,
  };
}

/** A catalog in a temporary directory: the real lists and schemas plus one product. */
function catalog(product = baseProduct(), extra = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'catalog-'));
  directories.push(directory);
  for (const name of ['schema', 'categories.yaml', 'manufacturers.yaml', 'simulation-presets.yaml']) {
    cpSync(new URL(name, repository), join(directory, name), { recursive: true });
  }
  const write = (path, content) => {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    writeFileSync(join(directory, path), content);
  };
  write('products/advantech/test-1/product.yaml', typeof product === 'string' ? product : stringify(product));
  for (const [path, content] of Object.entries(extra)) write(path, content);
  const root = pathToFileURL(`${directory}/`);
  return { directory, root, write, run: () => validateCatalog(root, listFiles(root)) };
}

function problems(product, extra) {
  return catalog(product, extra).run().errors.join('\n');
}

after(() => directories.forEach(directory => rmSync(directory, { recursive: true, force: true })));

describe('accepts good data', () => {
  it('a minimal product', () => {
    const { errors, count } = catalog().run();
    assert.deepEqual(errors, []);
    assert.equal(count, 1);
  });

  it('a product with a passive illustration drawn from a listed document', () => {
    const { errors } = catalog({ ...baseProduct(), images: [image()] }, { 'products/advantech/test-1/images/01.svg': svg }).run();
    assert.deepEqual(errors, []);
  });

  it('the real catalog', () => {
    const { errors, count } = validateCatalog(repository);
    assert.deepEqual(errors, []);
    assert.ok(count > 0);
  });
});

describe('rejects bad records', () => {
  it('reports every problem in one pass, with the line of YAML errors', () => {
    const text = problems({ ...baseProduct(), category: 'nonexistent', communication: { protocols: ['modbus-tcp'], defaults: { serial: { unitId: 1, baudRate: 9600, dataBits: 8, parity: 'none', stopBits: 1 }, reference: 'page 2' } } });
    assert.match(text, /category nonexistent is not listed/);
    assert.match(text, /serial defaults need the modbus-rtu or modbus-ascii protocol/);
    const bad = problems('modelNumber: TEST-1\ncategory: analog-input-module\nunknownField: 1\n');
    assert.match(bad, /product\.yaml:\d+: .*must NOT have additional properties \(unknownField\)/s);
  });

  it('an unlisted manufacturer', () => {
    const { directory, run } = catalog();
    mkdirSync(join(directory, 'products/nobody/test-1'), { recursive: true });
    writeFileSync(join(directory, 'products/nobody/test-1/product.yaml'), stringify(baseProduct()));
    assert.match(run().errors.join('\n'), /manufacturer nobody is not listed/);
  });

  it('a duplicate model number or an alias that names another product', () => {
    const { write, run } = catalog();
    write('products/advantech/test-2/product.yaml', stringify({ ...baseProduct(), modelNumber: 'test-1' }));
    assert.match(run().errors.join('\n'), /test-1 is already used by/);
    write('products/advantech/test-2/product.yaml', stringify({ ...baseProduct(), modelNumber: 'TEST-2', aliases: ['Test-1'] }));
    assert.match(run().errors.join('\n'), /Test-1 is already used by/);
  });

  it('text that is not trimmed NFC', () => {
    assert.match(problems({ ...baseProduct(), description: 'trailing space ' }), /\/description must be trimmed NFC/);
    assert.match(problems({ ...baseProduct(), specs: [{ label: 'Café', value: '1' }] }), /\/specs\/0\/label must be trimmed NFC/);
  });

  it('serial defaults without a serial protocol and TCP defaults without TCP', () => {
    const product = baseProduct();
    product.communication = { protocols: ['modbus-rtu'], defaults: { tcp: { port: 502, unitId: 1 }, reference: 'page 2' } };
    assert.match(problems(product), /TCP defaults need the modbus-tcp protocol/);
  });
});

describe('rejects unsafe or untraceable sources', () => {
  for (const [name, url, message] of [
    ['a plain HTTP link', 'http://example.com/datasheet.pdf', /\/documents\/0\/url must match pattern/],
    ['a link with credentials', 'https://user:secret@example.com/datasheet.pdf', /HTTPS URL without credentials/],
  ]) {
    it(name, () => {
      const product = baseProduct();
      product.documents[0].url = url;
      assert.match(problems(product), message);
    });
  }

  it('a committed document that is missing or not a PDF', () => {
    const product = baseProduct();
    product.documents = [{ type: 'datasheet', title: 'Datasheet', path: 'documents/ds.pdf', reference: 'page 1', rights: 'Redistributable' }];
    assert.match(problems(product), /invalid, missing or duplicate document documents\/ds\.pdf/);
    assert.match(problems(product, { 'products/advantech/test-1/documents/ds.pdf': 'not a pdf' }), /invalid, missing or duplicate document/);
    assert.deepEqual(catalog(product, { 'products/advantech/test-1/documents/ds.pdf': '%PDF-1.7\n' }).run().errors, []);
  });

  it('an illustration whose source is not a listed document', () => {
    const product = { ...baseProduct(), images: [image({ source: { url: 'https://example.com/other.pdf', reference: 'figure 1' } })] };
    assert.match(problems(product, { 'products/advantech/test-1/images/01.svg': svg }), /source is not one of the documents/);
  });

  it('an illustration that is missing or numbered out of order', () => {
    assert.match(problems({ ...baseProduct(), images: [image()] }), /expected image images\/01\.svg/);
    assert.match(problems({ ...baseProduct(), images: [image({ path: 'images/02.svg' })] }, { 'products/advantech/test-1/images/02.svg': svg }), /expected image images\/01\.svg/);
  });
});

describe('rejects active illustrations', () => {
  const header = 'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"';
  const cases = {
    'a script': `<svg ${header}><script>alert(1)</script></svg>`,
    'a foreignObject': `<svg ${header}><foreignObject/></svg>`,
    'an event handler': `<svg ${header}><rect onload="x()" x="1" y="1" width="1" height="1"/></svg>`,
    'a link': `<svg ${header}><a href="https://example.com"><rect x="1" y="1" width="1" height="1"/></a></svg>`,
    'a style attribute': `<svg ${header}><rect style="fill:red" x="1" y="1" width="1" height="1"/></svg>`,
    'an external fill reference': `<svg ${header}><rect fill="url(#x)" x="1" y="1" width="1" height="1"/></svg>`,
    'a doctype with an entity': `<!DOCTYPE svg [<!ENTITY a "b">]><svg ${header}/>`,
    'a nested svg': `<svg ${header}><svg ${header}/></svg>`,
    'a missing viewBox': '<svg xmlns="http://www.w3.org/2000/svg"/>',
    'malformed XML': `<svg ${header}><rect></svg>`,
  };
  for (const [name, content] of Object.entries(cases)) {
    it(name, () => {
      const product = { ...baseProduct(), images: [image()] };
      const expected = name === 'malformed XML' ? /images\/01\.svg: .*unexpected close tag/ : /images\/01\.svg: expected a passive SVG illustration/;
      assert.match(problems(product, { 'products/advantech/test-1/images/01.svg': content }), expected);
    });
  }
});

describe('rejects files that do not belong', () => {
  it('an unexpected public file', () => {
    assert.match(problems(baseProduct(), { 'products/advantech/test-1/notes.txt': 'private' }), /notes\.txt: Unexpected public file/);
    assert.match(problems(baseProduct(), { 'secrets.env': 'TOKEN=1' }), /secrets\.env: Unexpected public file/);
  });

  it('a symbolic link', () => {
    const { directory, run } = catalog();
    symlinkSync('/etc/hostname', join(directory, 'products/advantech/test-1/link.txt'));
    assert.match(run().errors.join('\n'), /link\.txt: expected a regular file/);
  });

  it('simulation data without a Thing Model, or naming unknown points', () => {
    const data = JSON.stringify({ version: '1', initial: { A: 1 } });
    assert.match(problems(baseProduct(), { 'products/advantech/test-1/model.data.json': data }), /simulation data needs model\.tm\.json/);
    const model = JSON.stringify({ '@type': 'tm:ThingModel', properties: { B: {} } });
    assert.match(problems(baseProduct(), { 'products/advantech/test-1/model.tm.json': model, 'products/advantech/test-1/model.data.json': data }), /unknown properties A/);
    assert.match(problems(baseProduct(), { 'products/advantech/test-1/model.tm.json': '{"@type":"other"}' }), /expected a Thing Model with properties/);
    assert.match(problems(baseProduct(), { 'products/advantech/test-1/model.tm.json': '{not json' }), /invalid JSON/);
  });
});
