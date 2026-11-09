# Open Modbus Catalog

The public device catalog and feedback repository for ModioHub.

The catalog holds device packages: identity, communication metadata, public source links, approved illustrations, and executable baseline Thing Models with simulation inputs. [ModioHub](https://github.com/top-maker/modiohub), [Modpoll](https://github.com/top-maker/modpoll) and [Modsim](https://github.com/top-maker/modsim) read packages from a pinned commit.

Use [GitHub Issues](https://github.com/top-maker/open-modbus-catalog/issues/new/choose) to request a model, report a correction, or suggest a public source. Include the manufacturer, exact model, and firmware or hardware version when relevant. Share a public source link and page reference when available.

## Device records

Add one `device.json` under `devices/<manufacturer>/<model>/`, using lowercase
kebab-case directory names. The stable ID is that package path, such as
`advantech/adam-5017uh`. Keep it when correcting display names or adding
aliases. Use a separate ID for a different exact model. List cited
specifications in `specs` as label and value pairs.

Provide a default English `description` and optional locale entries in
`translations`. Each description is one line and 90–100 grapheme clusters.
Consumers use the default when the requested locale is missing. Image alt text
follows the same convention.

List official document links and exact references in `device.json`. Put only
PDFs cleared for public redistribution in `documents/`. List approved
illustrations in display order, starting with `images/01.svg`. Use passive
560 × 560 SVGs with a cream background. Record source and publication rights
for each image and for any local PDF. The validator checks that each local asset
is listed and belongs to the same device package.

For chassis-mounted modules, cite the exact module and compatible chassis.
Record documented firmware applicability or use `null` when it is unknown.

## Thing Models and checks

Put executable baseline Thing Models in `models/<name>.tm.json` and list each in
`thingModels` with its hardware, chassis and firmware scope and its documentary
basis. Models follow the [modpoll-wot](https://github.com/top-maker/modpoll-wot)
executable profile. Optional `models/<name>.vectors.json` maps properties to
known raw values. Optional `simulation/<name>.sim.json` scenarios are
declarative Modsim inputs; executable behavior scripts are not accepted.

CI validates every model against the executable profile. When a model lists
vectors, CI also serves them with Modsim and requires Modpoll to read them back
unchanged, and checks that each scenario serves every property. This shows that
a model executes consistently; it does not show that the register map matches
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

The catalog, including device records, Thing Models and illustrations, is
available under the [MIT License](LICENSE). Linked vendor documents remain
under their publishers' terms.
