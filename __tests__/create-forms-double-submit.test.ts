import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { stripComments } from "@/lib/strip-comments";

import { readRepoFile } from "./helpers/repo-file";

/**
 * The two create forms, read for the first time, and the one defect they both
 * had twice.
 *
 * Both have been named as unread in four suggestion rounds. Both drive a save
 * button off a `saving` STATE — `disabled={saving}`, a dimmed style, a label
 * that says "saving…" — and a state is a prop of the previous render: a second
 * press arriving in the same tick passed every one of those and ran the whole
 * handler again. The chat composer had the same defect fixed on 2026-10-21 and
 * the fix was a ref, for the reason stated there and restated here.
 *
 * The second half is the `finally`. Both handlers end with
 * `router.replace(...)` and then clear the flag, so the state was set on an
 * unmounted screen on every SUCCESSFUL save — the ordinary path, not an edge
 * case, and the reason `useMountedRef` exists rather than a fifth hand-written
 * copy.
 *
 * Source reads rather than a render: both screens reach expo-router,
 * expo-image-picker, the collections context and an upload module, and nothing
 * in this tree mounts them. `use-mounted-ref.test.ts` runs the hook.
 */
const FORMS = [
  { file: "app/create.tsx", what: "the add-item form" },
  { file: "app/create-collection.tsx", what: "the new-collection form" },
] as const;

for (const { file, what } of FORMS) {
  describe(`${what} refuses a second submit`, () => {
    const CODE = stripComments(readRepoFile(file));

    it("reads the ref before anything awaits, and sets it before the state", () => {
      assert.match(
        CODE,
        /if \(savingRef\.current\) return;\s*savingRef\.current = true;\s*setSaving\(true\);/,
        "a state cannot refuse a press that arrives before the re-render",
      );
    });

    it("keeps the guard behind the validation, so a rejected submit can be retried", () => {
      // The early returns for a missing title and an unparseable cost must not
      // leave the ref set — a user who fixes the field has to be able to press
      // again. The ref is taken after them, which is what makes that true
      // without a release on every path.
      const guard = CODE.indexOf("if (savingRef.current) return;");
      const validation = CODE.indexOf("setSubmitAttempted(true);");
      assert.ok(validation >= 0 && guard > validation, "the guard runs before the validation");
    });

    it("releases the ref unconditionally and the state only while mounted", () => {
      assert.match(
        CODE,
        /\} finally \{\s*savingRef\.current = false;\s*if \(mountedRef\.current\) setSaving\(false\);\s*\}/,
      );
    });

    it("navigates away before that finally runs, which is why the guard is needed", () => {
      // The claim behind the `mountedRef`: this screen's unmount is its own
      // last statement rather than something the user did.
      assert.match(CODE, /router\.replace\(/);
    });

    it("takes the mounted flag from the hook rather than writing a fifth copy", () => {
      assert.match(CODE, /const mountedRef = useMountedRef\(\);/);
      assert.match(CODE, /import \{ useMountedRef \} from "@\/lib\/use-mounted-ref";/);
      assert.ok(
        !/mountedRef\.current = true;/.test(CODE),
        "the mount assignment belongs to the hook",
      );
    });

    it("still drives the button off the state, because that is the part the user sees", () => {
      // The ref is invisible by design; the dimmed button and the "saving…"
      // label are what tell somebody the press landed.
      assert.match(CODE, /disabled=\{saving\}/);
      assert.match(CODE, /accessibilityState=\{\{ disabled: saving \}\}/);
    });
  });
}

describe("the four hand-written copies are down to zero", () => {
  it("leaves no screen assigning mountedRef.current itself", () => {
    // `app/profile/[id].tsx` had the first copy (a pull-to-refresh with
    // nothing to hang a cancellation flag on) and `app/chat/[id].tsx` the
    // second; these two forms were the third and fourth, written the same day
    // the hook was extracted. `lint:latest-ref` cannot see this pattern — it
    // matches `fooRef.current = foo` with the same name either side — so the
    // sweep is here.
    for (const file of [
      "app/profile/[id].tsx",
      "app/chat/[id].tsx",
      "app/create.tsx",
      "app/create-collection.tsx",
    ]) {
      const code = stripComments(readRepoFile(file));
      assert.match(code, /const mountedRef = useMountedRef\(\);/, `${file} lost the hook`);
      assert.ok(
        !/mountedRef\.current = true;/.test(code),
        `${file} still writes the mount assignment by hand`,
      );
    }
  });
});
