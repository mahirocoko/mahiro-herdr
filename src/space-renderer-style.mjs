// Radar v1.4.2 vendor hues and Space anatomy; native lifecycle/order remain separate.
export const VENDOR_COLORS = {
  claude: '#d97757', gemini: '#4285f4', kimi: '#1783ff', deepseek: '#4d6bfe', qwen: '#615ced',
  kiro: '#9046ff', cline: '#586876', kilo: '#9a9808', kimchi: '#ff521d', muse: '#0082fb', crush: '#ff388b'
}
export const WORKING_VENDORS = Object.keys(VENDOR_COLORS).slice(0, 9)
export const LOGO_VENDORS = Object.keys(VENDOR_COLORS)
export const RENDERER_TOKENS = [
  'mh_ws_blocked', ...WORKING_VENDORS.map(vendor => `mh_ws_working_${vendor}`), 'mh_ws_working',
  'mh_ws_done', 'mh_ws_idle', 'mh_ws_unknown', 'mh_ws_none',
  ...LOGO_VENDORS.map(vendor => `mh_ws_logo_${vendor}`), 'mh_ws_logo_other'
]

const cell = (token, color, bold = false) => `{ token = "$${token}"${color ? `, fg = "${color}"` : ''}${bold ? ', bold = true' : ''} }`
export const SPACE_RENDERER_ROWS = [
  [cell('mh_ws_blocked', '#F1689F', true), ...WORKING_VENDORS.map(vendor => cell(`mh_ws_working_${vendor}`, VENDOR_COLORS[vendor], true)),
    cell('mh_ws_working', '#C78A1F', true), cell('mh_ws_done', '#64CF64', true), cell('mh_ws_idle'), cell('mh_ws_unknown', '#BEBEEE'), cell('mh_ws_none'), '"workspace"'],
  [...LOGO_VENDORS.map(vendor => cell(`mh_ws_logo_${vendor}`, VENDOR_COLORS[vendor])), cell('mh_ws_logo_other', '#E8E8ED')]
].map(row => {
  if (row.length > 16) throw new Error('Space renderer row exceeds native token limit')
  return `  [${row.join(', ')}],`
}).join('\n')
