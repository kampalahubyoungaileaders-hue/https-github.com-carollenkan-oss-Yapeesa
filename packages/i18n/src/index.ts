import { programme } from './programme';
import { finalShareout } from './shareout';
import { audit } from './audit';
import { authenticatorRecovery } from './authenticatorRecovery';
import { staff } from './staff';
import { reviews } from './reviews';
import { secure } from './secure';
import { web } from './web';
const en = {
  ...programme,
  ...web,
  ...finalShareout,
  ...secure,
  ...reviews,
  ...staff,
  ...authenticatorRecovery,
  ...audit,
  appName: 'Yapesa',
  tagline: 'Digital records for groups, lenders and SACCOs.',
  phase: 'Foundation · Phase 0',
  status: 'The application foundation is ready for development.',
  next: 'Financial records and sign-in will be added in later phases.',
} as const;
export type MessageKey = keyof typeof en;
export type Locale = 'en';
export function t(key: MessageKey, locale: Locale = 'en'): string {
  const messages = { en };
  return messages[locale][key];
}
export {
  saccoText,
  saccoFieldLabels,
  saccoOperationLabels,
  saccoResourceLabels,
} from './sacco';
