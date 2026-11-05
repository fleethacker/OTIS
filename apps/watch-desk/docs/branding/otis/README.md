# OTIS branding

OTIS is the **Operational Tasking Integration System**. Its motto is
**Keeping the Watch**, and its mascot is a watchstanding sea otter.

## Approved artwork

The owner selected these illustrations on 2026-11-05. They were created with
the imagegen CLI/API fallback using `gpt-image-2`. The app icon was derived
from the patch as an identity reference. Original PNG files are preserved
without modification; the accompanying prompt files record their creative brief.

- `otis-patch-master.png`: original 1024 × 1024 emblem for larger presentation.
- `otis-icon-master.png`: original 1024 × 1024 mascot for app branding.
- `otis-patch-prompt.txt` and `otis-icon-prompt.txt`: generation prompts.

## Application assets

Runtime files live in `ui/src/assets/otis/`, relative to the application root:

- `otis-icon.webp`: 256 × 256, used in the header and sign-in view.
- `otis-patch.webp`: 800 × 800, used on the About page.
- `otis-favicon.svg`: simplified otter, cap, and headset for small browser tabs.

The WebP images are imported by application code and emitted as local hashed
assets by the existing Ark bundler. The favicon's percent-encoded SVG is embedded
in `ui/index.html` so it loads before JavaScript and requires no external asset
host or protected pipeline change. Keep the SVG file and HTML data URI in sync.

Use the compact mascot in navigation and reserve the full emblem for larger
areas where its lettering stays legible. Preserve the app's status colors,
readable light/dark themes, and the artwork's aspect ratio.
