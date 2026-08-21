/**
 * Budget for behavior conditioning.
 *
 * The reader caps a single behavior body at 256 KB, and the spawn path checks
 * argv+env against an ARG_MAX-shaped soft cap of the same order
 * (node-spawner.ts). Injecting several full bodies could therefore push a run
 * into E2BIG — a failure that would look like a spawn bug rather than a prompt
 * that got too big. 32 KB is generous for a handful of real behavior specs
 * (the two shipped here are ~1.5 KB each) while leaving the spawn budget
 * comfortably intact.
 */
export const MAX_PREAMBLE_BYTES = 32 * 1024;
