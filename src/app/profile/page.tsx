"use client";

import Link from "next/link";
import { useSession, signOut } from "next-auth/react";
import { useState, useEffect, useCallback, useRef, use } from "react";
import { PartyScheduleToggle } from "@/app/PartyScheduleToggle";
import { buildPartyInvitePath, normalizePartyCode } from "@/lib/party-invite";
import {
  getShowPopularSongs,
  setShowPopularSongsPreference,
} from "@/lib/schedule-preferences";
import { hapticNudge, hapticSuccess, hapticToast } from "@/lib/haptics";

interface PartyMember {
  email: string;
  name: string;
  image: string;
}

interface Party {
  id: string;
  code: string;
  name: string;
  createdBy: string;
  members: PartyMember[];
}

export default function ProfilePage({
  params,
  searchParams,
}: {
  params: Promise<Record<string, string | string[]>>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  use(params);
  use(searchParams);

  const { data: session, status } = useSession();

  const [parties, setParties] = useState<Party[]>([]);
  const [schedulePartyVisible, setSchedulePartyVisible] = useState<
    Record<string, boolean>
  >({});
  const [partyLoading, setPartyLoading] = useState(true);
  const [partyAction, setPartyAction] = useState(false);
  const [partyError, setPartyError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showJoinForm, setShowJoinForm] = useState(false);
  const [partyNameInput, setPartyNameInput] = useState("");
  const [partyCodeInput, setPartyCodeInput] = useState("");
  const [codeCopiedPartyId, setCodeCopiedPartyId] = useState<string | null>(null);
  const [copyToast, setCopyToast] = useState(false);
  const [copyToastKey, setCopyToastKey] = useState(0);
  const [toastMessage, setToastMessage] = useState("Link copied to clipboard!");
  const copyToastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const codeCopiedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inviteJoinAttemptedRef = useRef<string | null>(null);
  const [profileName, setProfileName] = useState("");
  const [profileImage, setProfileImage] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [editingProfile, setEditingProfile] = useState(false);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const profileSeededFromSessionRef = useRef(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);

  const [showPopularSongs, setShowPopularSongs] = useState(true);

  const applyProfileToLocalPartyMembers = useCallback(
    (nextName: string, nextImage: string) => {
      const email = session?.user?.email;
      if (!email) return;
      setParties((prev) =>
        prev.map((party) => ({
          ...party,
          members: party.members.map((member) =>
            member.email === email
              ? { ...member, name: nextName || member.name, image: nextImage }
              : member
          ),
        }))
      );
    },
    [session?.user?.email]
  );

  const clearJoinQueryParam = useCallback(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.delete("join");
    window.history.replaceState({}, "", url.toString());
  }, []);

  const getInviteUrl = useCallback((code: string) => {
    const path = buildPartyInvitePath(code);
    if (typeof window === "undefined") return path;
    return new URL(path, window.location.origin).toString();
  }, []);

  useEffect(() => {
    setShowPopularSongs(getShowPopularSongs());
  }, []);

  // Hydrate prefs from Firestore once authenticated; keeps multiple devices in sync.
  useEffect(() => {
    if (status !== "authenticated") return;
    (async () => {
      try {
        const res = await fetch("/api/prefs");
        if (!res.ok) return;
        const data = (await res.json()) as {
          showPopularSongs?: boolean | null;
        };
        if (typeof data.showPopularSongs === "boolean") {
          setShowPopularSongs(data.showPopularSongs);
          setShowPopularSongsPreference(data.showPopularSongs);
        }
      } catch { /* offline */ }
    })();
  }, [status]);

  useEffect(() => {
    if (status === "unauthenticated" && typeof window !== "undefined") {
      window.location.href = "/";
    }
  }, [status]);

  // Support invite links like /profile?join=ABC123
  useEffect(() => {
    if (typeof window === "undefined") return;
    const code = new URLSearchParams(window.location.search).get("join");
    if (!code) return;
    setPartyCodeInput(normalizePartyCode(code));
    setShowJoinForm(true);
    setShowCreateForm(false);
  }, []);

  useEffect(() => {
    if (profileSeededFromSessionRef.current) return;
    if (!session?.user) return;
    setProfileName((prev) => prev || session.user?.name || "");
    setProfileImage((prev) => prev || session.user?.image || "");
    profileSeededFromSessionRef.current = true;
  }, [session?.user]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/profile");
        if (!res.ok) return;
        const data = (await res.json()) as {
          profile?: { name?: string; image?: string };
        };
        if (data.profile) {
          setProfileName(data.profile.name ?? "");
          setProfileImage(data.profile.image ?? "");
        }
      } catch {
        // ignore
      }
    })();
  }, []);

  // Load parties
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/party");
        if (res.ok) {
          const data = (await res.json()) as {
            parties?: Party[];
            schedulePartyVisible?: Record<string, boolean>;
          };
          setParties(data.parties ?? []);
          setSchedulePartyVisible(data.schedulePartyVisible ?? {});
        }
      } catch { /* ignore */ }
      setPartyLoading(false);
    })();
  }, []);

  const createParty = useCallback(async (name: string) => {
    setPartyAction(true);
    setPartyError(null);
    try {
      const res = await fetch("/api/party", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create", name }),
      });
      const data = (await res.json()) as {
        parties?: Party[];
        schedulePartyVisible?: Record<string, boolean>;
        error?: string;
      };
      if (!res.ok) { setPartyError(data.error ?? "Error"); return; }
      setParties(data.parties ?? []);
      setSchedulePartyVisible(data.schedulePartyVisible ?? {});
      setShowCreateForm(false);
      setPartyNameInput("");
      hapticSuccess();
    } catch { setPartyError("Network error."); }
    finally { setPartyAction(false); }
  }, []);

  const joinParty = useCallback(async (code: string) => {
    const normalizedCode = normalizePartyCode(code);
    setPartyAction(true);
    setPartyError(null);
    try {
      const res = await fetch("/api/party", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "join", code: normalizedCode }),
      });
      const data = (await res.json()) as {
        parties?: Party[];
        schedulePartyVisible?: Record<string, boolean>;
        error?: string;
      };
      if (!res.ok) { setPartyError(data.error ?? "Error"); return false; }
      setParties(data.parties ?? []);
      setSchedulePartyVisible(data.schedulePartyVisible ?? {});
      setShowJoinForm(false);
      setPartyCodeInput("");
      hapticSuccess();
      return true;
    } catch {
      setPartyError("Network error.");
      return false;
    } finally { setPartyAction(false); }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (status !== "authenticated" || partyLoading || partyAction) return;

    const code = normalizePartyCode(
      new URLSearchParams(window.location.search).get("join") || ""
    );

    if (!code) return;
    if (parties.some((party) => normalizePartyCode(party.code) === code)) {
      clearJoinQueryParam();
      return;
    }
    if (inviteJoinAttemptedRef.current === code) return;

    inviteJoinAttemptedRef.current = code;

    void joinParty(code).then((joined) => {
      if (joined) {
        clearJoinQueryParam();
      } else {
        inviteJoinAttemptedRef.current = null;
      }
    });
  }, [
    clearJoinQueryParam,
    joinParty,
    parties,
    partyAction,
    partyLoading,
    status,
  ]);

  const leaveParty = useCallback(async (partyId: string) => {
    setPartyAction(true);
    setPartyError(null);
    try {
      const res = await fetch("/api/party", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "leave", partyId }),
      });
      const data = (await res.json()) as {
        parties?: Party[];
        schedulePartyVisible?: Record<string, boolean>;
      };
      if (res.ok) {
        setParties(data.parties ?? []);
        setSchedulePartyVisible(data.schedulePartyVisible ?? {});
        hapticNudge();
      }
    } catch { setPartyError("Network error."); }
    finally { setPartyAction(false); }
  }, []);

  const setPartyOnSchedule = useCallback(
    async (partyId: string, visible: boolean) => {
      setPartyError(null);
      setSchedulePartyVisible((prev) => ({ ...prev, [partyId]: visible }));
      try {
        const res = await fetch("/api/party", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "setScheduleVisibility",
            partyId,
            visible,
          }),
        });
        const data = (await res.json()) as {
          parties?: Party[];
          schedulePartyVisible?: Record<string, boolean>;
          error?: string;
        };
        if (!res.ok) {
          setPartyError(data.error ?? "Could not update");
          try {
            const recover = await fetch("/api/party");
            if (recover.ok) {
              const d = (await recover.json()) as {
                parties?: Party[];
                schedulePartyVisible?: Record<string, boolean>;
              };
              setParties(d.parties ?? []);
              setSchedulePartyVisible(d.schedulePartyVisible ?? {});
            }
          } catch {
            /* ignore */
          }
          return;
        }
        setParties(data.parties ?? []);
        setSchedulePartyVisible(data.schedulePartyVisible ?? {});
      } catch {
        setPartyError("Network error.");
        try {
          const recover = await fetch("/api/party");
          if (recover.ok) {
            const d = (await recover.json()) as {
              parties?: Party[];
              schedulePartyVisible?: Record<string, boolean>;
            };
            setParties(d.parties ?? []);
            setSchedulePartyVisible(d.schedulePartyVisible ?? {});
          }
        } catch {
          /* ignore */
        }
      }
    },
    []
  );

  /** Fire-and-forget sync of a preference change to Firestore. */
  const syncPrefToDb = useCallback(
    (prefs: { showPopularSongs?: boolean }) => {
      if (status !== "authenticated") return;
      fetch("/api/prefs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(prefs),
      }).catch(() => {});
    },
    [status]
  );

  const saveProfileValues = useCallback(async (nextName: string, nextImage: string) => {
    // Optimistic UI: reflect profile updates across local party member chips immediately.
    setProfileName(nextName);
    setProfileImage(nextImage);
    applyProfileToLocalPartyMembers(nextName, nextImage);
    setSavingProfile(true);
    try {
      const res = await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nextName, image: nextImage }),
      });
      if (!res.ok) return;
      setToastMessage("Profile saved!");
      setCopyToast(false);
      if (copyToastTimeoutRef.current) clearTimeout(copyToastTimeoutRef.current);
      setCopyToastKey((k) => k + 1);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setCopyToast(true);
          copyToastTimeoutRef.current = setTimeout(() => {
            setCopyToast(false);
          }, 900);
        });
      });
    } finally {
      setSavingProfile(false);
    }
  }, [applyProfileToLocalPartyMembers]);

  const cancelProfileEdit = useCallback(() => {
    setEditingProfile(false);
  }, []);

  const commitProfileEdit = useCallback(async () => {
    const trimmed = profileName.trim();
    if (!trimmed) {
      setToastMessage("Name cannot be empty");
      setCopyToast(false);
      if (copyToastTimeoutRef.current) clearTimeout(copyToastTimeoutRef.current);
      setCopyToastKey((k) => k + 1);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setCopyToast(true);
          copyToastTimeoutRef.current = setTimeout(() => {
            setCopyToast(false);
          }, 2000);
        });
      });
      return;
    }
    await saveProfileValues(trimmed, profileImage);
    setEditingProfile(false);
  }, [profileImage, profileName, saveProfileValues]);

  const onAvatarPick = useCallback(async (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setAvatarError("Please choose an image file.");
      return;
    }
    setAvatarError(null);
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("read_failed"));
      reader.readAsDataURL(file);
    }).catch(() => "");
    if (!dataUrl) {
      setAvatarError("Could not read image.");
      return;
    }
    // Compress to ≤128×128 JPEG to stay well under Firestore's 1MB doc limit.
    const compressed = await new Promise<string>((resolve) => {
      const img = new Image();
      img.onload = () => {
        const MAX = 128;
        const scale = Math.min(MAX / img.width, MAX / img.height, 1);
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) { resolve(dataUrl); return; }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.75));
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
    const nextName = (profileName || session?.user?.name || "").trim();
    if (!nextName) return;
    setProfileImage(compressed);
    // Save immediately if not in edit mode; otherwise wait for checkmark.
    if (!editingProfile) {
      await saveProfileValues(nextName, compressed);
    }
  }, [editingProfile, profileName, saveProfileValues, session?.user?.name]);

  const copyText = useCallback(async (
    text: string,
    type: "code" | "link",
    partyIdForFeedback?: string
  ) => {
    try {
      await navigator.clipboard.writeText(text);
      if (type === "code" && partyIdForFeedback) {
        setCodeCopiedPartyId(null);
        if (codeCopiedTimeoutRef.current) clearTimeout(codeCopiedTimeoutRef.current);
        requestAnimationFrame(() => {
          setCodeCopiedPartyId(partyIdForFeedback);
          codeCopiedTimeoutRef.current = setTimeout(() => setCodeCopiedPartyId(null), 220);
        });
      }
      // Re-trigger toast visually even if already visible.
      setToastMessage(
        type === "code" ? "Invite link copied to clipboard!" : "Link copied to clipboard!"
      );
      setCopyToast(false);
      if (copyToastTimeoutRef.current) clearTimeout(copyToastTimeoutRef.current);
      setCopyToastKey((k) => k + 1);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
        setCopyToast(true);
        copyToastTimeoutRef.current = setTimeout(() => {
          setCopyToast(false);
        }, 900);
        });
      });
    } catch {
      // non-fatal
    }
  }, []);

  useEffect(() => {
    if (copyToast) {
      hapticToast(toastMessage);
    }
  }, [copyToast, toastMessage]);

  useEffect(() => {
    return () => {
      if (copyToastTimeoutRef.current) clearTimeout(copyToastTimeoutRef.current);
      if (codeCopiedTimeoutRef.current) clearTimeout(codeCopiedTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (!editingProfile) return;
    nameInputRef.current?.focus();
    nameInputRef.current?.select();
  }, [editingProfile]);

  if (status === "loading") {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="noise-overlay" aria-hidden />
        <span className="inline-block w-5 h-5 border-2 border-muted border-t-transparent rounded-full animate-spin" />
      </main>
    );
  }

  if (!session?.user) return null;

  const { name, email, image } = session.user;
  const shownName = profileName || name || "";
  const shownImage = profileImage || image || "";

  return (
    <main className="min-h-screen">
      <div className="noise-overlay" aria-hidden />

      {/* Header */}
      <header className="z-50 sticky top-0 bg-background">
        <div className="header-canvas-strip">
          <div className="flex min-h-0 w-full items-center justify-between px-4 sm:px-6">
            <Link
              href="/schedule"
              className="font-display text-[1.3rem] font-medium text-[var(--cream)] hover:text-white transition-colors leading-none drop-shadow-[0_1px_2px_color-mix(in_srgb,var(--teal)_35%,transparent)]"
            >
              🌴 coachella planner
            </Link>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => signOut({ redirectTo: "/" })}
                className="text-[12px] font-medium text-[var(--cream)] hover:text-white transition-colors drop-shadow-[0_1px_2px_color-mix(in_srgb,var(--teal)_35%,transparent)]"
              >
                Log out
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="relative z-10 mx-auto max-w-lg px-5 py-10 sm:px-8">
        {/* Profile — display name & photo (Firestore-backed overrides) */}
        <section aria-labelledby="profile-heading">
          <h2
            id="profile-heading"
            className="font-display text-sm font-semibold tracking-wide text-muted uppercase"
          >
            Your profile
          </h2>

          <div
            className={`mt-4 rounded-lg border border-border/40 bg-[var(--hover-wash)] px-4 py-4 sm:px-5 transition-[border-color] ${
              editingProfile ? "border-cyan/40" : ""
            }`}
          >
            <div className="flex gap-4 sm:gap-5">
              <div className="flex shrink-0 flex-col items-center gap-0 sm:items-center">
                <div
                  className={`relative h-[4.5rem] w-[4.5rem] overflow-hidden rounded-full ${
                    editingProfile ? "ring-1 ring-border/50" : ""
                  }`}
                >
                  {shownImage ? (
                    <img
                      src={shownImage}
                      alt=""
                      className="h-full w-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-[var(--hover-wash-strong)] font-display text-2xl font-bold text-muted">
                      {(shownName || "?").charAt(0)}
                    </div>
                  )}
                </div>
                {editingProfile && (
                  <button
                    type="button"
                    onClick={() => avatarInputRef.current?.click()}
                    className="scratch-pill mt-2 px-2.5 py-1 text-[12px] font-medium border border-border/50 text-foreground/90 hover:bg-[var(--hover-wash)] hover:text-foreground transition-colors"
                  >
                    Change photo
                  </button>
                )}
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    void onAvatarPick(e.target.files?.[0] ?? null);
                    e.currentTarget.value = "";
                  }}
                />
              </div>

              <div className="min-w-0 flex-1 flex flex-col justify-center gap-1.5">
                {editingProfile ? (
                  <input
                    ref={nameInputRef}
                    type="text"
                    value={profileName}
                    onChange={(e) => setProfileName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void commitProfileEdit();
                      if (e.key === "Escape") cancelProfileEdit();
                    }}
                    className="w-full rounded border border-border/50 bg-background px-3 py-2.5 font-display text-lg font-semibold leading-snug text-foreground outline-none placeholder:text-muted/50 focus:border-accent/55 focus:ring-0"
                    placeholder="Display name"
                    aria-label="Display name"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setEditingProfile(true)}
                    className="w-full text-left font-display text-lg font-semibold leading-snug tracking-tight text-muted transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan/50 sm:text-xl py-0.5 rounded-sm"
                    aria-label="Edit display name"
                  >
                    {shownName || "Your name"}
                  </button>
                )}
                {email && (
                  <p
                    className={`truncate text-[14px] ${
                      editingProfile ? "text-muted/55" : "text-muted"
                    }`}
                  >
                    {email}
                  </p>
                )}
                {avatarError && (
                  <p className="pt-1 text-[12px] text-red-400">{avatarError}</p>
                )}
              </div>

              {!editingProfile && (
                <div className="flex shrink-0 flex-col items-end justify-center self-start sm:self-center">
                  <button
                    type="button"
                    onClick={() => setEditingProfile(true)}
                    className="scratch-pill px-2.5 py-1.5 text-[12px] font-medium border border-border/50 text-muted/80 hover:bg-[var(--hover-wash)] hover:text-foreground transition-colors"
                    aria-label="Edit profile"
                  >
                    Edit
                  </button>
                </div>
              )}
            </div>

            {editingProfile && (
              <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-border/35 pt-3">
                <button
                  type="button"
                  onClick={cancelProfileEdit}
                  className="scratch-pill px-3 py-1.5 text-[12px] font-medium border border-border/50 text-muted/80 hover:bg-[var(--hover-wash)] hover:text-foreground transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void commitProfileEdit()}
                  disabled={savingProfile}
                  className="scratch-pill px-3 py-1.5 text-[12px] font-medium bg-accent text-on-accent transition hover:bg-[var(--accent-hover-soft)] disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {savingProfile ? "Saving…" : "Save"}
                </button>
              </div>
            )}
          </div>
        </section>

        {/* Connections */}
        <section className="mt-10">
          <h2 className="font-display text-sm font-semibold tracking-wide text-muted uppercase">
            Connected accounts
          </h2>

          <div className="mt-4 space-y-3">
            {/* Google — always connected */}
            <div className="flex items-center justify-between rounded-lg border border-border/40 bg-[var(--hover-wash)] px-4 py-3">
              <div className="flex items-center gap-3">
                <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                </svg>
                <div>
                  <p className="text-[14px] font-medium text-foreground">Google</p>
                  <p className="text-[12px] text-muted">{email}</p>
                </div>
              </div>
              <span className="text-[12px] font-medium text-cyan">Connected</span>
            </div>

            {/* Last.fm — coming soon */}
            <div className="rounded-lg border border-border/40 bg-[var(--hover-wash)] px-4 py-3 opacity-45 pointer-events-none select-none">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <svg className="h-5 w-5 shrink-0 text-[#d51007]" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M10.584 17.21l-.88-2.392s-1.43 1.594-3.573 1.594c-1.897 0-3.244-1.649-3.244-4.288 0-3.381 1.704-4.591 3.381-4.591 2.422 0 3.19 1.567 3.849 3.574l.88 2.749c.88 2.666 2.529 4.81 7.285 4.81 3.409 0 5.718-1.044 5.718-3.793 0-2.227-1.265-3.381-3.627-3.933l-1.752-.385c-1.21-.275-1.567-.77-1.567-1.594 0-.935.742-1.484 1.952-1.484 1.32 0 2.034.495 2.144 1.677l2.749-.33c-.22-2.474-1.924-3.492-4.729-3.492-2.474 0-4.893.935-4.893 3.932 0 1.87.907 3.051 3.189 3.602l1.87.44c1.402.33 1.87.825 1.87 1.65 0 .99-.99 1.396-2.859 1.396-2.776 0-3.932-1.457-4.591-3.464l-.907-2.749c-1.155-3.573-2.997-4.893-6.653-4.893C2.144 5.333 0 7.89 0 12.233c0 4.178 2.144 6.434 5.993 6.434 3.106 0 4.591-1.457 4.591-1.457z" />
                  </svg>
                  <div>
                    <p className="text-[14px] font-medium text-foreground">Last.fm</p>
                    <p className="text-[12px] text-muted">Coming soon</p>
                  </div>
                </div>
                <span className="text-[12px] font-medium text-muted">(TBD)</span>
              </div>
            </div>
          </div>
        </section>

        {/* Preferences */}
        <section className="mt-10">
          <h2 className="font-display text-sm font-semibold tracking-wide text-muted uppercase">
            Preferences
          </h2>
          <div className="mt-4 space-y-3 rounded-lg border border-border/40 bg-[var(--hover-wash)] px-4 py-3">
            <PartyScheduleToggle
              id="pref-show-popular"
              label="Show popular songs"
              checked={showPopularSongs}
              onChange={(next) => {
                setShowPopularSongs(next);
                setShowPopularSongsPreference(next);
                syncPrefToDb({ showPopularSongs: next });
              }}
            />
          </div>
        </section>

        {/* Parties */}
        <section className="mt-10">
          <h2 className="font-display text-sm font-semibold tracking-wide text-muted uppercase">
            Coachella parties
          </h2>

          {partyLoading ? (
            <div className="mt-4 flex items-center gap-2 text-[14px] text-muted">
              <span className="inline-block w-4 h-4 border-2 border-muted border-t-transparent rounded-full animate-spin" />
              Loading…
            </div>
          ) : (
            <div className="mt-4 space-y-4">
              {parties.map((party) => (
                <div
                  key={party.id}
                  className="relative rounded-lg border border-border/40 bg-[var(--hover-wash)] px-4 py-4 space-y-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-display text-base font-semibold text-foreground truncate">
                        {party.name}
                      </p>
                      <p className="mt-1 text-[13px] text-muted">
                        Invite code below. The copy button grabs the full share link:
                      </p>
                      <div className="mt-1 flex items-center gap-1 text-cyan">
                        <span className="select-all font-mono text-lg font-bold tracking-widest">
                          {party.code}
                        </span>
                        <button
                          type="button"
                          onClick={() => copyText(getInviteUrl(party.code), "code", party.id)}
                          className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-[background-color,color,border-color] duration-75 ease-out ${
                            codeCopiedPartyId === party.id
                              ? "text-cyan bg-[color-mix(in_srgb,var(--teal)_28%,transparent)]"
                              : "text-cyan/90 hover:text-cyan hover:bg-[color-mix(in_srgb,var(--teal)_16%,transparent)] active:bg-[color-mix(in_srgb,var(--teal)_28%,transparent)]"
                          }`}
                          aria-label="Copy invite link"
                        >
                          <svg
                            viewBox="0 0 24 24"
                            className="h-[1.05rem] w-[1.05rem]"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <rect x="9" y="9" width="11" height="11" rx="2" ry="2" />
                            <path d="M5 15c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h9c1.1 0 2 .9 2 2" />
                          </svg>
                        </button>
                      </div>
                    </div>
                    <button
                      type="button"
                    onClick={() => {
                      hapticNudge();
                      void leaveParty(party.id);
                    }}
                      disabled={partyAction}
                      className="text-[12px] text-muted/70 hover:text-foreground transition-colors shrink-0 mt-1"
                    >
                      Leave
                    </button>
                  </div>

                  <div>
                    <p className="text-[13px] font-medium text-muted mb-2">
                      Members ({party.members.length})
                    </p>
                    <div className="space-y-2">
                      {party.members.map((m) => (
                        <div key={m.email} className="flex items-center gap-2.5">
                          {m.image ? (
                            <img
                              src={m.image}
                              alt=""
                              className="h-7 w-7 rounded-full object-cover"
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--hover-wash-strong)] text-[12px] font-bold text-muted">
                              {m.name.charAt(0)}
                            </div>
                          )}
                          <span className="text-[14px] text-foreground">
                            {m.name}
                            {m.email === session?.user?.email && (
                              <span className="ml-1.5 text-[12px] text-muted">(you)</span>
                            )}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="border-t border-border/35 pt-3">
                    <PartyScheduleToggle
                      id={`party-schedule-${party.id}`}
                      label="Show on schedule"
                      checked={schedulePartyVisible[party.id] !== false}
                      onChange={(next) => setPartyOnSchedule(party.id, next)}
                    />
                  </div>
                </div>
              ))}

              {parties.length === 0 && (
                <p className="text-[14px] text-muted">
                  Create or join a party to see where your friends are going on the schedule grid.
                </p>
              )}

              {parties.length > 0 && !showCreateForm && !showJoinForm && (
                <p className="text-[13px] font-medium text-muted pt-1">Add another party</p>
              )}

              {!showCreateForm && !showJoinForm && (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      hapticNudge();
                      setShowCreateForm(true);
                      setShowJoinForm(false);
                      setPartyError(null);
                    }}
                    className="scratch-pill px-4 py-2 text-[13px] font-medium bg-accent text-on-accent hover:bg-[var(--accent-hover-soft)] transition-colors"
                  >
                    Create a party
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      hapticNudge();
                      setShowJoinForm(true);
                      setShowCreateForm(false);
                      setPartyError(null);
                    }}
                    className="scratch-pill px-4 py-2 text-[13px] font-medium border border-border/50 text-foreground hover:bg-[var(--hover-wash)] transition-colors"
                  >
                    Join with code
                  </button>
                </div>
              )}

              {showCreateForm && (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    value={partyNameInput}
                    onChange={(e) => { setPartyNameInput(e.target.value); setPartyError(null); }}
                    placeholder="Party name (optional)"
                    disabled={partyAction}
                    autoFocus
                    className="min-w-0 flex-1 px-3 py-1.5 bg-background border border-border/50 rounded text-foreground text-[13px] placeholder:text-muted/50 focus:outline-none focus:border-accent/60 disabled:opacity-50"
                  />
                  <button
                    type="button"
                    disabled={partyAction}
                    onClick={() => createParty(partyNameInput.trim())}
                    className="scratch-pill px-3 py-1.5 text-[12px] font-medium bg-accent text-on-accent hover:bg-[var(--accent-hover-soft)] disabled:opacity-50"
                  >
                    {partyAction ? "Creating…" : "Create"}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowCreateForm(false); setPartyError(null); }}
                    className="text-[12px] text-muted/70 hover:text-foreground transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              )}

              {showJoinForm && (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    value={partyCodeInput}
                    onChange={(e) => { setPartyCodeInput(e.target.value.toUpperCase()); setPartyError(null); }}
                    placeholder="Enter party code"
                    disabled={partyAction}
                    autoFocus
                    maxLength={6}
                    className="w-28 px-3 py-1.5 bg-background border border-border/50 rounded text-foreground text-[14px] font-mono tracking-widest uppercase placeholder:text-muted/50 placeholder:tracking-normal placeholder:font-sans focus:outline-none focus:border-accent/60 disabled:opacity-50"
                  />
                  <button
                    type="button"
                    disabled={partyAction || partyCodeInput.trim().length < 4}
                    onClick={() => joinParty(partyCodeInput.trim())}
                    className="scratch-pill px-3 py-1.5 text-[12px] font-medium bg-accent text-on-accent hover:bg-[var(--accent-hover-soft)] disabled:opacity-50"
                  >
                    {partyAction ? "Joining…" : "Join"}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowJoinForm(false); setPartyError(null); }}
                    className="text-[12px] text-muted/70 hover:text-foreground transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              )}

              {partyError && (
                <p className="text-[12px] text-red-400">{partyError}</p>
              )}
            </div>
          )}
        </section>

        {/* Back link */}
        <div className="mt-10">
          <Link
            href="/schedule"
            className="text-[14px] text-cyan hover:text-foreground transition-colors"
          >
            ← Back to schedule
          </Link>
        </div>
      </div>
      <div
        key={copyToastKey}
        className={`pointer-events-none fixed left-1/2 top-5 z-[80] -translate-x-1/2 rounded-lg border border-[color-mix(in_srgb,var(--teal)_35%,transparent)] bg-[color-mix(in_srgb,var(--teal)_14%,var(--background))] px-4 py-2 text-[15px] font-medium text-[color-mix(in_srgb,var(--teal)_72%,var(--foreground))] shadow-[0_8px_24px_rgba(0,0,0,0.2)] backdrop-blur-sm transition-all duration-120 ${
          copyToast ? "translate-y-0 opacity-100" : "-translate-y-2 opacity-0"
        }`}
        aria-live="polite"
      >
        {toastMessage}
      </div>
    </main>
  );
}
