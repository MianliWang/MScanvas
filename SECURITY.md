# Security policy

## Supported versions

MSCanvas is pre-alpha. Security fixes are applied to the current `main` branch until the first supported release line is published.

## Reporting a vulnerability

Do not open a public issue for vulnerabilities involving arbitrary process execution, path traversal, source-data modification, credential exposure, unsafe update behavior or vendor-library redistribution. Contact the repository owner privately through GitHub security reporting when available.

## Security boundaries

- The frontend must not receive unrestricted shell or filesystem capabilities.
- External tools are launched directly with argv arrays, not through a shell.
- Read/write roots are explicit and validated.
- Source acquisition data is treated as read-only.
- Logs must not dump full environment variables, secrets or raw data.
- Network access is off by default in product behavior and Codex project configuration.
- MCP and arbitrary analysis execution are not part of the MVP security surface.

## Dependency reports

Please include the dependency name, affected version, exploit scenario and a minimal reproduction where lawful.
