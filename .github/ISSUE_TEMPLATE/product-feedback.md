---
name: Product request or correction
about: Request a Modbus product, report a correction, or suggest a public source
---

**Manufacturer and exact model number or part number**

**Request, correction, or missing documentation**

**Applicable hardware, firmware, or configuration (if known)**

**Public source URL and relevant page or section**

**Verification report (optional; requests with a report are handled first)**

If you can reach the device, read it once with a Thing Model of this or a similar product and attach the saved `report-*.json`:

```
modpoll --config <Thing Model file> --report <your usual connection options>
```

A verification report holds the model and point fingerprints, the tool version, transport and date, optional environment notes such as firmware, and each point's read result with your confirmation of the values. It never contains the site address, Unit ID, serial number, or the values read.

Share public links only. For files that are not publicly available, describe the material without attaching it. A maintainer can arrange private intake if needed.
