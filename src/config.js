export const VENDORS = [
  { label: 'Anthropic (Direct)', value: 'anthropic' },
  { label: 'Amazon Bedrock', value: 'bedrock' },
  { label: 'Google Vertex AI', value: 'vertex' },
  { label: 'Z.AI', value: 'zai' },
  { label: 'MiniMax', value: 'minimax' },
];

export const MODELS = {
  anthropic: [
    { label: 'Claude Sonnet 4', value: 'claude-sonnet-4-20250514' },
    { label: 'Claude Opus 4', value: 'claude-opus-4-20250514' },
    { label: 'Claude 3.5 Sonnet', value: 'claude-3-5-sonnet-20241022' },
  ],
  bedrock: [
    { label: 'Claude Sonnet 4', value: 'anthropic.claude-sonnet-4-20250514-v1:0' },
    { label: 'Claude 3.5 Sonnet', value: 'anthropic.claude-3-5-sonnet-20241022-v2:0' },
  ],
  vertex: [
    { label: 'Claude Sonnet 4', value: 'claude-sonnet-4@20250514' },
    { label: 'Claude 3.5 Sonnet', value: 'claude-3-5-sonnet-v2@20241022' },
  ],
  zai: [
    { label: 'GLM 4.6', value: 'glm-4.6' },
  ],
  minimax: [
    { label: 'MiniMax-M2.1', value: 'MiniMax-M2.1' },
    { label: 'MiniMax-01', value: 'minimax-01' },
  ],
};
