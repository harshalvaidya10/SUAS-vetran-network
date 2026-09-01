/**
 * What someone is agreeing to by joining the pilot.
 *
 * Served from `GET /api/v1/catalog` and recorded against the enrolment, so the
 * text a veteran actually saw is the text we can show we asked them to accept.
 * Bump the version whenever the wording changes materially: sign-up sends the
 * version it displayed, and the API refuses a version it no longer serves.
 */
export const PILOT_TERMS_VERSION = '2026-09-01';

export const PILOT_TERMS = {
  version: PILOT_TERMS_VERSION,
  headline: 'This is a pilot, not a finished service',
  summary:
    'A small field test to check whether the technical plumbing works, intended for a group of veterans who already know each other.',
  points: [
    {
      title: 'Not a VA service',
      detail:
        'VetNet is not affiliated with, endorsed by, or operated on behalf of the U.S. Department of Veterans Affairs, and nothing here is an official VA benefit.',
    },
    {
      title: 'We do not verify identity, service, or driving records',
      detail:
        'There is no DD-214 or ID check, no background check, and no driving-record or licence check. Anyone who enters a phone number can enrol, and being listed here is not a vouch for anybody.',
    },
    {
      title: 'No insurance is provided',
      detail:
        'Rides are given and taken at your own risk, under your own auto insurance. The pilot carries no commercial, excess, or rideshare coverage, and organising a ride here does not make you a covered driver.',
    },
    {
      title: 'Privacy protections are not yet in place',
      detail:
        'There is no CCPA/CPRA compliance program behind this yet. We store your name, branch, years served, email, phone number, ZIP code, vehicle model and plate, the hours you commit, and your ride history. A rider matched to you is shown your name, phone number and vehicle so they can find you.',
    },
    {
      title: 'Only use it with people you already know',
      detail:
        'Do not rely on it for anything time-critical or safety-critical. It is not an emergency or medical transport service.',
    },
    {
      title: 'You can leave at any time',
      detail:
        'Withdraw your committed hours whenever you like, and ask us to delete your enrolment and its history.',
    },
  ],
  acknowledgement:
    'I have read the above. I understand this is an unverified, uninsured pilot with no formal privacy program, and I am choosing to take part anyway.',
} as const;
