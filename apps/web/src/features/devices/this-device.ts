import { isApiError, NetworkError } from '../../api/client';
import { api } from '../../api/endpoints';
import { useDeviceStore } from '../../stores/device-store';

export const DEVICE_ME_KEY = ['device', 'me'] as const;

/**
 * Asks the Hub which device this browser is (GET /devices/me) and puts the
 * answer in the device store before any route renders, so a KDS opens full
 * screen straight away. A Hub that cannot be asked keeps the last known kind.
 */
export async function fetchThisDevice() {
  const store = useDeviceStore.getState();
  try {
    const device = await api.devices.me();
    if (device.isActive) store.adopt(device);
    else store.markUnpaired();
    return device;
  } catch (error) {
    if (isApiError(error) && error.status >= 400 && error.status < 500) {
      store.markUnpaired();
      return null;
    }
    store.markUnknown();
    if (error instanceof NetworkError) return null;
    throw error;
  }
}
