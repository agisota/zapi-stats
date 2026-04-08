export const DISPLAY_NAMES: Record<string, string> = {
  'tb':         '@agisota',
  'tim':        '@timofeyrsk',
  'pp':         '@sainquat',
  'tb-hermes':  '@agisota (hermes)',
  'Alina':      '@kruzjochek',
  'sie':        '@sieanomalie',
  'polina':     '@npmnv',
  'opencode':   '@npmnv (hermes)',
  'Vitaly':     '@vi_aku',
};

export function getDisplayName(keyName: string): string {
  return DISPLAY_NAMES[keyName] ?? keyName;
}
