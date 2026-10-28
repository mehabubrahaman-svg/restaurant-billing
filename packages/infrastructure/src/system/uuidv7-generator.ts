import type { IdGenerator } from '@restroos/application';
import { uuidv7 } from 'uuidv7';

export const uuidv7Generator: IdGenerator = { next: () => uuidv7() };
