# IBM Plex Mono

The UI bundles unmodified regular and bold WOFF2 files from IBM Plex Mono 2.5.0,
licensed under the SIL Open Font License 1.1. Copyright belongs to the IBM Corp.
Plex is a Reserved Font Name. The complete upstream license is stored with the
fonts and published through the About page's Font license link.

- Upstream: <https://github.com/IBM/plex>
- Revision: `2f9ba1b25957d958db71a849e85d72e3ecfb845a`
- Release: <https://github.com/IBM/plex/releases/tag/@ibm%2Fplex-mono@2.5.0>
- Source directory: <https://github.com/IBM/plex/tree/2f9ba1b25957d958db71a849e85d72e3ecfb845a/packages/plex-mono>
- Local directory: `ui/src/assets/fonts/ibm-plex-mono/`

| File | Upstream relative path | SHA-256 |
| --- | --- | --- |
| `IBMPlexMono-Regular.woff2` | `fonts/complete/woff2/IBMPlexMono-Regular.woff2` | `ba204497f16b6d334cee9d1e963a831b73e3a56e1d6300a8489d18df7214b350` |
| `IBMPlexMono-Bold.woff2` | `fonts/complete/woff2/IBMPlexMono-Bold.woff2` | `ea576f38d05cc44cca48c45314984beb8cc1d2b886f58e1dce99f15dc344eb1d` |
| `LICENSE.txt` | `LICENSE.txt` | `d741e57d5f865e294df801f96b7b5161a88b211df65887e4358d271c9fc5fb4f` |

The license text uses LF line endings and omits one trailing space; its wording
is unchanged. The table records the distributed file hashes.

`ui/src/fonts.css` declares the faces and is imported by `main.tsx`, allowing the
existing bundler to publish hashed font assets. Both weights are served by the
application itself; no font CDN or local font installation is needed. The
shared monospace token applies them across all appearances. Ship names and
hull-number typography have their own tokens and are unchanged.
