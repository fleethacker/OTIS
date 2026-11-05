# Architecture diagrams

The [architecture overview](../architecture.md) embeds these self-contained SVGs:

- `otis-uds.svg`: Kubernetes foundation, UDS Core platform and OTIS workloads.
- `otis-compose.svg`: Docker Engine foundation, local Compose deployment and OTIS workloads.

Both use local product marks and system fonts. They contain no JavaScript, network
dependencies, source traffic or operational configuration. SVG titles and
descriptions provide text alternatives; the overview explains the full flows.

## Edit and regenerate

Edit labels, component geometry and connectors in `render.py`, then run from the
repository root using Python 3.9 or newer:

```sh
python3 docs/integration/diagrams/render.py
python3 docs/integration/diagrams/render.py --check
```

The renderer uses only the Python standard library and the checked-in `icons/`.
Commit the renderer and both SVG outputs together. Open each SVG at full size
and at documentation width to check labels, connectors and product marks. Keep
Kubernetes below Core, and Core below the application; layer position expresses
support while labeled connectors express runtime or deployment flow.

Keep component pins and acceptance labels aligned with the UDS runbook and
`deploy/uds/versions.json`. Architecture updates do not establish new deployment
acceptance evidence.

See [icon provenance](icons/README.md) before replacing product marks.
