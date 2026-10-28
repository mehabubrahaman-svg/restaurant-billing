/** A partial update as it arrives from a request schema: absent and `undefined` both mean "keep". */
export type Patch<T> = { [K in keyof T]?: T[K] | undefined };
