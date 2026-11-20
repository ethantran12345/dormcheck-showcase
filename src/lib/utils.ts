import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Logs only in development; no-op in production to avoid exposing debug data. */
// eslint-disable-next-line no-console -- the one sanctioned console.log: dev-only by construction.
export const devLog = import.meta.env?.DEV ? (...args: unknown[]) => console.log(...args) : () => {};
