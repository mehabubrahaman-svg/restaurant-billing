/**
 * The subset of the Web Bluetooth API the measurement page uses
 * (https://webbluetoothcg.github.io/web-bluetooth/). TypeScript's DOM lib
 * does not ship it, and a hand-written subset avoids a types dependency.
 */

interface Navigator {
  readonly bluetooth?: Bluetooth;
}

interface Bluetooth {
  getAvailability(): Promise<boolean>;
  requestDevice(options: BluetoothRequestDeviceOptions): Promise<BluetoothDevice>;
}

interface BluetoothRequestDeviceOptions {
  filters?: { services?: string[]; name?: string; namePrefix?: string }[];
  optionalServices?: string[];
  acceptAllDevices?: boolean;
}

interface BluetoothDevice extends EventTarget {
  readonly id: string;
  readonly name?: string;
  readonly gatt?: BluetoothRemoteGATTServer;
}

interface BluetoothRemoteGATTServer {
  readonly connected: boolean;
  readonly device: BluetoothDevice;
  connect(): Promise<BluetoothRemoteGATTServer>;
  disconnect(): void;
  getPrimaryService(service: string): Promise<BluetoothRemoteGATTService>;
}

interface BluetoothRemoteGATTService {
  readonly uuid: string;
  getCharacteristic(characteristic: string): Promise<BluetoothRemoteGATTCharacteristic>;
}

interface BluetoothCharacteristicProperties {
  readonly read: boolean;
  readonly write: boolean;
  readonly writeWithoutResponse: boolean;
  readonly notify: boolean;
}

interface BluetoothRemoteGATTCharacteristic extends EventTarget {
  readonly uuid: string;
  readonly value?: DataView;
  readonly properties: BluetoothCharacteristicProperties;
  readValue(): Promise<DataView>;
  writeValueWithResponse(value: BufferSource): Promise<void>;
  writeValueWithoutResponse(value: BufferSource): Promise<void>;
  startNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
  stopNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
}
