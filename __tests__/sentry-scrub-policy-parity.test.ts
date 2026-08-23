import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { scrubPII, type SentryEvent } from "../lib/sentry";
import {
  POLICY_CHECKSUM_PATTERN,
  extractPrivacyTranslatedSection,
} from "../lib/privacy-translated-section";
import {
  SCRUB_PROMISE_BASELINE,
  SCRUB_PROMISE_INTRO,
  extractScrubPromises,
  scrubPromiseChecksum,
  scrubPromiseClause,
} from "../lib/sentry-scrub-promises";

import { readRepoFile } from "./helpers/repo-file";

/**
 * The policy's promise and the scrubber's behaviour, checked against each other.
 *
 * `PRIVACY.md` tells a reader that "personally identifying fields (email
 * address, IP address, cookies, and `Authorization` headers) are stripped
 * client-side before transmission". `sentry-scrubber.test.ts` checks that
 * `scrubPII` removes each field it removes. Both suites are about one file, and
 * between them sat the question neither asks: are those the same fields?
 *
 * The failure is one-directional. Stripping more than the policy mentions is the
 * app doing better than it said. Promising more than the scrubber removes is the
 * app sending a third party data it told a user it would not — and it arrives by
 * ordinary editing, because each file stays internally consistent while the pair
 * comes apart.
 *
 * So the promise is PARSED out of the policy rather than restated here. What is
 * declared is the probe for each promised field: a value the scrubber must not
 * let through, and where in a Sentry event it lives. That mapping is the part no
 * parser can infer, and the exhaustiveness case is what stops it lagging the
 * sentence.
 */

const POLICY = readRepoFile("PRIVACY.md");
const SECTION = extractPrivacyTranslatedSection(POLICY);
const PROMISED = extractScrubPromises(SECTION);

/**
 * One promised field, a value that must not survive, and where it sits.
 *
 * `matches` rather than an exact string because the policy writes prose ("email
 * address") where the event has a key (`user.email`), and the sentence is
 * allowed to be readable. It is held to the sentence by the exhaustiveness case
 * below: every phrase the policy lists must be claimed by exactly one probe.
 */
const PROBES: readonly {
  readonly matches: RegExp;
  readonly probe: string;
  readonly place: (event: SentryEvent) => void;
}[] = [
  {
    matches: /^email/i,
    probe: "leaked-address@example.com",
    place: (event) => {
      event.user = { ...event.user, email: "leaked-address@example.com" };
    },
  },
  {
    matches: /^ip\b/i,
    probe: "203.0.113.42",
    place: (event) => {
      event.user = { ...event.user, ip_address: "203.0.113.42" };
    },
  },
  {
    matches: /^cookies?$/i,
    probe: "session=leaked-cookie-value",
    place: (event) => {
      event.request = { ...event.request, cookies: "session=leaked-cookie-value" };
    },
  },
  {
    matches: /^authorization/i,
    probe: "Bearer leaked-token-value",
    place: (event) => {
      event.request = {
        ...event.request,
        headers: { ...event.request?.headers, Authorization: "Bearer leaked-token-value" },
      };
    },
  },
];

const eventWithEveryProbe = (): SentryEvent => {
  const event: SentryEvent = { user: { id: "user-uuid-kept-on-purpose" } };
  for (const { place } of PROBES) place(event);
  return event;
};

describe("the crash-report promise and what scrubPII actually removes", () => {
  it("reads a promise out of the policy that is worth checking", () => {
    // The premise. A parse that came back empty would make every parity case
    // below pass over nothing, which is the one way a promise-checker fails
    // silently.
    assert.ok(
      PROMISED.length >= 4,
      `the policy's stripped-field list parsed to ${String(PROMISED.length)} item(s): ${PROMISED.join(", ")}`,
    );
    assert.ok(
      SECTION.includes("stripped client-side"),
      "the section no longer says the fields are stripped client-side — the promise this suite checks has been rewritten",
    );
  });

  it("has exactly one probe per promised field, and no probe for a field nobody promised", () => {
    // The direction that catches a widened promise: somebody adds "device
    // identifiers" to the disclosure and no probe claims it, so nothing would
    // ever have checked that the scrubber removes them.
    const unclaimed = PROMISED.filter(
      (phrase) => !PROBES.some(({ matches }) => matches.test(phrase)),
    );
    assert.deepEqual(
      unclaimed,
      [],
      `PRIVACY.md promises these fields are stripped and no probe in this suite checks them: ${unclaimed.join(", ")}.\n` +
        `  Add a probe with a value scrubPII must remove — and check that scrubPII actually removes it, because until now nothing did.`,
    );
    const unused = PROBES.filter(
      ({ matches }) => !PROMISED.some((phrase) => matches.test(phrase)),
    ).map(({ probe }) => probe);
    assert.deepEqual(
      unused,
      [],
      `these probes match nothing the policy promises any more: ${unused.join(", ")}.\n` +
        `  Either the disclosure was narrowed (in which case say so in the diff) or the phrase was reworded and the probe needs its pattern updated.`,
    );
    const doubled = PROMISED.filter(
      (phrase) => PROBES.filter(({ matches }) => matches.test(phrase)).length > 1,
    );
    assert.deepEqual(
      doubled,
      [],
      `these promised fields are claimed by more than one probe, so one of them could be deleted without anything going red: ${doubled.join(", ")}`,
    );
  });

  it("lets every probe reach the event, so removing them means something", () => {
    // Without this, a probe that silently failed to attach would read as a
    // scrubber that removed it.
    const serialised = JSON.stringify(eventWithEveryProbe());
    for (const { probe } of PROBES) {
      assert.ok(
        serialised.includes(probe),
        `the probe "${probe}" never reached the event — the case below would pass on an event that never carried it`,
      );
    }
  });

  for (const { probe } of PROBES) {
    it(`removes ${probe.split(/[@=: ]/)[0]}… from a production event`, () => {
      const scrubbed = JSON.stringify(scrubPII(eventWithEveryProbe(), "production"));
      assert.ok(
        !scrubbed.includes(probe),
        `PRIVACY.md promises this field is stripped client-side before transmission and scrubPII left it in the event: ${scrubbed}\n` +
          `  This is the app sending a third party something it told a user it would not. Fix lib/sentry.ts, or amend the promise — in that order.`,
      );
    });
  }

  it("keeps the one identifier the policy says it keeps", () => {
    // The promise has two halves and the other one is a commitment too: "the
    // crash payload includes your Supabase user identifier so we can correlate
    // reports per account". A scrubber that stripped everything would satisfy
    // every case above and break what the disclosure says the product does.
    assert.ok(
      SECTION.includes("Supabase user identifier"),
      "the policy no longer says the crash payload carries the Supabase user identifier — this case is asserting a promise that is gone",
    );
    assert.equal(
      scrubPII(eventWithEveryProbe(), "production").user?.id,
      "user-uuid-kept-on-purpose",
    );
  });
});

/**
 * The half the field list cannot see.
 *
 * Every case above reads the promise as a LIST — which phrases it names, and
 * whether each is claimed by a probe. That catches a field added to the promise
 * and nothing checking it. It cannot catch a field NARROWED, because the probe
 * patterns are anchored on one word: "email address" reworded to "email domain"
 * still matches `/^email/i`, still claims the same probe, and leaves every
 * assertion above green while the app and the disclosure have come apart.
 *
 * The checksum cannot read the new wording either. It refuses to let the
 * rewording pass unlooked-at, which is the only guarantee available for prose.
 */
describe("the wording the probes were matched to", () => {
  it("still checksums to the recorded value", () => {
    const actual = scrubPromiseChecksum(POLICY);
    assert.equal(
      actual,
      SCRUB_PROMISE_BASELINE.checksum,
      `the sentence promising what scrubPII removes has been edited.\n` +
        `  now: ${scrubPromiseClause(POLICY)}\n` +
        `  The probe patterns in this file are anchored on one word each, so a narrowed field keeps its probe and every other case here stays green.\n` +
        `  Re-read all ${String(PROBES.length)} probes against the new sentence, then record checksum "${actual}" in SCRUB_PROMISE_BASELINE with today's date and a note saying WHICH kind of edit this was.`,
    );
  });

  it("moves when a promised field is narrowed, which the field list does not", () => {
    // The case for the checksum existing, stated as an experiment rather than
    // as a claim in a comment: the same edit that leaves the exhaustiveness
    // check satisfied moves the fingerprint.
    //
    // Narrowed on the CLAUSE rather than on the file, because the file is
    // hard-wrapped — "email address" is split across two lines there, and a
    // replace over the raw text silently edits a different sentence and proves
    // nothing.
    const clause = scrubPromiseClause(POLICY);
    const narrowed = clause.replace("email address", "email domain");
    assert.notEqual(narrowed, clause, "the promise clause no longer says \"email address\"");

    const unclaimed = extractScrubPromises(narrowed).filter(
      (phrase) => !PROBES.some(({ matches }) => matches.test(phrase)),
    );
    assert.deepEqual(
      unclaimed,
      [],
      "the narrowing this case is about is one the exhaustiveness check already catches, so the checksum would be buying nothing",
    );
    assert.notEqual(scrubPromiseChecksum(narrowed), SCRUB_PROMISE_BASELINE.checksum);
  });

  it("does not move when the policy is rewrapped", () => {
    // The other half of keepable: these files are hard-wrapped inside a
    // blockquote, and a guard red for a rewrap is a guard somebody deletes.
    assert.equal(
      POLICY.split("cookies, and").length,
      2,
      "the phrase this case rewraps is not unique in PRIVACY.md, so the replace below may be editing another sentence",
    );
    const rewrapped = POLICY.replace("cookies, and", "cookies,\n> and");
    assert.equal(scrubPromiseChecksum(rewrapped), SCRUB_PROMISE_BASELINE.checksum);
  });

  it("fingerprints the promise clause and not the paragraph around it", () => {
    const clause = scrubPromiseClause(POLICY);
    assert.ok(clause.startsWith(SCRUB_PROMISE_INTRO));
    assert.ok(clause.endsWith("."));
    // A fingerprint over the whole remaining policy would move on every
    // unrelated edit, which is a rule nobody keeps.
    assert.ok(
      !clause.includes("90 days"),
      `the clause ran past its own sentence and swallowed the retention promise: ${clause}`,
    );
    assert.ok(
      clause.length < 200,
      `the clause is ${String(clause.length)} characters, which is a paragraph rather than a sentence: ${clause}`,
    );
  });

  it("refuses a policy whose promise clause has no sentence to end", () => {
    // An empty or run-on extraction hashes to a stable value and reports every
    // promise as unchanged forever — the one failure a fingerprint cannot
    // afford.
    assert.throws(
      () => scrubPromiseClause("nothing in here promises anything"),
      /no longer says/,
    );
    assert.throws(
      () => scrubPromiseClause(`> ${SCRUB_PROMISE_INTRO} are stripped`),
      /parenthetical list ending in a sentence/,
    );
  });

  it("carries provenance the next reader can weigh", () => {
    assert.match(SCRUB_PROMISE_BASELINE.checksum, POLICY_CHECKSUM_PATTERN);
    assert.match(SCRUB_PROMISE_BASELINE.recordedOn, /^\d{4}-\d{2}-\d{2}$/);
    // Eight words for the same reason the translation notes ask for eight: this
    // value moves for more than one reason and the note is the only place the
    // diff says which.
    assert.ok(
      SCRUB_PROMISE_BASELINE.note.trim().split(/\s+/).filter(Boolean).length >= 8,
      `SCRUB_PROMISE_BASELINE.note is too short to say why the value moved: ${SCRUB_PROMISE_BASELINE.note}`,
    );
  });
});
