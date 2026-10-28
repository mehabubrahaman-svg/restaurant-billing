/**
 * Bluetooth LE contract between the Hub and tablets (docs/05 §4): GATT UUIDs,
 * the frame codec, envelopes and the route allow-list. Platform-neutral: runs
 * in browsers, Node and Capacitor (no `node:` imports, no Buffer).
 */
export * from './assembler';
export * from './compression';
export * from './frame';
export * from './message';
export * from './routes';
export * from './schemas';
export * from './uuids';
