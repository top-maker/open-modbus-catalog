# Public catalog conventions

Cross-repository workspace map and shared rules: `/mnt/wsl/data/work/projects/workhome/AGENTS.md` (remote: `https://ysdlab-rpi-080.great-prometheus.ts.net:8443/ysd/workhome.git`). Read it before work that spans repositories.

- Review the working tree and current branch before editing. Integrate changes into `main` through a reviewed pull request.
- Verify the manufacturer, exact model number, applicable variant, and source before adding product metadata. Share only data and assets cleared for public distribution.
- Use GitHub Issues for product requests, corrections, and public source links. Baseline Thing Models derived from public documents belong here under the MIT License. Keep private or partner-restricted models, private files, and credentials outside this repository.
- Run `npm run check` (the same checks as CI) before opening a pull request.
- Use lowercase kebab-case filenames except where an external tool requires a different name.
