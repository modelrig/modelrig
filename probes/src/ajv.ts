/**
 * Shared Ajv instance factory for the probe harness — JSON-Schema 2020-12
 * primary, draft-07 still accepted (onboarding-redesign follow-up #1, decision A).
 *
 * This MUST stay in lockstep with the gateway's instance
 * (packages/modelrig/src/run/ajv.ts): the harness enforces conformance during a
 * probe and the gateway enforces it while serving, so a divergence would let a
 * fixture score differently than it serves. `ajv/dist/2020` is the 2020-12
 * instance; it does NOT bundle the draft-07 meta-schema, so we add it explicitly
 * for back-compat with the draft-07 schemas still in the corpus.
 */

import Ajv from "ajv/dist/2020";
import draft7MetaSchema from "ajv/dist/refs/json-schema-draft-07.json";

export function createProbeAjv(): Ajv {
  const ajv = new Ajv({ strict: false, allErrors: true, allowUnionTypes: true });
  ajv.addMetaSchema(draft7MetaSchema);
  return ajv;
}
