"use client";

import { memo, useEffect } from "react";
import BottomSheet from "@/components/BottomSheet";
import { CloseIcon, EmptyState, ErrorState, IconButton, SkeletonRows } from "@/components/ui";
import {
  markAnnouncementsSeen,
  refreshAnnouncements,
  refreshAnnouncementsIfStale,
  useAnnouncements,
} from "@/lib/client/announcements";

interface Props {
  desktop: boolean;
  onClose: () => void;
}

/** Carrier service announcements (delays, detours). Mounted only while open,
 *  like StopView/TripView. */
function AnnouncementsSheet({ desktop, onClose }: Props) {
  const { status, items } = useAnnouncements();

  useEffect(() => {
    refreshAnnouncementsIfStale();
  }, []);
  /* clear the unread dot once the current set is actually on screen */
  useEffect(() => {
    if (status === "ready") markAnnouncementsSeen();
  }, [status]);

  const header = (
    <header className="px-4 pb-3 pt-2 md:pt-4">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[16px] font-bold leading-tight text-text">Utrudnienia</h2>
          <p className="mt-1 text-[11px] text-text-faint">Komunikaty przewoźnika</p>
        </div>
        <IconButton label="Zamknij komunikaty" onClick={onClose}>
          <CloseIcon />
        </IconButton>
      </div>
    </header>
  );

  return (
    <BottomSheet desktop={desktop} onClose={onClose} ariaLabel="Utrudnienia w ruchu" header={header}>
      <div
        className="kb-scroll h-full overflow-y-auto px-4 animate-fade"
        style={{ paddingBottom: "max(5rem, calc(3rem + env(safe-area-inset-bottom, 24px)))" }}
      >
        {status === "error" ? (
          <ErrorState onRetry={() => void refreshAnnouncements()} />
        ) : status === "ready" && items.length === 0 ? (
          <EmptyState text="Brak komunikatów o utrudnieniach." />
        ) : status === "ready" ? (
          <ul>
            {items.map((a) => (
              <li key={`${a.id}-${a.rev}`} className="mb-2 rounded-2xl bg-white/4 p-4">
                <p className="whitespace-pre-line text-[13px] leading-relaxed text-text-mute">
                  {a.content_markdown}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <SkeletonRows />
        )}
      </div>
    </BottomSheet>
  );
}

export default memo(AnnouncementsSheet);
