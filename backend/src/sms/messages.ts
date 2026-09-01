/**
 * Every outbound text the network sends, in one place.
 *
 * Separate from the transport so the wording can be tuned without touching
 * delivery, and so the rider-facing messages we will want later (driver
 * assigned, driver arriving) sit beside the driver-facing ones rather than
 * being scattered through the routes.
 */
export const messages = {
  /** Sent to a veteran signing in to manage their commitments. */
  loginCode: (code: string) =>
    `VetNet: your sign-in code is ${code}. It expires shortly. If you didn't ask to sign in, ignore this.`,
};
