# `jackchammons/services` — the prompt-to-deployed-web-service platform

**Design spec, v1 — 2026-08-27**

| | |
|---|---|
| Owner | `jackchammons` |
| Repo | `jackchammons/services` (new, dedicated) |
| Domain | `apps.jackhammons.com` (wildcard, delegated to Route 53) |
| Cloud | AWS, single account (us-west-2 primary) |
| IaC | Terraform ≥ 1.12 |
| Deploys | GitHub Actions + OIDC only — no human-held or agent-held write credentials |

**Goal state:** from a phone, in a Claude Code session, "build X and deploy it" produces a live `https://<slug>.apps.jackhammons.com` with zero human steps after the one-time bootstrap — except where an external party (Google, SES production access) structurally requires a human, and those cases degrade gracefully instead of blocking.

This platform generalizes the battle-tested patterns of the `sites` repo: a JSON registry driving one orchestrator, a single env-var execution contract, a scaffolder that ships a working hello-world before any real code, fail-closed verification with accumulated errors, agents kept behind deterministic validators, and CLAUDE.md as a lessons ledger ("decisions with receipts").

Two externally-verified facts shape the design:

- **Terraform S3-native state locking** (`use_lockfile = true`) is GA since Terraform 1.11 — no DynamoDB lock table is needed. ([overview](https://www.bschaatsbergen.com/s3-native-state-locking), [migration notes](https://medium.com/@mohamed.mourad/terraform-state-locking-migrating-from-dynamodb-to-native-s3-locking-2a49ef2668ac))
- **Google offers no API to manage OAuth client redirect URIs** ([open feature request](https://github.com/googleapis/google-cloud-go/issues/10768)) and **no Terraform resource for non-IAP OAuth clients** ([provider issue](https://github.com/hashicorp/terraform-provider-google/issues/16452)). Per-service Google console steps cannot be automated — so §4.2 designs them away instead.

---

## 1. Repo layout

```
services/
├── CLAUDE.md                        # conventions + lessons ledger ("decisions with receipts")
├── README.md
├── services.config.json             # THE registry — drives orchestrator, CI, scaffolder, docs
├── bootstrap/
│   ├── README.md                    # the ordered one-time human checklist (§6)
│   └── seed/                        # chicken-egg breaker: state bucket + OIDC, applied once locally
│       ├── main.tf
│       └── outputs.tf
├── platform/
│   ├── foundations/                 # shared stack, state key platform/foundations.tfstate
│   │   ├── main.tf                  # backend + providers (aws, aws.us_east_1 alias)
│   │   ├── dns.tf                   # apps.jackhammons.com zone, wildcard ACM ×2
│   │   ├── network.tf               # VPC, public subnets, SGs, gateway endpoints
│   │   ├── alb.tf                   # shared ALB + HTTPS listener + default 404
│   │   ├── ecs.tf                   # cluster, capacity providers
│   │   ├── auth.tf                  # shared Cognito pool + Google IdP + auth.apps domain
│   │   ├── iam.tf                   # deploy roles, permission boundary, debug identity
│   │   ├── observability.tf         # SNS alarm topic, budget, log retention defaults
│   │   └── outputs.tf               # every output ALSO written to SSM /platform/foundations/*
│   └── modules/                     # the capability catalog (§2.3)
│       ├── static-site/
│       ├── web-app-fargate/
│       ├── api-lambda/
│       ├── db-dynamodb/
│       ├── auth-client/
│       ├── bucket-uploads/
│       ├── realtime-websocket/
│       ├── queue/
│       ├── cron/
│       └── email-sender/
├── services/
│   └── <slug>/
│       ├── service.json             # per-service manifest (tier, secrets, smoke, budgets)
│       ├── infra/                   # thin root module composing catalog modules
│       │   ├── main.tf
│       │   ├── backend.tf           # partial backend; key injected by orchestrator
│       │   └── variables.tf         # only: env, image_tag (fargate/lambda tiers)
│       ├── app/                     # the application: Dockerfile / src / static
│       ├── smoke/
│       │   └── smoke.mjs            # runtime-contract checks against the live URL
│       ├── CLAUDE.md                # per-service runbook + lessons
│       └── README.md
├── scripts/
│   ├── svc.mjs                      # orchestrator: build/verify/plan/deploy/smoke per registry
│   ├── new-service.mjs              # scaffolder (three-state ledger: + / = / !)
│   ├── detect-changes.mjs           # git diff → registry dirs → affected {slug, scope}
│   ├── preview-name.mjs             # slug+branch → DNS-safe env name (one place, one truth)
│   ├── sweep-previews.mjs           # orphan detection: state keys vs live branches
│   └── cost-report.mjs              # Cost Explorer by tag:service → markdown table
├── policy/                          # conftest (OPA/rego) run on terraform plan JSON
│   ├── required-tags.rego
│   ├── deny-dangerous-types.rego
│   ├── backend-key-matches-dir.rego
│   └── escape-hatch.rego
└── .github/workflows/
    ├── deploy.yml                   # the main path: branch → preview, main → prod
    ├── foundations.yml              # plan/apply platform/foundations (human-gated)
    ├── teardown-preview.yml         # PR close / branch delete / nightly sweeper
    ├── destroy-service.yml          # manual dispatch, confirm=slug, two-key for data
    └── health.yml                   # daily smoke-all + alarm digest + cost delta
```

**Registry entry shape** — extends the proven `sites.config.json` contract (argv arrays, cwd = service dir, env-var contract):

```json
{
  "slug": "chatdocs",
  "name": "ChatDocs",
  "tier": "fargate",
  "dir": "services/chatdocs",
  "build":  ["docker", "build", "-t", "$IMAGE_URI", "app/"],
  "verify": ["node", "smoke/verify-static.mjs"],
  "smoke":  ["node", "smoke/smoke.mjs"],
  "secrets": [],
  "capabilities": ["auth-client", "bucket-uploads", "db-dynamodb"],
  "prod":    { "desiredCount": 1, "spot": false },
  "preview": { "desiredCount": 1, "spot": true, "ttlDays": 7 }
}
```

`tier` selects the compute module (`static` | `lambda` | `fargate`); `capabilities` lists the add-on catalog modules the service's `infra/` composes. `secrets` names service-specific secrets (platform-wide ones like the Google client are implied by `auth-client`).

**The env-var contract** (the `OUT_DIR` generalization): every build/verify/smoke command receives `SERVICE_SLUG`, `SERVICE_ENV`, `SERVICE_URL`, `IMAGE_URI` (when applicable), and `OUT_DIR` (static tier). Every unit is standalone-runnable *and* orchestratable, unchanged from `sites`.

---

## 2. Terraform architecture

### 2.1 State

- **Backend**: S3 bucket `svc-tfstate-<account-id>` — versioned, SSE-KMS, public access blocked. Created by `bootstrap/seed` with local state, which then migrates its own state into the bucket.
- **Locking**: native S3 locking via `use_lockfile = true` (a `.tflock` object written with S3 conditional writes). **No DynamoDB table.** Pin `required_version = ">= 1.12"`; the orchestrator refuses to run on older binaries.
- **Keys**:
  - `platform/foundations.tfstate`
  - `services/<slug>/envs/prod.tfstate`
  - `services/<slug>/envs/pr-<branch-token>.tfstate` (previews)
- **Keys are injected, never typed.** `infra/backend.tf` declares a *partial* backend (bucket, region, `use_lockfile` only); the orchestrator computes the key from the directory path and env and passes `-backend-config="key=…"`. A key can never be hand-mistyped into another service's namespace, and `policy/backend-key-matches-dir.rego` re-checks it in CI from the plan JSON.
- **Isolation enforcement**, three layers:
  1. The services deploy role's state-bucket policy allows object access only under `services/*` and explicitly **denies** `platform/*` — a service apply can never touch foundations state.
  2. GitHub Actions `concurrency: tf-<slug>-<env>` serializes applies per service+env; native locking backstops any race.
  3. Between services, isolation is procedural (computed keys + rego check). Honest limitation of a single deploy role — acceptable for one owner; per-service roles are the graduation path (§8).

### 2.2 Foundations stack (applied once, changed rarely)

| Resource | Details | Shared vs per-service |
|---|---|---|
| GitHub OIDC provider | `token.actions.githubusercontent.com` | shared |
| IAM `svc-deploy-foundations` | trust: OIDC `sub = repo:jackchammons/services:environment:foundations` (main only) | shared |
| IAM `svc-deploy-services` | trust: OIDC `sub = repo:jackchammons/services:*` (previews deploy from branches); permission boundary `svc-boundary` on itself **and** required on any role it creates | shared |
| IAM `claude-debug` | read-only identity for Claude sessions (§4.3) | shared |
| Route 53 zone | `apps.jackhammons.com`, delegated from parent DNS once | shared; services add records |
| ACM certs | `*.apps.jackhammons.com` in **us-east-1** (CloudFront) and **us-west-2** (ALB / API GW) | shared |
| VPC | no-NAT design, below | shared |
| ALB | `svc-shared-alb`: HTTPS :443 with wildcard cert, default action fixed-404, HTTP→HTTPS redirect | shared; services add listener rules + target groups |
| ECS cluster | `svc-cluster`, Fargate + Fargate Spot capacity providers, Container Insights off (cost) | shared; services add ECS services |
| ECR | one repo per containerized service, lifecycle policy: keep last 10 images | per-service (created by its module) |
| Cognito | shared user pool + hosted domain `auth.apps.jackhammons.com` + Google IdP (§4.2) | pool shared; **app clients per-service** |
| SES | domain identity `apps.jackhammons.com`, DKIM via Route 53 | shared |
| Observability | SNS topic `svc-alarms` (email subscription), AWS Budget $50/mo with 50/80/100% alerts, default log retention 30d | shared |

**VPC: public subnets only, no NAT.** `10.40.0.0/16`, 2 AZs, 2 public subnets, IGW, free S3 + DynamoDB gateway endpoints. Fargate tasks run in public subnets with `assign_public_ip = true` and a security group admitting ingress **only from the ALB's SG** — a public IP with no open ingress ports is not an exposure. Why: a NAT Gateway costs ~$32/mo + $0.045/GB before a single service exists; the public-IPv4 charge is ~$3.65/mo per *running* task, which wins until roughly eight concurrently-running tasks — far beyond this platform's early life. Interface endpoints (~$7/mo each) are skipped for the same reason. Graduation: one foundations variable (`enable_nat = true`) adds NAT + private subnets; services read subnet IDs from SSM, so nothing in them changes.

**Foundation outputs flow to services via SSM Parameter Store, not `terraform_remote_state`.** Every output is mirrored to `/platform/foundations/<name>` (`vpc_id`, `public_subnet_ids`, `alb_listener_arn`, `alb_dns_name`, `alb_zone_id`, `zone_id`, `cert_arn_us_east_1`, `cert_arn_regional`, `cluster_arn`, `user_pool_id`, `user_pool_endpoint`, …) and services read them with `data "aws_ssm_parameter"`. Why: remote state would hand every service the *entire* foundations state file (coupled forever to its internal layout, and in conflict with the `platform/*` state denial); SSM parameters are a narrow, explicit, individually IAM-scopable interface that scripts, smoke tests, and the read-only debug role can also read without running Terraform.

### 2.3 Capability catalog — v1 modules

| Module | Composes | Key inputs | Key outputs | Idle cost/mo |
|---|---|---|---|---|
| `static-site` | S3 + CloudFront (OAC) + Route 53 alias; us-east-1 wildcard cert | `slug`, `env` | `url`, `bucket`, `distribution_id` | ~$0.01 |
| `web-app-fargate` | ECR repo, task def, ECS service, target group, ALB host rule, Route 53 alias, log group, SG | `slug`, `env`, `cpu=256`, `memory=512`, `port`, `desired_count`, `spot`, `env_vars`, `secrets_map` | `url`, `ecr_repo_url`, `service_name`, `task_family` | ~$12.7 on-demand / ~$6.3 Spot (incl. IPv4) |
| `api-lambda` | Lambda (zip or image), HTTP API Gateway, custom domain on regional wildcard cert, Route 53 alias, log group | `slug`, `env`, `runtime`, `handler`, `env_vars`, `secrets_map` | `url`, `function_name`, `api_id` | ~$0 |
| `db-dynamodb` | table, on-demand billing; PITR + `prevent_destroy` + deletion protection in prod | `slug`, `env`, `name_suffix`, `hash_key`, `range_key?`, `gsis[]`, `ttl_attribute?` | `table_name`, `table_arn` | ~$0 |
| `auth-client` | Cognito **app client** on the shared pool: callback `https://<fqdn>/auth/callback`, logout `https://<fqdn>/`, Google + Cognito IdPs, code grant | `slug`, `env`, `fqdn`, `scopes` | `client_id`, `issuer_url`, `auth_domain` | $0 (Lite tier < 10k MAU) |
| `bucket-uploads` | private S3 bucket, CORS for fqdn, presigned-PUT convention; previews expire objects at 7d, prod uses intelligent tiering + `prevent_destroy` | `slug`, `env`, `cors_origins`, `max_size_mb` | `bucket`, `bucket_arn` | ~$0.023/GB |
| `realtime-websocket` | API GW WebSocket API, `$connect/$disconnect/$default` Lambda routes, TTL'd DynamoDB connections table, domain `ws-<slug>.apps…` | `slug`, `env`, `handler_arn` | `ws_url`, `connections_table`, `management_endpoint` | ~$0 — **Lambda tier only**; Fargate apps skip it, the ALB passes WebSockets natively |
| `queue` | SQS + DLQ (redrive ×3), optional Lambda event-source mapping | `slug`, `env`, `name_suffix`, `consumer_arn?` | `queue_url`, `dlq_url` | $0 |
| `cron` | EventBridge Scheduler → Lambda invoke or ECS RunTask | `slug`, `env`, `schedule`, `target` | `schedule_arn` | $0 |
| `email-sender` | SES sending policy + config set scoped to `<slug>@apps.jackhammons.com`, attached to the service's role | `slug`, `env` | `from_address`, `configuration_set` | $0 (sandbox until access ticket) |

Deferred to v2: `db-rds-serverless` (Aurora Serverless v2 Postgres, min 0 ACU auto-pause) — DynamoDB covers v1.

Every module: passes through `default_tags`, creates its own log groups with retention, names resources `svc-<slug>-<env>-*`, and its README documents inputs/outputs **plus cost-when-idle as a first-class field** — that figure is the agent's tier-selection input.

### 2.4 Preview environments

- **Naming**: `scripts/preview-name.mjs` maps branch → DNS-safe token (lowercase, `[^a-z0-9]` → `-`, truncated so `<slug>-<token>` ≤ 40 chars, 6-char hash suffix on truncation). Preview FQDN: **`<slug>-<token>.apps.jackhammons.com`** — a single label, so the one wildcard cert covers it. This is why the separator is `-`, never `.`.
- **Mechanics**: same root module, `-var env=pr-<token>`, own state key. Modules derive the fqdn internally (`prod` → `<slug>`, else `<slug>-<token>`).
- **Nothing stateful is shared with prod.** Previews get their own tables, upload buckets (7-day object expiry), and Cognito app client (its own callback URL — the pool is shared, but that is directory, not data). Shared: VPC, ALB, cluster, certs, zone, Cognito pool. Previews default to Fargate Spot, `desiredCount 1`.
- **Teardown**: `teardown-preview.yml` on `pull_request: closed` and branch `delete` events destroys the preview and deletes its state object. The nightly leg runs `sweep-previews.mjs`: list `services/*/envs/pr-*.tfstate`, diff against live branches, destroy orphans older than the manifest `ttlDays` — the guard against missed webhooks.

### 2.5 Guardrails

1. **Permission boundary** `svc-boundary` on the services deploy role: full power over the allowed families (S3, CloudFront, ECS/ECR, Lambda, API GW, DynamoDB, SQS, EventBridge, Cognito *app-client* APIs, Route 53 records in the apps zone only, CloudWatch, SSM under `/services/*`, IAM roles matching `svc-*` with a boundary-required condition); explicit deny on `organizations:*`, `account:*`, `iam:CreateUser`, `cognito-idp:DeleteUserPool`, billing writes, and the state bucket's `platform/*` prefix.
2. **Tags**: provider `default_tags = { service, env, managed-by = "terraform", repo = "jackchammons/services" }` from a scaffolder-emitted shared snippet; `required-tags.rego` fails any plan with an untagged taggable resource. `service` and `env` are activated as cost-allocation tags at bootstrap.
3. **Policy engine**: **conftest (OPA/rego) on `terraform show -json` plan output** — chosen over checkov because these are bespoke platform invariants, not generic CIS checks. `tflint` runs too (cheap, catches provider-arg errors pre-plan). Deny: missing tags, dangerous resource types, backend-key/dir mismatch, any delete action on prod stateful resources outside `destroy-service.yml`. Warn→gate: raw `aws_*` resources outside catalog modules (the escape hatch, §8).
4. **Stateful protection**: `prevent_destroy` + native deletion protection on prod DynamoDB, upload buckets, (later) RDS; the shared Cognito pool carries `prevent_destroy` in foundations and its deletion is denied to the services role outright.
5. **Plan visibility**: every plan posts a sticky PR comment (create-or-update) with the resource-change summary and the conftest verdict — the "reviewer" that the CI-as-reviewer policy promises, readable from a phone.

---

## 3. CI/CD workflows

### 3.1 `deploy.yml` — the main path

Triggers: `push` (all branches) + `pull_request`. Concurrency `deploy-<slug>-<env>`, queued not cancelled.

```
detect → per changed service (matrix, fail-fast: false, max-parallel: 3):
  scope = detect-changes.mjs        # diff vs before-SHA/merge-base → {slug, scope: infra|app|both}
  ├─ [scope includes infra, or no state exists yet]
  │    terraform init (computed key) → validate → tflint → plan -out
  │    → conftest on plan JSON → sticky PR comment → apply
  ├─ app build:   svc.mjs build <slug>     # docker build+push / lambda zip / static OUT_DIR
  ├─ app verify:  svc.mjs verify <slug>    # fail-closed; accumulate ALL failures; one report
  ├─ app deploy (fast path, §3.2):
  │    fargate: register task-def revision → update-service → wait services-stable
  │    lambda:  update-function-code → wait function-updated
  │    static:  s3 sync --delete → cloudfront invalidation
  ├─ secrets preflight: manifest secrets exist in SSM? → set PENDING_SECRETS (§4.1)
  ├─ smoke:  svc.mjs smoke <slug> --env <env>   # runtime contract against the live URL
  └─ report: job summary + PR comment: URL, smoke verdict, pending secrets + exact fix commands

on main: same pipeline with env=prod (merge implies the preview ran green)
```

- **Change detection is registry-derived, never hand-maintained.** `detect-changes.mjs` reads `services.config.json` dirs against `git diff --name-only`. A change under `platform/modules/<m>/` maps to every service whose manifest lists capability `<m>`. This designs out the `sites` repo's sharpest silent failure — "a slug missing from the `paths:` list never redeploys, and nothing reports that." `platform/foundations/**` routes to `foundations.yml` instead.
- **Failure isolation**: unlike a Pages deploy (one artifact, all-or-nothing), services deploy independently — one red service never blocks another.

### 3.2 The two-phase infra/app split

Terraform owns the *skeleton*; CI owns the *payload*. The fargate module deploys a placeholder image on first create and ignores subsequent image changes (`lifecycle ignore_changes` on the container image); the lambda module ignores `source_code_hash`; static-site owns the bucket, not its objects. An app-only change — **the common case for an iterating agent** — is build → push → update-code/sync → smoke: **2–4 minutes, no plan, no state lock.** Infra changes take the full plan → policy → apply path; `scope: both` runs infra first, then the payload lands.

### 3.3 The other workflows

| Workflow | Trigger | Behavior |
|---|---|---|
| `foundations.yml` | PR touching `platform/foundations/**`: plan + conftest + comment. Push to main: apply | Apply runs in GitHub environment `foundations` with **required reviewer = owner** — the one deliberate human gate, because this stack is the blast-radius core and changes are rare. Tunable to auto later. |
| `teardown-preview.yml` | `pull_request: closed`, branch `delete`, nightly cron | destroy per §2.4; cron leg runs the orphan sweeper |
| `destroy-service.yml` | `workflow_dispatch(slug, confirm)` | refuses unless `confirm == slug`; destroys previews, then prod. Deletion-protected data resources require a **second** dispatch with `force-stateful: true` after a committed manifest change lifts protections — a two-key destroy for data. |
| `health.yml` | daily cron + dispatch | smoke-all prod, `describe-alarms` for ALARM state, cost snapshot; the job summary is the daily fleet status page; failures → SNS email (and, phase 5, wake a triage session) |

---

## 4. The zero-back-and-forth machinery

### 4.1 Secrets vault + the pending-secrets degradation contract

- **Store**: SSM Parameter Store SecureStrings — `/platform/secrets/<name>` for platform-wide one-timers (`google-oauth-client-id`, `google-oauth-client-secret`, `anthropic-api-key`, …) and `/services/<slug>/<env>/secrets/<name>` for service-specific ones. SSM over Secrets Manager: $0 vs $0.40/secret/mo, and a personal platform needs no rotation machinery.
- **Wiring**: manifest `secrets: [...]`; modules inject via ECS `secrets` (valueFrom) / Lambda resolved at init — never plaintext in task definitions.
- **Preflight, not blocker.** The deploy job checks secret *existence* (values never printed). A missing secret does **not** fail the deploy: the service ships **degraded** with `PENDING_SECRETS=<names>` in its environment, and the scaffolder-emitted middleware makes routes that depend on a pending secret return a styled 503 "awaiting configuration: `<name>`" while everything else works. Smoke marks those checks `SKIPPED(pending-secret)` — the run is green-with-warning.
- **The receipt**: the job summary and PR comment print, per missing secret, the exact paste-ready command and console URL:
  `aws ssm put-parameter --name /platform/secrets/<name> --type SecureString --value '<paste>'`.
  The owner pastes one command from their phone; the next deploy (or the daily health run) picks it up and the service goes whole. This is the `sites` scaffolder's `!` ledger state, generalized to runtime.

### 4.2 Google OAuth — killing the chicken-and-egg

The honest constraint: Google requires **exact** redirect URIs, forbids wildcards, and exposes no API for managing them (§ sources above). Per-service Google registration can never be automated. Therefore: **never show Google a per-service URL.**

**Chosen pattern: one shared Cognito user pool with hosted domain `auth.apps.jackhammons.com`; Google federates into Cognito; each service is a Cognito app client.**

- Google's redirect URI list contains exactly **one entry, forever**: `https://auth.apps.jackhammons.com/oauth2/idpresponse`. Registered once at bootstrap; client ID/secret land in `/platform/secrets/google-oauth-*`.
- Per-service auth is a Cognito **app client** whose callbacks (`https://<fqdn>/auth/callback`) are pure Terraform — the `auth-client` module adds them with zero human involvement, for prod and every preview alike.
- Services speak standard OIDC to Cognito (issuer `https://cognito-idp.us-west-2.amazonaws.com/<pool-id>`); the scaffolder emits the OIDC glue so the agent never hand-rolls auth.
- Accepted trade-offs: one shared user directory across services (for a personal platform, arguably a feature — one login everywhere); mediocre Cognito hosted-UI branding (services pass `identity_provider=Google` to skip straight to Google and never show the Cognito page); the pool is a precious stateful foundation resource (`prevent_destroy`, deletion denied to the deploy role).
- **What stays manual, exactly once, ever**: Google Cloud project + consent screen + client at bootstrap (~15 min). Per-service manual steps: **zero.**

### 4.3 The session workflow, end to end

What a Claude Code session does for "build me X":

1. `node scripts/new-service.mjs <slug> --tier fargate --cap auth-client --cap bucket-uploads --cap db-dynamodb "Name" "tagline"` — emits an app skeleton (hello-world serving on `$PORT` with a health route, OIDC glue, pending-secrets middleware, JSON logger), `infra/` composing the named modules, a smoke stub, and patches every registration point (registry, doc tables) with the three-state ledger (`+` applied / `=` already / `!` manual — never aborting after files are written).
2. Commit and push the branch → **the preview deploys before any real code exists** (the `sites` "deploys as-is" doctrine). If hello-world isn't green, fix the platform, not the app.
3. Write the actual application; push; watch CI; read failures from job logs.
4. Verify the preview like a user: `smoke.mjs` against the live URL, plus Playwright (curl-down-and-serve if the sandbox blocks direct browsing — a `sites` lesson).
5. Merge own branch to main — policy-permitted: green preview + green smoke *are* the reviewer. Watch the prod deploy; curl the prod URL for the expected content. **Say what is deployed, not what is written.**
6. Report: prod URL, smoke summary, pending secrets (if any) with paste-ready commands, and the idle-cost estimate from the module READMEs.

What the platform provides so a session can self-serve: the `svc.mjs` subcommands (all runnable locally), the GitHub CLI/MCP it already has, smoke conventions, readable SSM foundations parameters, and the **read-only debug identity** — IAM user `claude-debug` (key in the Claude Code environment) with CloudWatch Logs read, describe on ECS/ELB/Lambda/API GW/DynamoDB, Cost Explorer read, S3 list; explicit deny on all writes, on `*/secrets/*` parameters, and on state-bucket reads.

The `sites` agent-in-CI safety rules carry over verbatim: never mention a tool the agent cannot run; any CI step an agent influences is `continue-on-error` with a separate deterministic step deciding the run via artifact fingerprints; preflight credential probes; measured (not guessed) budgets.

### 4.4 Lifecycle operations as prompts

| Prompt | Mechanism |
|---|---|
| "update X" | branch → preview → merge — same loop as create, minus the scaffold |
| "pause X" | manifest `prod.desiredCount: 0` (fargate) — committing it deploys it; static/lambda have nothing to pause; resume is the reverse |
| "destroy X" | session dispatches `destroy-service.yml` (`-f slug=X -f confirm=X`), then a PR removing the directory + registry entry |
| "what is X costing" | `cost-report.mjs` via debug creds → per-service table from Cost Explorer tag filters |

---

## 5. Operations

- **Alarms**: each compute module bakes in a minimal set (fargate: running < desired for 5m, target 5xx rate; lambda: sustained errors, throttles; static: CloudFront 5xx) → `svc-alarms` SNS → email as the always-on channel. The *intelligent* channel is `health.yml`: its daily job summary (smoke results, alarm states, cost delta) is the fleet status page, and in phase 5 a failure wakes a Claude triage session that reads logs with the debug role and files an issue with findings — **agents read and report; deterministic workflows act.**
- **Logs**: one group per service+env, `/svc/<slug>/<env>`, 30-day retention (previews 7), JSON lines carrying `service`/`env`/`reqId` as the scaffolded logger's contract.
- **Runbooks**: per-service `CLAUDE.md`, scaffolded with a runbook skeleton (URLs, log group names, a "things that will bite you" section) — the lessons-ledger pattern kept per service so the root CLAUDE.md stays platform-only.

---

## 6. Bootstrap sequence (one-time; ~2.5–4 hours human + agent)

| # | Step | Who | ~Time |
|---|---|---|---|
| 1 | Account hygiene: root MFA, no root keys, admin identity via IAM Identity Center, enable Cost Explorer + cost-allocation tags, account-level S3 public-access block | human | 30 min |
| 2 | Coarse AWS Budget now ($50/mo, email) — foundations refines it later | human | 5 min |
| 3 | Create `jackchammons/services`; repo settings: allow auto-merge, delete-branch-on-merge; GitHub environment `foundations` with required reviewer = self | human | 10 min |
| 4 | `bootstrap/seed`: local `terraform apply` with admin creds → state bucket + OIDC provider + bootstrap role; then `init -migrate-state` moves seed state into the bucket. Everything after this deploys via Actions | human (agent-drafted) | 20 min |
| 5 | After the first foundations apply creates the zone: copy the 4 NS records for `apps.jackhammons.com` into the parent `jackhammons.com` DNS; ACM then validates automatically | human | 10 min + propagation |
| 6 | Google Cloud: project, OAuth consent screen (external, published), client with the single Cognito redirect URI; paste ID/secret into `/platform/secrets/google-oauth-*` | human | 15 min |
| 7 | Push foundations; approve the `foundations.yml` apply. Verify: `dig`, ACM issued, ALB serves the default 404 over HTTPS | agent + human approval | 30 min |
| 8 | SES production-access ticket (only when email matters; sandbox is fine to start) | human | 10 min, ~24 h wait |
| 9 | Claude Code environment: `claude-debug` key in env vars, allowed-tools config; commit root CLAUDE.md | human | 15 min |
| 10 | **Acceptance**: from a phone, prompt a session to scaffold `hello` (static tier), push, merge, and curl `https://hello.apps.jackhammons.com` — bootstrap is done when this loop closes hands-free | agent | 30 min |

---

## 7. Cost model

**Foundations baseline (always-on):**

| Item | $/mo |
|---|---|
| Shared ALB ($16.43 + ~1 LCU) | ~$19 |
| Route 53 hosted zone | $0.50 |
| State bucket, logs, SSM, ECR storage | ~$1–2 |
| Cognito (Lite, < 10k MAU), SES idle, budgets, SNS | ~$0 |
| **Baseline** | **~$21–22** |

The ALB is ~90% of the floor — the price of instant Fargate deploys. A documented foundations flag can tear it down if months pass with no container services; recommended kept.

**Per-service idle**: static ≈ $0.01 · lambda ≈ $0 · fargate (0.25 vCPU / 0.5 GB) ≈ $9.00 on-demand + $3.65 public IPv4 ≈ **$12.7**, or ≈ **$6.3 on Spot**. Previews run Spot with a 7-day TTL cap.

**Worked example — the goal prompt** ("Google OAuth login, user management, document uploads, realtime chat"): tier `fargate` (stateful WebSockets + sessions), composing `auth-client` + `db-dynamodb` (users, messages) + `bucket-uploads`. Chat WebSockets ride the ALB natively — no extra module. Idle: fargate $12.70 + DynamoDB (PITR) ~$0.30 + uploads ~$0.25/10 GB + Cognito $0 ≈ **~$13.3/mo**, on the ~$21 platform floor. One active preview during development adds ~$6.3, prorated.

---

## 8. Risks and mitigations

| Risk | Mitigation |
|---|---|
| State corruption / concurrent applies | S3 versioning (point-in-time state recovery) + native lockfile + per-`slug+env` concurrency groups; orchestrator refuses Terraform < 1.12 |
| One service's apply touching another's state | Computed keys (never typed) + rego key/dir check + state-policy deny on `platform/*`; residual cross-service risk accepted single-owner; graduation = per-service deploy roles |
| Orphaned previews (missed webhooks) | Nightly sweeper diffs state keys against live branches, destroys past `ttlDays`; preview buckets expire objects at 7 days regardless |
| Cost runaway | Budget alerts 50/80/100%; previews on Spot with TTL; `desiredCount` caps in the manifest schema; daily cost-delta line in `health.yml`; no NAT to leak data charges |
| Agent writes raw Terraform outside the catalog | **Escape hatch allowed but taxed**: conftest flags non-catalog resources and fails the run *unless* the manifest carries `escapeHatch: {reason: "…"}` — visible, justified, greppable for promotion into a real module |
| Wildcard cert covers one label only | `preview-name.mjs` is the single source of names and emits single labels; rego denies any record deeper than one label under the zone |
| ALB listener rule limit (~100) | ~2 rules/service ⇒ comfortable to ~40 services; `health.yml` reports the count; graduation: second ALB, or move low-traffic services to the lambda tier |
| Single-account blast radius | Permission boundary + explicit denies + human-gated foundations applies + CloudTrail; graduation: AWS Organizations with this account as the workloads account — nothing assumes the account ID beyond SSM params |
| Loss of the shared Cognito pool | `prevent_destroy`, deletion protection, and `DeleteUserPool` denied to the services role entirely |
| Agent self-merge ships a bad prod | Smoke = runtime contract, not artifact presence; prod smoke failure alarms; previous task-def revision kept for one-command rollback (`svc.mjs rollback <slug>`); per-service manifest flag can restore required-PR-review |

---

## 9. Phased build plan

| Phase | Delivers | Contents | Est. sessions |
|---|---|---|---|
| 1 | **Prompt → live hello-world URL from a phone** | seed stack; foundations *minus* ALB/ECS/Cognito (OIDC, state, zone, certs, budget); `static-site` module; registry + `svc.mjs` + `new-service.mjs` (static tier); `deploy.yml` static path incl. previews + teardown; root CLAUDE.md | 3–4 |
| 2 | Dynamic apps | VPC, ALB, ECS cluster into foundations; `web-app-fargate`; the docker fast path; conftest policies; preview sweeper | 3–4 |
| 3 | Serverless + data | `api-lambda`, `db-dynamodb`, `bucket-uploads`, `queue`, `cron`; secrets vault + pending-secrets contract | 2–3 |
| 4 | Auth + realtime + email | shared Cognito + Google IdP; `auth-client`; scaffolder OIDC glue; `realtime-websocket`; `email-sender`. **Acceptance = the goal prompt, hands-free** | 3–4 |
| 5 | Operational maturity | `health.yml`, alarm wiring, `cost-report.mjs`, rollback, pause/destroy polish, triage cron session | 2–3 |

Phase 1's acceptance test is the platform's reason to exist, run from a phone: *"Create a static site that says hello and deploy it"* → a live URL, no human touch. Every later phase widens the catalog without ever changing that loop.

---

## Appendix: what this design inherits from `sites`

| `sites` mechanism | Generalization here |
|---|---|
| `sites.config.json` registry → one orchestrator | `services.config.json` → `svc.mjs` |
| `OUT_DIR` env contract (standalone-runnable + orchestratable) | `SERVICE_SLUG`/`SERVICE_ENV`/`SERVICE_URL`/`IMAGE_URI`/`OUT_DIR` |
| Scaffolder ships a deploying hello-world before content | `new-service.mjs`, preview green before app code |
| Three-state registration ledger (`+`/`=`/`!`), never abort after writes | same, extended to runtime as the pending-secrets contract |
| Hand-maintained `paths:` filter (documented silent failure) | registry-derived `detect-changes.mjs` — designed out |
| Verify gates: fail-closed, accumulate all failures, check the runtime contract | `verify` (artifact) + `smoke` (live URL) per service |
| `--only/--skip` refused when `CI` set (partial-deploy guard) | computed state keys + per-env concurrency; partial ops structurally impossible |
| Agent behind deterministic validator/applier, never in the deploy path | agent proposes on branches; OIDC-only applies; conftest + smoke gate the merge |
| CNAME emitted from the registry (config lives in the artifact) | all DNS/domain config in Terraform from the registry |
| CLAUDE.md lessons ledger, inline YAML rationale | root + per-service CLAUDE.md, `escapeHatch.reason`, comments with receipts |
