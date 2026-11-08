# Open Modbus Catalog

The public device catalog and feedback repository for ModioHub.

The catalog holds device identity, communication metadata, public source links, and images approved for public redistribution. The website builds point previews and serves full Thing Models separately.

Use [GitHub Issues](https://github.com/top-maker/open-modbus-catalog/issues/new/choose) to request a model, report a correction, or suggest a public source. Include the manufacturer, exact model, and firmware or hardware version when relevant. Share a public source link and page reference when available.

## Device records

Add one YAML record per exact model under `devices/`. The filename matches its
stable ID. Choose a lowercase manufacturer-and-model ID when adding a record and
retain it when correcting display names or adding aliases. Use aliases for
alternate spellings of the same model. Give different models separate IDs.

The v1 schema covers analog input modules that expose Modbus TCP through a
chassis. Cite the vendor document and section for the exact module and chassis.
Record the documented chassis firmware scope or use `null` when it is unknown.
Confirm the installed chassis and firmware before using a register map.

The initial catalog uses source links for vendor documents and images. To add
an image file, first record redistribution permission and update the schema and
file allowlist through review.

Run the same checks as CI from a Git checkout with Node.js 24:

```sh
npm ci
npm run validate
```
