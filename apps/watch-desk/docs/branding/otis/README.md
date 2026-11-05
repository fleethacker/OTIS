# OTIS branding

OTIS is the **Operational Tasking Integration System**. Its motto is
**Keeping the Watch**, and its mascot is a watchstanding sea otter.

## Current artwork

`otis-patch-master.png` is the owner-revised 600 × 600 OTIS logo and the single
source for current application branding and the repository README.
The earlier `otis-icon-master.png` and both prompt files are retained as design
history; the application does not use the earlier mascot illustration.

## Application assets

Runtime files live in `ui/src/assets/otis/`, relative to the application root:

- `otis-logo.png`: an exact copy of the current master, shared by the header,
  sign-in screen, and About page.
- `otis-favicon.png`: a 64 × 64 resize of the same artwork for browser tabs.

The logo is imported by application code and emitted as a local hashed asset by
Ark's existing bundler. The favicon is embedded as a PNG data URI in
`ui/index.html` so it loads before JavaScript. Keep that URI byte-for-byte in sync
with `otis-favicon.png`. No external asset host or framework changes are needed.

When replacing the master, copy it to `otis-logo.png`, regenerate the favicon,
and update its data URI. Preserve the image's aspect ratio and transparency.
Current favicon generation, from the repository root on macOS:

```sh
sips -z 64 64 apps/watch-desk/docs/branding/otis/otis-patch-master.png \
  --out apps/watch-desk/ui/src/assets/otis/otis-favicon.png
```

Semantic controls, message-type symbols, and signal flags keep their own icons;
OTIS branding consistently uses the owner-revised logo.
