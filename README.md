# Open Modbus Catalog

The public product catalog and feedback repository for ModioHub.

The catalog holds product packages. A product is one manufacturer model, such as Advantech ADAM-5017UH, covering every device of that model. Each package holds the product's identity, communication metadata and public source links, and, where available, approved illustrations and an executable baseline Thing Model with its simulation data. [ModioHub](https://github.com/top-maker/modiohub), [Modpoll](https://github.com/top-maker/modpoll) and [Modsim](https://github.com/top-maker/modpoll/tree/v2/packages/modsim) read packages from a pinned commit.

Contribute through [GitHub Issues](https://github.com/top-maker/open-modbus-catalog/issues/new/choose) to request a product, report a correction, or suggest a public source. Include the manufacturer, exact model number or part number, and firmware or hardware version when relevant. Share a public source link and page reference when available. Requests that attach a verification report from `modpoll --report` are handled first.

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
  model.data.json   optional: simulation data for the Thing Model
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
Record the `sha256` of the file the facts were read from and the date it was
retrieved (`retrievedAt`, `YYYY-MM-DD`), so a later reader can tell whether the
manufacturer has replaced the document behind the link.
A manufacturer document that is no longer published and may not be
redistributed is listed with its `sha256` alone, without `url` or `path`; say
in `reference` how it was obtained.

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
[modpoll-wot](https://github.com/top-maker/modpoll/tree/v2/packages/modpoll-wot) executable profile, and
its `description` states the hardware, chassis, firmware and register map
edition it applies to.

Addresses (`modv:address`) are zero-based protocol data unit addresses, as the
profile defines them. Convert a manual's reference numbers before recording
them: register `40001` is address `0`. Say so in the `description` when the
manual's own numbering differs.

`model.data.json` is [simulation data](https://github.com/top-maker/modpoll/blob/v2/packages/modpoll-wot/profile.md#simulation-data),
which Modsim loads with `--data`. Static values in `initial` are the default;
add `generators` only for points that should change over time, or `bindings`
for a point that follows another. Simulation data carries no code. Without
it, CI generates static data from
[`simulation-presets.yaml`](simulation-presets.yaml), which gives values per
category and point unit; `uv run scripts/simulation.py <package>` prints it as
a starting point for `model.data.json`. Readings of real devices, such as a
Modpoll `--export` snapshot, are instance data and do not belong here.

CI runs the simulation check on every Thing Model: it validates the profile,
serves the simulation data with Modsim and reads it once with Modpoll, requiring
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
npm test
npm run validate
uv run --locked --script scripts/check-thing-models.py
```

`npm test` shows that each validation rule rejects the bad data it exists for.
The simulation check runs four packages at a time; `--changed-since REF` limits
it to packages changed since a Git ref, as pull requests do in CI, and `--jobs N`
sets the parallelism.

## License

The catalog, including product records, Thing Models and illustrations, is
available under the [MIT License](LICENSE). Linked manufacturer documents remain
under their publishers' terms.
