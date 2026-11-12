import { getMeta, setMeta } from '../../data/db';
import type { MorningConfig } from '../../types';
import { normalizeConfig } from './logic';

const KEY = 'morning.config';

export async function getMorningConfig(): Promise<MorningConfig> {
  return normalizeConfig(await getMeta<Partial<MorningConfig>>(KEY));
}

export async function saveMorningConfig(config: MorningConfig): Promise<MorningConfig> {
  const clean = normalizeConfig(config);
  await setMeta(KEY, clean);
  return clean;
}
