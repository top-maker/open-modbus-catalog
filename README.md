# Open Modbus Catalog

The public product catalog and feedback repository for ModioHub.

The catalog holds product packages. A product is one manufacturer model, such as Advantech ADAM-5017UH, covering every device of that model. Each package holds the product's identity, communication metadata, public source links, approved illustrations, and an executable baseline Thing Model with its simulation scenario. [ModioHub](https://github.com/top-maker/modiohub), [Modpoll](https://github.com/top-maker/modpoll) and [Modsim](https://github.com/top-maker/modsim) read packages from a pinned commit.

Contribute through [GitHub Issues](https://github.com/top-maker/open-modbus-catalog/issues/new/choose) to request a product, report a correction, or suggest a public source. Include the manufacturer, exact model number or part number, and firmware or hardware version when relevant. Share a public source link and page reference when available.

## Product packages

A product package is a directory `products/<manufacturer>/<model-number>/`
with lowercase kebab-case names. Its path is the stable product ID, such as
`advantech/adam-5017uh`; keep it when correcting display names. The first
segment is the manufacturer ID, listed in `manufacturers.yaml` with the
manufacturer's name and any established locale names, such as 研华 for
Advantech. Add the manufacturer there before its first product.

```
products/<manufacturer>/<model-number>/
  product.yaml      required: identity, communication and sources
  model.tm.json     optional: baseline Thing Model
  model.sim.json    optional: simulation scenario for the Thing Model
  images/NN.svg     optional: illustrations listed in product.yaml
  documents/*.pdf   optional: PDFs cleared for redistribution, listed in product.yaml
```

### product.yaml

[`schema/product.schema.json`](schema/product.schema.json) defines the record.
Start the file with
`# yaml-language-server: $schema=../../../schema/product.schema.json` for
completion and checks in editors.

| Field | Required | Meaning |
| --- | --- | --- |
| `modelNumber` | yes | The manufacturer's model number, such as `ADAM-4017+`. A different exact model number is a separate product |
| `aliases` | no | Other spellings of the model number for search |
| `category` | yes | A category ID from `categories.yaml`; add a category there when none fits |
| `description` | yes | One line in English |
| `translations` | no | Per locale: `description`, and image `alt` under `images` |
| `specs` | no | Label and value pairs cited from the listed documents |
| `communication.protocols` | yes | `modbus-tcp`, `modbus-rtu`, `modbus-ascii` |
| `communication.viaChassis` | no | The chassis that provides Modbus for a backplane module |
| `communication.firmware` | no | Documented firmware applicability; absent when unknown |
| `communication.defaults` | no | Settings a new device ships with, see below |
| `documents` | yes | Official sources with exact references |
| `images` | no | Illustrations in display order, `images/01.svg` first |

`documents[].type` is `datasheet` for the specification, `protocol` for a
document that holds the Modbus register map, `manual` when the map lives
inside a user manual, or `other`. Link documents with `url`; commit a copy
with `path` only when it may be redistributed, and record `rights`.

`communication.defaults` holds `tcp` (`port`, `unitId`) and `serial`
(`unitId`, `baudRate`, `dataBits`, `parity`, `stopBits`), each only for a
listed protocol, with a `reference` to the pages that state them and any step
needed before Modbus is available, such as switching from a proprietary protocol.
Record only stated values. Consumers assume port 502 when `tcp.port` is
absent and ask the user for anything else that is missing.

Illustrations are passive SVGs drawn from documented geometry, never
manufacturer photos or logos. Record their source and publication rights.
Consumers fall back to the default language when a translation is missing.

## Thing Models and simulation

`model.tm.json` is the baseline Thing Model. It follows the
[modpoll-wot](https://github.com/top-maker/modpoll-wot) executable profile, and
its `description` states the hardware, chassis, firmware and register map
edition it applies to.

`model.sim.json` is a declarative Modsim scenario. Static values in `initial`
are the default; add `generators` only for points that should change over
time. Scripts are not accepted. Without a scenario, CI generates a static one
from [`simulation-presets.yaml`](simulation-presets.yaml), which gives values
per category and point unit; `uv run scripts/simulation.py <package>` prints
it as a starting point for `model.sim.json`.

CI runs the simulation check on every Thing Model: it validates the profile,
serves the scenario with Modsim and reads it once with Modpoll, requiring
static values to read back unchanged and changing values to stay in range,
then serves values derived from each point's type (bounds, high bit and
asymmetric patterns) to check decoding. This shows that a Thing Model
executes consistently; it does not show that its point mappings match
hardware. Hardware verification records are kept by ModioHub, not in this
catalog.

## Checks

Run the same checks as CI from a Git checkout with Node.js 24 and
[uv](https://docs.astral.sh/uv/):

```sh
npm ci
npm run validate
uv run --locked --script scripts/check-thing-models.py
```

## License

The catalog, including product records, Thing Models and illustrations, is
available under the [MIT License](LICENSE). Linked manufacturer documents remain
under their publishers' terms.
