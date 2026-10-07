# Agent icon font provenance

Source: https://github.com/hhdebb/herdr-radar at commit `1ba8cc4a3900191c9f1f4f850398c7dd10212df2`.
Copied unchanged: `dist/HerdrAgentIconsMax-Regular.ttf`.
SHA-256: `1b8199496b223d0761fc3a49d5b2510bda38deab82cb3758bf3980495bf05272`.

Included source LICENSE and THIRD_PARTY_NOTICES.md preserve attribution and the brand/source inventory. This bundle contains only icon fonts, not the patched JetBrains Mono font mentioned in the upstream notice; no JetBrains outlines or OFL font are redistributed here. Symbols identify vendors and do not imply affiliation or endorsement. The unmodified input lacks Letta; the derivative below adds its separately attributed official mark, never another vendor's logo.

The generated `MahiroHerdrAgentIcons-Regular.ttf` is a derivative: original Radar glyph outlines/metrics are retained, family is renamed, and U+E1BB adds the literal front-frame pixel geometry from `letta-ai/letta-code` `src/cli/components/AnimatedLogo.tsx` at `f898fda60932b34ddbcfd389ea414515b0a5d272` (Apache-2.0). Its source grid is reproduced in `tools/build-agent-icon-font.py`; `LETTA-APACHE-LICENSE` accompanies the adapted mark. No trademark endorsement is implied. Derivative SHA-256: `ed16934c7231b09b266f754569355236a3d475d530643c14a1f312226c6653e1`. Build-only tool: fonttools 4.59.2, no runtime dependency. E1BB was unused in the pinned source.

Mahiro Herdr's renderer/runtime are separately implemented, not a vendored Radar runtime. Font bytes/mapping are pinned together. Original font remains as reproducible input; installed mapping uses only the renamed derivative family. Native user-visible rendering still requires terminal reload and human acceptance.
