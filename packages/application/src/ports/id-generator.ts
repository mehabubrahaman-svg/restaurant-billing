/** Generates globally unique, time-ordered ids (UUIDv7) that are safe to create offline. */
export interface IdGenerator {
  next(): string;
}
