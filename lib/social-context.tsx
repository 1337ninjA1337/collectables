import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { seedProfiles, seedSocialCollections, seedSocialItems } from "@/data/social-seed";
import { trackEvent } from "@/lib/analytics";
import { useAuth } from "@/lib/auth-context";
import {
  upsertMyProfile,
  fetchFriendRequests,
  sendFriendRequest,
  removeFriendRequest,
  fetchProfileById,
  RemoteFriendRequest,
} from "@/lib/supabase-profiles";
import { SOCIAL_GRAPH_KEY, socialCacheKey } from "@/lib/storage-keys";
import { Collection, CollectableItem, ProfileRelationship, UserProfile } from "@/lib/types";

type SocialStore = {
  following: string[];
  myProfile: UserProfile | null;
};

type FriendRequest = {
  fromUserId: string;
  toUserId: string;
};

type SocialGraphStore = {
  friendRequests: FriendRequest[];
  deletedProfileIds: string[];
};

type SocialContextValue = {
  ready: boolean;
  isAdmin: boolean;
  profiles: UserProfile[];
  friends: string[];
  incomingRequestUserIds: string[];
  following: string[];
  getMyProfile: () => UserProfile | undefined;
  getProfileById: (id: string) => UserProfile | undefined;
  ensureProfilesLoaded: (ids: readonly string[]) => Promise<void>;
  getRelationship: (profileId: string) => ProfileRelationship;
  updateMyProfile: (input: Partial<Pick<UserProfile, "avatar" | "displayName" | "bio" | "publicId" | "username">>) => Promise<void>;
  addFriend: (profileId: string) => Promise<void>;
  removeFriend: (profileId: string) => Promise<void>;
  followProfile: (profileId: string) => Promise<void>;
  unfollowProfile: (profileId: string) => Promise<void>;
  deleteProfile: (profileId: string) => Promise<void>;
  getVisibleCollections: () => Collection[];
  getVisibleItems: () => CollectableItem[];
};

const SocialContext = createContext<SocialContextValue | null>(null);

function slugifyProfileId(value: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || `collector-${Date.now()}`
  );
}

function ensureUniquePublicId(publicId: string, profiles: UserProfile[], selfId?: string) {
  const base = slugifyProfileId(publicId);
  let next = base;
  let counter = 2;

  while (profiles.some((profile) => profile.id !== selfId && profile.publicId === next)) {
    next = `${base}-${counter}`;
    counter += 1;
  }

  return next;
}

function ensureUniqueUsername(username: string, profiles: UserProfile[], selfId?: string) {
  const base =
    username
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/^_+|_+$/g, "") || `collector_${Date.now()}`;

  let next = base;
  let counter = 2;

  while (profiles.some((profile) => profile.id !== selfId && profile.username === next)) {
    next = `${base}_${counter}`;
    counter += 1;
  }

  return next;
}

function buildFallbackProfile(user: NonNullable<ReturnType<typeof useAuth>["user"]>): UserProfile {
  const baseName = user.email?.split("@")[0] ?? "you";
  return {
    id: user.id,
    email: user.email ?? "you@collectables.app",
    displayName: (user.user_metadata?.full_name as string | undefined) ?? baseName,
    username: (user.user_metadata?.user_name as string | undefined) ?? baseName.toLowerCase().replace(/[^a-z0-9_]+/g, ""),
    publicId: slugifyProfileId(baseName),
    bio: "I collect things worth saving beautifully and sharing with friends.",
    avatar: (user.user_metadata?.avatar_url as string | undefined) ?? "",
  };
}

function normalizeProfile(profile: UserProfile) {
  const normalizedUsername =
    profile.username
      ?.trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/^_+|_+$/g, "") || "collector";

  return {
    ...profile,
    username: normalizedUsername,
    publicId: profile.publicId ? slugifyProfileId(profile.publicId) : slugifyProfileId(profile.username || profile.displayName || profile.email),
  };
}

function hasRequest(friendRequests: FriendRequest[], fromUserId: string, toUserId: string) {
  return friendRequests.some((request) => request.fromUserId === fromUserId && request.toUserId === toUserId);
}

const DEFAULT_VIEWER_PROFILE_TTL_MS = 10 * 60 * 1000;

function resolveViewerProfileTtlMs(): number {
  const raw = process.env.EXPO_PUBLIC_PROFILE_CACHE_TTL_MS;
  if (!raw) return DEFAULT_VIEWER_PROFILE_TTL_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_VIEWER_PROFILE_TTL_MS;
  return parsed;
}

const VIEWER_PROFILE_TTL_MS = resolveViewerProfileTtlMs();

export function SocialProvider({ children }: React.PropsWithChildren) {
  const { user } = useAuth();
  const [following, setFollowing] = useState<string[]>([]);
  const [myProfileOverride, setMyProfileOverride] = useState<UserProfile | null>(null);
  const [friendRequests, setFriendRequests] = useState<FriendRequest[]>([]);
  const [deletedProfileIds, setDeletedProfileIds] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const [remoteProfiles, setRemoteProfiles] = useState<UserProfile[]>([]);
  // Cache of profiles fetched on demand (e.g. non-friend collection viewers,
  // chat counterparts). Lives at the provider level so every screen shares one
  // source of truth instead of refetching the same id locally.
  // Each entry is stamped with cachedAt so stale entries (>10 min) are refetched.
  const [viewerProfiles, setViewerProfiles] = useState<Record<string, { profile: UserProfile; cachedAt: number }>>({});
  const inFlightProfileIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!user) {
      setFollowing(prev => prev.length === 0 ? prev : []);
      setMyProfileOverride(prev => prev === null ? prev : null);
      setFriendRequests(prev => prev.length === 0 ? prev : []);
      setDeletedProfileIds(prev => prev.length === 0 ? prev : []);
      setViewerProfiles((prev) => (Object.keys(prev).length === 0 ? prev : {} as Record<string, { profile: UserProfile; cachedAt: number }>));
      inFlightProfileIdsRef.current.clear();
      setReady(false);
      return;
    }

    const activeUser = user;
    let active = true;

    async function hydrate() {
      try {
        const [rawPersonal, rawGraph, remoteRequests] = await Promise.all([
          AsyncStorage.getItem(socialCacheKey(activeUser.id)),
          AsyncStorage.getItem(SOCIAL_GRAPH_KEY),
          fetchFriendRequests(activeUser.id),
        ]);

        if (!active) {
          return;
        }

        if (rawPersonal) {
          const parsed = JSON.parse(rawPersonal) as SocialStore;
          setFollowing(parsed.following ?? []);
          setMyProfileOverride(parsed.myProfile ? normalizeProfile(parsed.myProfile) : null);
        } else {
          setFollowing([]);
          setMyProfileOverride(null);
        }

        if (rawGraph) {
          const parsedGraph = JSON.parse(rawGraph) as SocialGraphStore;
          setDeletedProfileIds(parsedGraph.deletedProfileIds ?? []);
        } else {
          setDeletedProfileIds([]);
        }

        // Friend requests come from Supabase
        const mapped: FriendRequest[] = remoteRequests.map((r: RemoteFriendRequest) => ({
          fromUserId: r.from_user_id,
          toUserId: r.to_user_id,
        }));
        setFriendRequests(mapped);
      } finally {
        if (active) {
          setReady(true);
        }
      }
    }

    void hydrate();

    return () => {
      active = false;
    };
  }, [user]);

  const profiles = useMemo<UserProfile[]>(() => {
    const isDeleted = (profileId: string) => deletedProfileIds.includes(profileId);
    const seen = new Set<string>();

    const result: UserProfile[] = [];

    if (user) {
      const selfProfile = normalizeProfile(myProfileOverride ?? buildFallbackProfile(user));
      result.push(selfProfile);
      seen.add(selfProfile.id);
    }

    for (const rp of remoteProfiles) {
      if (!seen.has(rp.id) && !isDeleted(rp.id)) {
        result.push(normalizeProfile(rp));
        seen.add(rp.id);
      }
    }

    for (const sp of seedProfiles) {
      const normalized = normalizeProfile(sp);
      if (!seen.has(normalized.id) && !isDeleted(normalized.id)) {
        result.push(normalized);
        seen.add(normalized.id);
      }
    }

    return result;
  }, [deletedProfileIds, myProfileOverride, remoteProfiles, user]);

  const isAdmin = useMemo(() => {
    if (!user) {
      return false;
    }

    const selfProfile = profiles.find((profile) => profile.id === user.id);
    return selfProfile?.username === "1337antoxa" || selfProfile?.email === "1337.antoxa@gmail.com";
  }, [profiles, user]);

  useEffect(() => {
    if (!user || !ready) {
      return;
    }

    AsyncStorage.setItem(
      socialCacheKey(user.id),
      JSON.stringify({
        following,
        myProfile: myProfileOverride ? normalizeProfile(myProfileOverride) : null,
      } satisfies SocialStore),
    ).catch(() => undefined);
  }, [following, myProfileOverride, ready, user]);

  useEffect(() => {
    if (!ready) {
      return;
    }

    AsyncStorage.setItem(
      SOCIAL_GRAPH_KEY,
      JSON.stringify({
        friendRequests,
        deletedProfileIds,
      } satisfies SocialGraphStore),
    ).catch(() => undefined);
  }, [deletedProfileIds, friendRequests, ready]);

  // Sync own profile to Supabase only when myProfileOverride changes
  useEffect(() => {
    if (!user || !ready) return;
    const selfProfile = myProfileOverride ?? (profiles.find((p) => p.id === user.id));
    if (selfProfile) {
      upsertMyProfile(selfProfile).catch(() => undefined);
    }
  }, [myProfileOverride, ready, user]);

  const friends = useMemo(() => {
    if (!user) {
      return [];
    }

    const uniqueIds = new Set<string>();
    friendRequests.forEach((request) => {
      if (request.fromUserId === user.id && hasRequest(friendRequests, request.toUserId, user.id)) {
        uniqueIds.add(request.toUserId);
      }
      if (request.toUserId === user.id && hasRequest(friendRequests, user.id, request.fromUserId)) {
        uniqueIds.add(request.fromUserId);
      }
    });
    return [...uniqueIds];
  }, [friendRequests, user]);

  useEffect(() => {
    if (friends.length === 0) {
      setRemoteProfiles(prev => prev.length === 0 ? prev : []);
      return;
    }

    let active = true;

    Promise.all(friends.map((id) => fetchProfileById(id)))
      .then((results) => {
        if (active) {
          setRemoteProfiles(results.filter((p): p is UserProfile => p !== null));
        }
      })
      .catch(() => {});

    return () => { active = false; };
  }, [friends]);

  const incomingRequestUserIds = useMemo(() => {
    if (!user) return [];
    return friendRequests
      .filter((r) => r.toUserId === user.id && !friends.includes(r.fromUserId))
      .map((r) => r.fromUserId);
  }, [friendRequests, friends, user]);

  const profileById = useMemo(() => {
    const map = new Map<string, UserProfile>();
    for (const p of profiles) map.set(p.id, p);
    return map;
  }, [profiles]);

  const ensureProfilesLoaded = useCallback(
    async (ids: readonly string[]) => {
      const inFlight = inFlightProfileIdsRef.current;
      const now = Date.now();
      const missing = ids.filter((id) => {
        if (!id || profileById.has(id) || inFlight.has(id)) return false;
        const cached = viewerProfiles[id];
        if (!cached) return true;
        return now - cached.cachedAt > VIEWER_PROFILE_TTL_MS;
      });
      if (missing.length === 0) return;
      missing.forEach((id) => inFlight.add(id));
      try {
        const results = await Promise.all(
          missing.map((id) =>
            fetchProfileById(id)
              .then((p) => [id, p] as const)
              .catch(() => [id, null] as const),
          ),
        );
        const next: Record<string, { profile: UserProfile; cachedAt: number }> = {};
        for (const [id, profile] of results) {
          inFlight.delete(id);
          if (profile) next[profile.id] = { profile, cachedAt: Date.now() };
        }
        if (Object.keys(next).length > 0) {
          setViewerProfiles((prev) => ({ ...prev, ...next }));
        }
      } catch {
        missing.forEach((id) => inFlight.delete(id));
      }
    },
    [profileById, viewerProfiles],
  );

  const value = useMemo<SocialContextValue>(
    () => ({
      ready,
      isAdmin,
      profiles,
      friends,
      incomingRequestUserIds,
      following,
      getMyProfile: () => (user ? profileById.get(user.id) : undefined),
      getProfileById: (id) => profileById.get(id) ?? viewerProfiles[id]?.profile,
      ensureProfilesLoaded,
      getRelationship: (profileId) => {
        if (user?.id === profileId) {
          return "self";
        }
        if (!user) {
          return "none";
        }

        const outgoing = hasRequest(friendRequests, user.id, profileId);
        const incoming = hasRequest(friendRequests, profileId, user.id);

        if (outgoing && incoming) {
          return "friend";
        }
        if (outgoing) {
          return "request_sent";
        }
        if (incoming) {
          return "request_received";
        }
        if (following.includes(profileId)) {
          return "following";
        }
        return "none";
      },
      updateMyProfile: async (input) => {
        if (!user) {
          return;
        }

        setMyProfileOverride((current) => {
          const base = normalizeProfile(current ?? buildFallbackProfile(user));
          const nextUsername = input.username ? ensureUniqueUsername(input.username, profiles, user.id) : base.username;
          const nextPublicId = input.publicId
            ? ensureUniquePublicId(input.publicId, profiles, user.id)
            : base.publicId;

          return {
            ...base,
            ...input,
            username: nextUsername,
            publicId: nextPublicId,
          };
        });
      },
      addFriend: async (profileId) => {
        if (!user || profileId === user.id) {
          return;
        }

        const alreadyRequested = hasRequest(friendRequests, user.id, profileId);

        setFriendRequests((current) => {
          if (hasRequest(current, user.id, profileId)) {
            return current;
          }
          return [...current, { fromUserId: user.id, toUserId: profileId }];
        });

        setFollowing((current) => (current.includes(profileId) ? current : [...current, profileId]));
        sendFriendRequest(user.id, profileId).catch(() => undefined);

        if (!alreadyRequested) {
          trackEvent("friend_requested", {
            targetUserId: profileId,
          });
        }
      },
      removeFriend: async (profileId) => {
        if (!user) {
          return;
        }

        setFriendRequests((current) =>
          current.filter(
            (request) =>
              !(
                (request.fromUserId === user.id && request.toUserId === profileId) ||
                (request.fromUserId === profileId && request.toUserId === user.id)
              ),
          ),
        );
        removeFriendRequest(user.id, profileId).catch(() => undefined);
      },
      followProfile: async (profileId) => {
        setFollowing((current) => (current.includes(profileId) ? current : [...current, profileId]));
      },
      unfollowProfile: async (profileId) => {
        setFollowing((current) => current.filter((id) => id !== profileId));
      },
      deleteProfile: async (profileId) => {
        if (!user || !isAdmin || profileId === user.id) {
          return;
        }

        setDeletedProfileIds((current) => (current.includes(profileId) ? current : [...current, profileId]));
        setFollowing((current) => current.filter((id) => id !== profileId));
        setFriendRequests((current) =>
          current.filter((request) => request.fromUserId !== profileId && request.toUserId !== profileId),
        );
        setViewerProfiles((current) => {
          if (!(profileId in current)) return current;
          const { [profileId]: _drop, ...rest } = current;
          return rest;
        });
      },
      getVisibleCollections: () =>
        seedSocialCollections.filter(
          (collection) =>
            !deletedProfileIds.includes(collection.ownerUserId) &&
            (following.includes(collection.ownerUserId) || friends.includes(collection.ownerUserId)),
        ),
      getVisibleItems: () => {
        const visibleCollectionIds = new Set(
          seedSocialCollections
            .filter(
              (collection) =>
                !deletedProfileIds.includes(collection.ownerUserId) &&
                (following.includes(collection.ownerUserId) || friends.includes(collection.ownerUserId)),
            )
            .map((collection) => collection.id),
        );
        return seedSocialItems.filter((item) => visibleCollectionIds.has(item.collectionId));
      },
    }),
    [deletedProfileIds, ensureProfilesLoaded, friendRequests, following, friends, incomingRequestUserIds, isAdmin, profileById, profiles, ready, user, viewerProfiles],
  );

  return <SocialContext.Provider value={value}>{children}</SocialContext.Provider>;
}

export function useSocial() {
  const context = useContext(SocialContext);
  if (!context) {
    throw new Error("useSocial must be used inside SocialProvider");
  }
  return context;
}
