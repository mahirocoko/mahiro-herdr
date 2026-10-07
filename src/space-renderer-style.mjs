import { FONT_GLYPHS } from './agent-icons.mjs'

// Radar vendor hues; Mahiro-approved inline per-pane status, not activity sorting.
export const VENDOR_COLORS = {
  claude: '#d97757', gemini: '#4285f4', kimi: '#1783ff', deepseek: '#4d6bfe', qwen: '#615ced',
  kiro: '#9046ff', cline: '#586876', kilo: '#9a9808', kimchi: '#ff521d', muse: '#0082fb', crush: '#ff388b'
}
export const AGENT_SLOT_COUNT = 8
export const INLINE_TOKENS = Array.from({ length: AGENT_SLOT_COUNT }, (_, index) => [`mh_ws_a${index}_status`, `mh_ws_a${index}_name`]).flat()
export const RENDERER_TOKENS = INLINE_TOKENS

const STATUS_RULES = [
  ...['⣷', '⣯', '⣟', '⡿', '⢿', '⣻', '⣽', '⣾'].map(mark => `{ equals = "${mark}", fg = "#C78A1F", bold = true }`),
  '{ equals = "✓", fg = "#64CF64" }', '{ equals = "?", fg = "#F1689F", bold = true }',
  '{ equals = "○", fg = "#A5A8AB" }', '{ equals = "◇", fg = "#BEBEEE" }'
]
const NAME_RULES = Object.entries(VENDOR_COLORS).map(([vendor, color]) => `{ equals = "${FONT_GLYPHS[vendor]} ${vendor}", fg = "${color}" }`)
const inlineCells = index => [
  `{ token = "$mh_ws_a${index}_status", rules = [${STATUS_RULES.join(', ')}] }`,
  `{ token = "$mh_ws_a${index}_name", fg = "#E8E8ED", rules = [${NAME_RULES.join(', ')}] }`
]
export const SPACE_RENDERER_ROWS = [
  ['"workspace"'],
  ...Array.from({ length: AGENT_SLOT_COUNT }, (_, index) => inlineCells(index))
].map(row => {
  if (row.length > 16) throw new Error('Space renderer row exceeds native token limit')
  return `  [${row.join(', ')}],`
}).join('\n')
