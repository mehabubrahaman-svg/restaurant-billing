import { Bonjour } from 'bonjour-service';

export interface MdnsAdvertisement {
  stop(): Promise<void>;
}

/**
 * Advertises the Hub as `_restroos._tcp` on the LAN (docs/01 §6.1) so the
 * pairing screen and native shells can find it without typing an address.
 * Multicast may be blocked on some networks; the pairing QR always works.
 */
export function advertiseHub(input: {
  name: string;
  httpPort: number;
  httpsPort: number;
  caFingerprint: string;
  /** Multicast failures (port 5353 taken, no interface) are reported here, never thrown. */
  onError: (error: unknown) => void;
}): MdnsAdvertisement {
  const bonjour = new Bonjour({}, input.onError);
  const service = bonjour.publish({
    name: input.name,
    type: 'restroos',
    protocol: 'tcp',
    port: input.httpsPort,
    host: 'restro.local',
    txt: {
      http: String(input.httpPort),
      https: String(input.httpsPort),
      fp: input.caFingerprint.replaceAll(':', '').slice(0, 16),
    },
  });
  service.on('error', input.onError);
  return {
    stop: () =>
      new Promise((resolve) => {
        bonjour.unpublishAll(() => {
          bonjour.destroy();
          resolve();
        });
      }),
  };
}
