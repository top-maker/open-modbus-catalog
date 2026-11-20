# Public catalog conventions

For work that spans multiple repositories, follow each affected repository's own AGENTS.md and confirm the scope and ownership of the change with the user before proceeding.

- Review the working tree and current branch before editing. Integrate changes into `main` through a reviewed pull request.
- Verify the manufacturer, exact model number, applicable variant, and source before adding product metadata. Share only data and assets cleared for public distribution.
- Use GitHub Issues for product requests, corrections, and public source links. Baseline Thing Models derived from public documents belong here under the MIT License. Keep private or partner-restricted models, private files, and credentials outside this repository.
- Run `npm run check` (the same checks as CI) before opening a pull request.
- Use lowercase kebab-case filenames except where an external tool requires a different name.
