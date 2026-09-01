import { config } from '../config.js';

export interface SmsTransport {
  readonly name: string;
  send(to: string, body: string): Promise<void>;
}

/**
 * Development transport: prints the message instead of texting it. The code is
 * the fixed `MOCK_OTP_CODE`, so local testing and the automated checks don't
 * need a phone or a Twilio bill.
 */
const mockTransport: SmsTransport = {
  name: 'mock',
  async send(to, body) {
    console.log(`[mock-sms] to ${to}: ${body}`);
  },
};

/**
 * Twilio Programmable SMS over the REST API. Deliberately plain `fetch` rather
 * than the SDK — it is one form POST with basic auth, and a serverless function
 * is better off without the extra dependency.
 */
const twilioTransport: SmsTransport = {
  name: 'twilio',
  async send(to, body) {
    const { twilioAccountSid, twilioAuthToken, twilioFromNumber } = config;
    if (!twilioAccountSid || !twilioAuthToken || !twilioFromNumber) {
      throw new Error(
        'SMS_PROVIDER=twilio needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER.',
      );
    }

    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${twilioAccountSid}:${twilioAuthToken}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ To: to, From: twilioFromNumber, Body: body }),
      },
    );

    if (!response.ok) {
      // Twilio's message is the useful part; the status alone says nothing.
      const detail = await response.text().catch(() => '');
      throw new Error(`Twilio refused the message (${response.status}): ${detail.slice(0, 300)}`);
    }
  },
};

/**
 * Resolved per call rather than once at import, so the provider can be switched
 * at runtime — which is also the only way the delivery-failure path is
 * testable.
 */
export function smsTransport(): SmsTransport {
  return config.smsProvider === 'twilio' ? twilioTransport : mockTransport;
}
