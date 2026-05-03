# Weekly Research Workbench

Minimal TUI-style static frontend for the deployed Worker.

## What it does

- Fetches `/weekly`
- Lists candidate topics from `narrativeBundles` or `topicClusters`
- Lists related articles
- Loads `/source-context` for any selected article
- Lets you mark articles as `core` or `related`
- Stores selection locally in `localStorage`
- Exports selected research as JSON or Markdown

## Files

- `index.html`
- `styles.css`
- `app.js`

## Deploy on Cloudflare Pages

1. Create a new Pages project
2. Point the project at this repo, or deploy directly from `workbench/`
3. Set the build output directory to:

```text
workbench
```

4. Use no build command

Direct deploy from this folder:

```bash
cd workbench
npx wrangler pages project create weekly-research-workbench --production-branch=main
npx wrangler pages deploy . --project-name weekly-research-workbench
```

## Local preview

Open `workbench/index.html` through any static file server.

Examples:

```bash
cd workbench
python3 -m http.server 4173
```

Then open:

```text
http://localhost:4173
```

## Notes

- Set `api_base` in the UI to your current Worker domain
- No auth, no database, no server-side session
- Selection state is local-only
