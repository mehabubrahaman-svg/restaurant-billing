/**
 * GATT identifiers of the RestroOS Hub service. Generated once (random v4 base
 * `c8ef9d4e-26b7-4e9e-97bd-541662ebe8e4`, first group numbered per attribute)
 * and fixed forever: tablets in the field filter on them, so never change them.
 * Web Bluetooth requires lowercase, which is how they are written here.
 */
export const BLE_SERVICE_UUID = 'c8ef0001-26b7-4e9e-97bd-541662ebe8e4';

export const BLE_CHARACTERISTIC_UUIDS = {
  /** read: JSON `BleHubInfo` (LAN URLs, CA fingerprint, protocol version). */
  hubInfo: 'c8ef0002-26b7-4e9e-97bd-541662ebe8e4',
  /** read: JSON `BlePairing` (rotating one-time nonce, same as the on-screen QR). */
  pairing: 'c8ef0003-26b7-4e9e-97bd-541662ebe8e4',
  /** write (with or without response): frames of request messages, tablet → Hub. */
  cmdIn: 'c8ef0004-26b7-4e9e-97bd-541662ebe8e4',
  /** notify: frames of responses and events, Hub → tablet. */
  evtOut: 'c8ef0005-26b7-4e9e-97bd-541662ebe8e4',
} as const;

export type BleCharacteristicName = keyof typeof BLE_CHARACTERISTIC_UUIDS;

/** Version of the frame format and envelopes below; advertised in `hub-info.protocol`. */
export const BLE_PROTOCOL_VERSION = 1;
