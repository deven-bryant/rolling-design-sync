# Security policy

## Supported versions

Rolling Design Sync is in `0.x`. Security fixes go into the **latest minor
release** only; upgrade to it to get them (see `docs/compatibility.md` for
upgrade notes).

| Version | Supported |
|---|---|
| Latest `0.x` minor (currently `0.12.x`) | Yes |
| Older minors | No |

## Reporting a vulnerability

**Please don't open a public issue, discussion or pull request for a security
problem.** Report it privately instead:

- **Preferred:** GitHub **private vulnerability reporting** on this repository
  — open the **Security** tab and choose **Report a vulnerability**.
- **Email:** [security@rollingdesignsync.com](mailto:security@rollingdesignsync.com).

### What to include

- The affected component (see [Scope](#scope)) and version, or the commit you
  tested.
- How the API is deployed: store mode (`RDS_STORE=local`, `RDS_STORE=memory`,
  or Postgres via `DATABASE_URL`), container or plain Node, and anything in
  front of it (reverse proxy, TLS).
- Steps to reproduce, ideally a minimal request sequence or script, and what an
  attacker gains.
- Logs or output that show the problem, **with tokens, session secrets and
  connection strings redacted**.
- Whether the issue is already public, and how you'd like to be credited.

### What to expect

| Step | Target |
|---|---|
| Acknowledgement of your report | within 3 business days |
| First assessment (confirmed or not, severity) | within 10 business days |
| Fix released for a confirmed critical or high issue | within 30 days |
| Fix released for a confirmed medium or low issue | in the next regular release |

We keep you updated while we work on it, agree a disclosure date with you, and
publish a GitHub security advisory with the fixed version. Reporters are
credited in the advisory unless they ask not to be.

## Scope

In scope — the code in this repository, run as documented:

- **API** (`apps/api`): the self-hosted service in every store mode, including
  the portal it serves at `/ui`, authentication with plugin, agent and viewer
  tokens, and sessions.
- **Figma plugin** (`apps/figma-plugin`).
- **MCP server** (`apps/mcp`).
- **Agent CLI** (`scripts/`).
- **Portal** (`apps/portal`).
- **Shared core** (`packages/core`) and the Docker image built from
  `Dockerfile`.

Out of scope:

- **A hosted service** built on this code has its own security contact;
  report problems with it there, not here.
- Problems that need an already-leaked token, access to the host, or a
  deployment that ignores `docs/setup.md` (for example, exposing local mode
  beyond `127.0.0.1`).
- Vulnerabilities in dependencies with no demonstrated impact on this project
  (Dependabot already tracks those), and findings from automated scanners
  without a working proof of concept.
- Denial of service through sheer request volume alone.
