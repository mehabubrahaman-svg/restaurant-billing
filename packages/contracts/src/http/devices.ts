import { z } from 'zod';
import { IdSchema } from './common';

export const DeviceKindSchema = z.enum([
  'POS',
  'CAPTAIN',
  'KDS',
  'OWNER',
  'TOKEN_DISPLAY',
  'KIOSK',
]);
export type DeviceKind = z.infer<typeof DeviceKindSchema>;
export const DevicePlatformSchema = z.enum([
  'WINDOWS',
  'LINUX',
  'ANDROID',
  'IOS',
  'IPADOS',
  'OTHER',
]);

/** Public facts about this Hub, for pairing screens and discovery. No auth. */
export const HubInfoSchema = z.object({
  name: z.string(),
  version: z.string(),
  needsSetup: z.boolean(),
  /** LAN addresses devices can use, e.g. http://192.168.1.20:7400 and https://192.168.1.20:7443. */
  urls: z.object({ http: z.array(z.string()), https: z.array(z.string()) }),
  /** SHA-256 fingerprint of the Hub's local certificate authority, "AB:CD:…". Shown on the pairing QR. */
  caFingerprint: z.string(),
  /** mDNS name, e.g. "restro.local". */
  mdnsHost: z.string(),
});
export type HubInfo = z.infer<typeof HubInfoSchema>;

export const DeviceSchema = z.object({
  id: IdSchema,
  name: z.string(),
  kind: DeviceKindSchema,
  platform: DevicePlatformSchema.nullable(),
  lastSeenAt: z.string().nullable(),
  pairedAt: z.string().nullable(),
  isActive: z.boolean(),
  version: z.number().int(),
});
export type Device = z.infer<typeof DeviceSchema>;
export const DevicesResponseSchema = z.object({ data: z.array(DeviceSchema) });
export type DevicesResponse = z.infer<typeof DevicesResponseSchema>;

export const CreatePairingCodeRequestSchema = z.object({
  name: z.string().trim().min(2).max(60),
  kind: DeviceKindSchema,
});
export const PairingCodeResponseSchema = z.object({
  /** 8 characters, shown as text and inside the QR. Single use, valid 10 minutes. */
  code: z.string(),
  expiresAt: z.string(),
  /** What the QR encodes: the device opens this to pair (the code is in the URL). */
  pairUrl: z.string(),
  caFingerprint: z.string(),
});
export type PairingCodeResponse = z.infer<typeof PairingCodeResponseSchema>;

export const PairDeviceRequestSchema = z.object({
  code: z.string().trim().min(6).max(16),
  /** Random id the browser generates once and keeps; lets the Hub recognise a re-pair. */
  fingerprint: z.string().min(16).max(128),
  platform: DevicePlatformSchema.optional(),
});
/**
 * Pairing sets an httpOnly cookie with the device token. Native shells
 * (Capacitor) send the returned token as `X-Device-Token` instead.
 */
export const PairDeviceResponseSchema = z.object({ device: DeviceSchema, deviceToken: z.string() });
export type PairDeviceResponse = z.infer<typeof PairDeviceResponseSchema>;

export const UpdateDeviceRequestSchema = z.object({
  version: z.number().int(),
  name: z.string().trim().min(2).max(60).optional(),
  kind: DeviceKindSchema.optional(),
  /** false unpairs the device: its token stops working immediately. */
  isActive: z.boolean().optional(),
});

export const DEVICE_TOKEN_HEADER = 'x-device-token';

// ---- peripherals (scanners, scales, cash drawers, …) ---------------------------
export const PeripheralSchema = z.object({
  id: IdSchema,
  deviceId: IdSchema.nullable(),
  name: z.string(),
  kind: z.enum([
    'BARCODE_SCANNER',
    'WEIGHING_SCALE',
    'CUSTOMER_DISPLAY',
    'CASH_DRAWER',
    'GUEST_PAGER',
    'CARD_TERMINAL',
  ]),
  connection: z.enum(['USB', 'SERIAL', 'NETWORK', 'BLUETOOTH', 'BLE', 'HID']),
  address: z.string().nullable(),
  isActive: z.boolean(),
  version: z.number().int(),
});
export type Peripheral = z.infer<typeof PeripheralSchema>;
export const PeripheralsResponseSchema = z.object({ data: z.array(PeripheralSchema) });
export type PeripheralsResponse = z.infer<typeof PeripheralsResponseSchema>;
export const SavePeripheralRequestSchema = PeripheralSchema.pick({
  name: true,
  kind: true,
  connection: true,
}).extend({
  deviceId: IdSchema.nullable().default(null),
  address: z.string().trim().max(200).nullable().default(null),
});
export const UpdatePeripheralRequestSchema = SavePeripheralRequestSchema.partial().extend({
  version: z.number().int(),
  isActive: z.boolean().optional(),
});
