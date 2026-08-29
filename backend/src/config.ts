export const config = {
  port: Number(process.env.PORT ?? 4000),
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  seedDemoData: (process.env.SEED_DEMO_DATA ?? '1') !== '0',
  /**
   * Bootstrap convenience: new sign-ups are treated as verified so the demo
   * flow works end to end. Turn this off the moment real requesters are on the
   * network — only verified veterans should ever be matched.
   */
  autoVerifyProviders: (process.env.AUTO_VERIFY_PROVIDERS ?? '1') !== '0',
  /** Development-only OTP. Replace the mock auth routes with Twilio Verify before production. */
  mockOtpCode: process.env.MOCK_OTP_CODE ?? '123456',
};
