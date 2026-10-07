export const FONT_GLYPHS = Object.fromEntries([
  'claude', 'codex', 'opencode', 'omp', 'cline', 'mastracode', 'kimi', 'kilo', 'maki', 'pi', 'hermes', 'cursor',
  'copilot', 'deepseek', 'gemini', 'gpt', 'qwen', 'grok', 'agy', 'kiro', 'amp', 'devin', 'qodercli', 'glm', 'kimchi', 'muse', 'crush', 'letta'
].map((name, index) => [name, String.fromCodePoint(0xe1a0 + index)]))
