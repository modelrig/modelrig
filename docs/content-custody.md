# Artifact content custody

ModelRig records a **metadata graph** of the work products your pipeline produces —
each artifact's identity, lineage, evaluations, and an integrity **hash** of its bytes.
By default the bytes themselves are **never stored**: the hash proves what existed, and
the content stays wherever you already keep it.

Content custody (E2-C) adds the *option* to store the bytes too — under explicit, per-org
consent. It never changes a default: metadata-only remains the posture until you turn
custody on.

## Two independent axes

Custody and telemetry are **separate switches**. Turning one on says nothing about the other.

| Axis | Question | Values | Where it lives |
|---|---|---|---|
| **Telemetry posture** | Is telemetry captured for optimization at all? | `optimized` · `pure_router` | `orgs.telemetry_posture` (00015) |
| **Content custody posture** | May artifact *bytes* be stored, and where? | `metadata` (default) · `managed` | `orgs.artifact_posture` (00032) |

A `pure_router` org can still enable `managed` custody; an `optimized` org can stay
`metadata`-only. Neither implies the other.

## Content-custody postures

| Posture | Behaviour |
|---|---|
| `metadata` *(default)* | Hash + metadata only. No content object is ever created. The upload-grant endpoint refuses fail-closed (`403`). **This is today's behaviour — nothing changes for an existing org.** |
| `managed` | Content may be uploaded to the ModelRig-owned object store, isolated under a per-org key prefix (`{org_id}/{artifact_id}`). Retention is enforced by the store's lifecycle rules per classification. |

Changing posture to `managed` is an org-owner action. Adding a posture value is a database
migration — a new place bytes may live is reviewed like the authority it is.

## How content moves (managed tier)

Content is stored through a **posture-gated, consented, write-once** path — the bytes never
touch ModelRig's control-plane database, and they never flow through the telemetry exporter
(which has no path to content, structurally and permanently).

1. Your pipeline `save`s an artifact. Its **metadata row** is recorded as always.
2. If the route has opted content **on** *and* the org posture is `managed` *and* the run is
   not `zeroRetention`, the SDK requests an **upload grant** from
   `POST /v1/artifacts/uploads` (a `rig_sk_` key with the `artifact-write` scope).
3. The server authorizes the grant against the artifact's **own** org (never the caller's
   assumed org), enforces the size ceiling, and refuses a second upload for the same
   artifact (content is **immutable — it writes once**). It returns a short-lived presigned
   `PUT`.
4. The SDK uploads the bytes **directly to the object store**. On any refusal or failure it
   **degrades to metadata-only** — a counted, warned skip; it never throws into your run and
   never retries a deterministic refusal.

Reading content back (the console panel, or an `artifact-read` key) mints a short-lived
presigned `GET` the same way. **Presigned URLs and content hashes are never logged.**

### Consent is off by default

Content custody is **opt-in per route** and off unless explicitly configured:

```
MODELRIG_ARTIFACTS=1                 # the artifact namespace (E2) — on by default
                                    #   with a control plane; =0 opts out
MODELRIG_ARTIFACTS_CONTENT=on        # content custody (E2-C) — default off; the
                                    #   metadata flip never turns THIS on
MODELRIG_CONTENT_UPLOAD_URL=…/v1/artifacts/uploads
MODELRIG_CONTENT_API_KEY=rig_sk_…    # must carry the artifact-write scope
MODELRIG_ARTIFACTS_SCRUB=detect      # off | detect | redact | block (default detect)
```

If content is on but the transport is not fully configured, custody stays **off** — a
half-configured custody is refused into the safe default, never silently half-on.

## Scrubbing (before upload)

When content is on, a deterministic scrub pass runs on the bytes **before** they are
uploaded. Findings are recorded as **counts by type, never the matched values** — recording
a value would move the PII into the control plane, the exact thing custody contains.

| Mode | Effect |
|---|---|
| `off` | No scan; upload verbatim. |
| `detect` *(default when on)* | Scan; count findings by type; upload verbatim. |
| `redact` | Upload a **masked** copy as a **superseding version**; the original keeps its own hash and stores no content. |
| `block` | If anything is found, **refuse** the upload (counted). The artifact keeps its metadata + hash; it stores no content. |

Detectors (v1): US SSN (delimited), PAN (Luhn-valid), email, E.164/US phone, labelled MRN.

> **Deterministic ≠ DLP.** These are regex/checksum detectors, not a model. They catch
> well-formed identifiers and **will miss** obfuscated or free-form PII. A clean `detect`
> result is **not** a guarantee of no PII. Model-assisted scrubbing is a later version.

## Zero-retention still wins

A run marked `zeroRetention: true` (or a route requiring `zero_retention`) stores **nothing**
— no metadata, no hash, and **no content**. The refusal is structural: it returns from the
save gate before scrub or any upload grant is even reached. Custody being on does not weaken
it.

## Retention

Retention is enforced by the object store's **lifecycle rules**, keyed to each artifact's
data classification and prefix — native TTL, not a cron. `expires_at` on the metadata row
records the intended horizon; the store is what deletes the bytes.
