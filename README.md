# Open Modbus Catalog

The public device catalog and feedback repository for ModioHub.

The catalog holds device identity, communication metadata, public source links, and images approved for public redistribution. The website builds point previews and serves full Thing Models separately.

Use [GitHub Issues](https://github.com/top-maker/open-modbus-catalog/issues/new/choose) to request a model, report a correction, or suggest a public source. Include the manufacturer, exact model, and firmware or hardware version when relevant. Share a public source link and page reference when available.

## Device records

Add one `device.json` under `devices/<manufacturer>/<model>/`, using lowercase
kebab-case directory names. Keep the record's stable ID when correcting display
names or adding aliases. Use a separate ID for a different exact model.

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

Run the same checks as CI from a Git checkout with Node.js 24:

```sh
npm ci
npm run validate
```
