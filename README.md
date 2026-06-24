# Kip Status

Public status page for Kip customer-facing services, powered by
[Upptime](https://upptime.js.org), GitHub Actions, GitHub Pages, and GitHub
Issues.

## Monitored Components

- Login and authentication
- Vault and document upload
- Document processing
- Tax engine and artifacts

Upptime checks `https://status.kip-ai.com/synthetic-status.json` for component
markers and stores uptime history in this repository. Custom synthetic
workflows update that JSON from production API checks.

The public page uses `assets/kip-status.css` and `assets/kip-status.js` to show
a simple status-page view with incident banner, uptime bars, check cadence, and
freshness windows.

## Operations

- Fast synthetic checks run every 10 minutes.
- Deep synthetic checks run once per day.
- Incidents are tracked as GitHub Issues in this repository.
- The public evidence URL is `https://status.kip-ai.com`.

Required secrets:

- `STATUS_API_BASE_URL`
- `STATUS_API_KEY`
- `KIP_APP_REPO_TOKEN`

Optional repository variable:

- `STATUS_TAX_ARTIFACT_KEY`
