# Judge briefing on GitHub Pages

The animated, single-page briefing lives in `site/index.html`. It presents the
mission problem and solution, a synthetic message-to-timeline illustration,
the five weighted judging criteria, and supporting requirements and evidence.
CSS and JavaScript are inline: no build, API, CDN, or dependency install is needed.
It is separate from Watch Desk and contains no source traffic, manual-derived
corpus, credentials, databases, model assets, or application backend.

## Preview locally

From the repository root:

```sh
python3 -m http.server 8744 --bind 127.0.0.1 --directory site
```

Open [the local briefing](http://127.0.0.1:8744/). The page supports pause/resume,
manual event and criterion selection, source/evidence dialogs, guided scrolling,
reduced motion, and printing all five criteria.

## Publish after review

This branch prepares the files without enabling Pages. The workflow deploys only
from `main`; pushing a feature branch or opening a PR does not publish the site.

1. Decide the audience and verify Pages availability. A private organization
   repository requires GitHub Team or Enterprise Cloud. Its Pages site is public
   by default, except with Enterprise Managed Users. Private site access control
   requires Enterprise Cloud. Organization policy can also restrict publishing.
2. In **Settings → Pages → Build and deployment**, select **GitHub Actions**.
3. In **Settings → Environments**, create `github-pages` if it does not exist,
   then restrict its deployment branches to `main`.
4. Merge the reviewed site and workflow into `main`. Changes to `site/**` or
   `.github/workflows/pages.yml` trigger deployment. Alternatively, run
   **Deploy judge briefing to Pages** manually on `main` in Actions.
5. Confirm the deployment URL in the workflow's `github-pages` environment.
   Without a custom domain, the expected project URL is
   `https://fleethacker.github.io/Parse-Command/`.

The workflow uploads **only `site/`**, pins actions to immutable revisions, and
grants the deployment job `contents: read`, `pages: write`, and `id-token: write`.
No personal access token or other new secret is needed. It does not automatically
enable Pages or deploy feature-branch previews.

## Maintain the briefing

Edit `site/index.html` and preview locally. Preserve the synthetic scenario labels
and distinguish documented implementation from unmeasured operational benefit.
Keep the source references and coverage statements current. Repository paths in
the evidence dialog identify records; those documents are not published copies.

Before merging, check motion and pause controls, source/evidence dialogs, the
judging cycle, guided scrolling, narrow-screen layout, and print output. Confirm
assets and fragment navigation work under the `/Parse-Command/` project subpath.

## GitHub references

- [Configure a Pages publishing source](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
- [Use a custom Pages workflow](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
- [Organization Pages availability](https://docs.github.com/en/organizations/managing-organization-settings/managing-the-publication-of-github-pages-sites-for-your-organization)
- [Pages visibility and access control](https://docs.github.com/en/enterprise-cloud%40latest/pages/getting-started-with-github-pages/changing-the-visibility-of-your-github-pages-site)
