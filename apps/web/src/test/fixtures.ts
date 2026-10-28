import type { Device, IndianState } from '@restroos/contracts';
import { initialForm, type SetupForm } from '../features/setup/setup-form';

export const STATES: IndianState[] = [
  {
    gstStateCode: '19',
    name: 'West Bengal',
    region: 'EAST',
    rolloutWave: 1,
    liquorPermitted: true,
    liquorSeparateInvoice: true,
    localLocales: ['bn', 'en', 'hi'],
  },
  {
    gstStateCode: '10',
    name: 'Bihar',
    region: 'EAST',
    rolloutWave: 1,
    liquorPermitted: false,
    liquorSeparateInvoice: false,
    localLocales: ['hi', 'en'],
  },
  {
    gstStateCode: '13',
    name: 'Nagaland',
    region: 'NORTH_EAST',
    rolloutWave: 1,
    liquorPermitted: false,
    liquorSeparateInvoice: false,
    localLocales: ['en'],
  },
];

export const VALID: SetupForm = {
  ...initialForm('bn-IN'),
  orgName: 'Spice Route',
  branchName: 'Park Street',
  branchCode: 'kol1',
  stateCode: '19',
  liquorEnabled: true,
  vatTin: '19123456789',
  exciseLicenceNo: 'EX/2026/77',
  vatPercent: '20',
  surchargePercent: '2.5',
  separateInvoice: true,
  receiptLanguages: ['bn', 'en'],
  adminUsername: 'Owner',
  adminFullName: 'Sumit Das',
  adminPassword: 'Kolkata#Biryani2026',
  adminPasswordConfirm: 'Kolkata#Biryani2026',
  adminPin: '2580',
  adminPinConfirm: '2580',
  backupPassphrase: 'mango lassi at noon',
  backupPassphraseConfirm: 'mango lassi at noon',
  backupAcknowledged: true,
  setupCode: 'WIZARD01',
};

export const DEVICE_ID = '55555555-5555-4555-8555-555555555555';

export function makeDevice(overrides: Partial<Device> = {}): Device {
  return {
    id: DEVICE_ID,
    name: 'Captain tab 1',
    kind: 'CAPTAIN',
    platform: 'ANDROID',
    lastSeenAt: '2026-10-28T08:00:00.000Z',
    pairedAt: '2026-10-20T06:30:00.000Z',
    isActive: true,
    version: 1,
    ...overrides,
  };
}
