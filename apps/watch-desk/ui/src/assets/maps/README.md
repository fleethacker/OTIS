# Offline country outlines

`countries-110m.json` is the unmodified world-atlas 2.0.2 1:110m country
TopoJSON, derived from Natural Earth. It is bundled with the UI; no runtime
tile server, geocoder, CDN, or external network request is used by the map.

- Source: https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json
- Upstream: https://github.com/topojson/world-atlas/tree/v2.0.2
- SHA-256: `2516c915867c7baf18ddec727aec46c315541a07cfb3d79a6559b05d5e94eee8`
- Natural Earth data is public domain: https://www.naturalearthdata.com/about/terms-of-use/
- World-atlas packaging license: `LICENSE.txt` beside this file.

The coarse outlines provide geographic context; source coordinates remain
independent of the basemap precision. Polygon winding is normalized for D3
rendering on a copy; stored geometry is unchanged. Circle radii are rendered
as spherical distance approximations using the mean Earth radius.
