const NAME_MAP: Record<string, string> = {
  'agisota-9f6dd86ec9e9-pzdrk-59c8beca': 'GTAlexey',
  'Polina-2': 'Polina',
  'neuron-chickiebombonie': 'neuron_chickiebomboniebot',
  'sainquat (2)': 'sainquat',
};

export function displayName(name: string | null | undefined): string {
  if (!name) return '';
  const mapped = NAME_MAP[name] ?? NAME_MAP[stripAt(name)] ?? name;
  return stripAt(mapped);
}

export function stripAt(name: string): string {
  return name.trim().replace(/^@+/, '');
}

export function modelLabel(provider: string | null | undefined, model: string | null | undefined): string {
  if (!model) return 'нет данных';
  if (!provider) return model;
  const normalized = model.startsWith(`${provider}/`) ? model : `${provider}/${model}`;
  return normalized.replace(/^fireworks\/accounts\/fireworks\/models\//, 'fireworks/');
}
