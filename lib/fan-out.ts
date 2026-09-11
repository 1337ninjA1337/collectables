/**
 * One request per input, and what came back is what you get.
 *
 * Six places in this app fanned a fetch out over a list —
 * `fetchItemsByCollectionId` per collection, `fetchCollectionById` per
 * subscription, `fetchPublicCollectionsByUserId` per friend — and every one of
 * them wrote `Promise.all(list.map(fetchOne))` inside a `try`/`catch` that
 * swallowed the error. `Promise.all` rejects on the FIRST rejection, so a
 * single collection whose request fails — a row deleted between the list and
 * the fetch, a permissions change, one dropped connection on request nine of
 * ten — discards the nine answers that arrived. The catch then made that
 * silent, and the screen showed zeros it had the real numbers for.
 *
 * Partial is the right answer here because every caller is a CACHE FILL: the
 * app reads from AsyncStorage and these fetches top it up, so nine collections'
 * items are strictly better than none and the tenth arrives on the next
 * refresh. A fan-out whose caller needs all-or-nothing — a write that must not
 * half-apply — should keep `Promise.all` and say why.
 *
 * These never reject, which is the point: a caller's `.catch(() => {})` was
 * doing the work of hiding a total loss, and there is no total loss to hide.
 */

/**
 * Every answer that came back, in input order, dropping the requests that
 * failed.
 *
 * `inputs.map((input) => fetchOne(input))` rather than `inputs.map(fetchOne)`:
 * `map` passes the index and the array as second and third arguments, and a
 * `fetchOne` that happens to take an options object would silently be handed
 * a number.
 */
export async function fetchSettled<T, R>(
  inputs: readonly T[],
  fetchOne: (input: T) => Promise<R>,
): Promise<R[]> {
  const settled = await Promise.allSettled(inputs.map((input) => fetchOne(input)));
  const results: R[] = [];
  for (const outcome of settled) {
    if (outcome.status === "fulfilled") results.push(outcome.value);
  }
  return results;
}

/**
 * The same fan-out for the common case where each answer is itself a list,
 * flattened into one.
 *
 * Four of the six call sites immediately looped the results into a single
 * array, each with its own nested `forEach` — which is where the flattening
 * belongs, not in each caller.
 */
export async function fetchSettledRows<T, R>(
  inputs: readonly T[],
  fetchOne: (input: T) => Promise<R[]>,
): Promise<R[]> {
  const lists = await fetchSettled(inputs, fetchOne);
  const rows: R[] = [];
  for (const list of lists) {
    for (const row of list) rows.push(row);
  }
  return rows;
}
