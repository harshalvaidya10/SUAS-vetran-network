export const config = {
  port: Number(process.env.PORT ?? 4000),
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  // Local development starts useful; Vercel/Neon starts with a clean roster
  // unless a preview/demo deployment explicitly opts into seed data.
  seedDemoData: (process.env.SEED_DEMO_DATA ?? (process.env.VERCEL ? '0' : '1')) !== '0',
  /**
   * Bootstrap convenience: new sign-ups are treated as verified so the demo
   * flow works end to end. Turn this off the moment real requesters are on the
   * network — only verified veterans should ever be matched.
   */
  autoVerifyProviders: (process.env.AUTO_VERIFY_PROVIDERS ?? '1') !== '0',
  /**
   * SMS delivery. `mock` prints the code to the log and always uses
   * `MOCK_OTP_CODE`, so local work and the automated checks need no account.
   * `twilio` sends a real text via Programmable SMS.
   */
  smsProvider: (process.env.SMS_PROVIDER ?? 'mock') === 'twilio' ? 'twilio' : 'mock',
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID ?? '',
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN ?? '',
  twilioFromNumber: process.env.TWILIO_FROM_NUMBER ?? '',
  /** The predictable code used when `smsProvider` is `mock`. */
  mockOtpCode: process.env.MOCK_OTP_CODE ?? '123456',
  /** How long a texted code stays valid. */
  otpTtlMinutes: Number(process.env.OTP_TTL_MINUTES ?? 10),
  /** Wrong guesses allowed before the code is burned. */
  otpMaxAttempts: Number(process.env.OTP_MAX_ATTEMPTS ?? 5),
  /** Seconds a caller must wait before another text goes out. */
  otpResendCooldownSeconds: Number(process.env.OTP_RESEND_COOLDOWN_SECONDS ?? 30),
  /**
   * Key that codes are hashed with. Falls back to a constant so local
   * development works out of the box; set it in any real deployment.
   */
  otpHashSecret: process.env.OTP_HASH_SECRET ?? 'vetnet-local-development-only',
  /**
   * Demo housekeeping: minutes after which a booked ride is treated as finished,
   * completing the booking and handing the availability block back to the
   * driver. Lets a demo fire the same request repeatedly and keep matching,
   * without weakening the locking itself — a block is still claimed atomically
   * and still can't be promised to two riders at once.
   *
   * Set `DEMO_SLOT_RELEASE_MINUTES=0` to switch the simulation off, so blocks
   * stay held until someone actually completes or cancels the ride.
   */
  demoSlotReleaseMinutes: Number(process.env.DEMO_SLOT_RELEASE_MINUTES ?? 5),
};
