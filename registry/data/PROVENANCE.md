# data/pricing-map.json — provenance

Copied manually from `vendor/litellm-upstream/model_prices_and_context_window.json`
at the pinned SHA recorded in `upstream/litellm.pin.json` (`de706a35a6`, pinned
2026-07-30). 2,986 model entries at time of copy.

Source: LiteLLM (https://github.com/BerriAI/litellm),
Copyright (c) 2023 Berri AI, MIT License.

NOTE (Phase 0 gap): the automated extraction script (`scripts/sync-upstream.ts`
with provenance header + diff output) was not built before Phase 1 started, so
this snapshot was copied by hand per implementation-plan §9. Replace this manual
copy with the sync script's output when Phase 0 tooling lands; until then, any
pin bump must re-copy this file and update this note.

Key naming (verified against the snapshot):
- Gemini API models: `gemini/<model>` (bare ids resolve to vertex_ai pricing — do not use)
- OpenAI models: bare `<model>`
- DeepSeek models: `deepseek/<model>` (bare ids also present)
