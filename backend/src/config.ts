export const config = {
  port: Number(process.env.PORT ?? 4000),
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  // Local development starts useful; Vercel/Neon starts with a clean roster
  // unless a preview/demo deployment explicitly opts into seed data.
  seedDemoData: (process.env.SEED_DEMO_DATA ?? (process.env.VERCEL ? '0' : '1')) !== '0',
  /** Local demo convenience. Never permit an environment flag to wipe Vercel/Neon. */
  resetDatabaseOnStart:
    !process.env.VERCEL && (process.env.RESET_DATABASE_ON_START ?? '0') === '1',
  /**
   * Bootstrap convenience: new sign-ups are treated as verified so the demo
   * flow works end to end. Turn this off the moment real requesters are on the
   * network — only verified veterans should ever be matched.
   */
  autoVerifyProviders: (process.env.AUTO_VERIFY_PROVIDERS ?? '1') !== '0',
  /** Development-only OTP. Replace the mock auth routes with Twilio Verify before production. */
  mockOtpCode: process.env.MOCK_OTP_CODE ?? '123456',
  /**
   * Demo mode: a booking does not consume the veteran's availability block, and
   * a veteran already booked at that hour can be matched again. It exists so a
   * live demo can fire the same request repeatedly and keep getting a driver,
   * instead of exhausting the roster after one booking each.
   *
   * Unlike `seedDemoData`, this is deliberately NOT gated on `VERCEL`: the
   * hosted deployment is what gets demoed, so it defaults on there too. It
   * allows double-booking a real person, so set `DEMO_REUSABLE_SLOTS=0` the
   * moment this stops being a demo. Startup logs which mode is active.
   */
  demoReusableSlots: (process.env.DEMO_REUSABLE_SLOTS ?? '1') !== '0',
};
