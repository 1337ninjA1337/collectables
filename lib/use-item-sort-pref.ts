import { useCallback, useEffect, useRef, useState } from "react";

import AsyncStorage from "@react-native-async-storage/async-storage";

import type { ItemSortMode } from "@/lib/item-filters";
import {
  EMPTY_SORT_PREFS,
  parseSortPrefs,
  sortPrefFor,
  withSortPref,
  type ItemSortPrefs,
} from "@/lib/item-sort-prefs";
import { reportStorageFailure } from "@/lib/report-storage-failure";
import { ITEM_SORT_KEY } from "@/lib/storage-keys";

/**
 * The sort this collection was last read with, and the way to remember a new
 * one.
 *
 * `null` until the store answers, which is what tells the screen "I have
 * nothing for you yet" as opposed to "nobody ever sorted this one" — the
 * difference matters because the screen applies the restored sort exactly once
 * and must not fight a user who picked one during the read.
 *
 * The rules the blob obeys are in `lib/item-sort-prefs.ts`; what is here is the
 * async half. It is deliberately small: one read per collection open, one write
 * per sort change, and a failed write reported through the shared
 * once-per-keyspace budget rather than swallowed — a sort preference that
 * cannot persist is a cache miss, not data loss, so it must not throw out of a
 * screen.
 */
export function useItemSortPref(
  collectionId: string | undefined,
): [ItemSortMode | null, (sort: ItemSortMode) => void] {
  const [restored, setRestored] = useState<ItemSortMode | null>(null);
  // The whole blob, so a write for THIS collection does not drop the sorts of
  // every other one. Read once per mount and updated in place afterwards.
  const prefsRef = useRef<ItemSortPrefs>(EMPTY_SORT_PREFS);

  useEffect(() => {
    let active = true;
    setRestored(null);
    AsyncStorage.getItem(ITEM_SORT_KEY)
      .then((raw) => {
        if (!active) return;
        const prefs = parseSortPrefs(raw);
        prefsRef.current = prefs;
        setRestored(sortPrefFor(prefs, collectionId));
      })
      .catch((error: unknown) => {
        if (!active) return;
        reportStorageFailure("use-item-sort-pref.getItem", ITEM_SORT_KEY, error);
        // An unreadable blob is a collection with no remembered sort, not a
        // screen that waits forever for one.
        setRestored("default");
      });
    return () => {
      active = false;
    };
  }, [collectionId]);

  const remember = useCallback(
    (sort: ItemSortMode) => {
      const next = withSortPref(prefsRef.current, collectionId, sort);
      // By reference: `withSortPref` returns the same object when the choice
      // says nothing new, so re-picking the active sort writes nothing.
      if (next === prefsRef.current) return;
      prefsRef.current = next;
      AsyncStorage.setItem(ITEM_SORT_KEY, JSON.stringify(next)).catch((error: unknown) => {
        reportStorageFailure("use-item-sort-pref.setItem", ITEM_SORT_KEY, error);
      });
    },
    [collectionId],
  );

  return [restored, remember];
}
