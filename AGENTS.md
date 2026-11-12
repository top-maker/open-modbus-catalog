# Public catalog conventions

- Review the working tree and current branch before editing. Integrate changes into `main` through a reviewed pull request.
- Verify the manufacturer, exact model number, applicable variant, and source before adding product metadata. Share only data and assets cleared for public distribution.
- Use GitHub Issues for product requests, corrections, and public source links. Baseline Thing Models derived from public documents belong here under the MIT License. Keep private or partner-restricted models, private files, and credentials outside this repository.
- Run `npm test`, `npm run validate` and `uv run --locked --script scripts/check-thing-models.py` before opening a pull request.
- Use lowercase kebab-case filenames except where an external tool requires a different name.
