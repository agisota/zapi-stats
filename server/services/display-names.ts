export const DISPLAY_NAMES: Record<string, string> = {
  'tb': 'agisota',
  'tim': 'timofeyrsk',
  'pp': 'sainquat',
  'tb-hermes': 'agisota (hermes)',
  'Alina': 'kruzjochek',
  'sie': 'sieanomalie',
  'polina': 'npmnv',
  'opencode': 'npmnv (hermes)',
  'Vitaly': 'vi_aku',
  'agisota-9f6dd86ec9e9-pzdrk-59c8beca': 'GTAlexey',
  'Polina-2': 'Polina',
  'neuron-chickiebombonie': 'neuron_chickiebomboniebot',
  'sainquat (2)': 'sainquat',
};

export function getDisplayName(keyName: string): string {
  const mapped = DISPLAY_NAMES[keyName] ?? DISPLAY_NAMES[stripLeadingAt(keyName)];
  return stripLeadingAt(mapped ?? keyName);
}

export function stripLeadingAt(name: string): string {
  return name.trim().replace(/^@+/, '');
}
