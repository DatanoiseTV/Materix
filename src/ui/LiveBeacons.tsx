// Live-location panel shown above the composer: renders every active beacon in
// the room (yours and others') with a map that recenters as positions update.

import { useState } from "react";
import type { MatrixAccount } from "../core/account";
import type { LiveBeacon } from "../core/types";
import { useClock, useRoomVersion } from "./hooks";
import { liveShare } from "./liveShare";
import { Avatar } from "./components/Avatar";
import { IconLocation } from "./components/Icons";
import { useToast } from "./components/Toast";

function agoText(ts: number | undefined, now: number): string {
  if (!ts) return "waiting for location…";
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  return `${m}m ago`;
}

function expiresText(expiresTs: number, now: number): string {
  const s = Math.max(0, Math.round((expiresTs - now) / 1000));
  if (s <= 0) return "ending";
  if (s < 60) return `${s}s left`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m left`;
  return `${Math.round(m / 60)}h left`;
}

export function LiveBeacons({ account, roomId }: { account: MatrixAccount; roomId: string }) {
  useRoomVersion(account, roomId);
  const now = useClock(1000);
  const { showError } = useToast();

  let beacons: LiveBeacon[] = [];
  try {
    beacons = account.room(roomId).liveBeacons();
  } catch {
    return null;
  }
  if (beacons.length === 0) return null;

  return (
    <div className="beacons-panel">
      {beacons.map((b) => (
        <BeaconCard
          key={b.id}
          beacon={b}
          account={account}
          now={now}
          onStop={() => liveShare.stop(account.key, roomId).catch(showError)}
        />
      ))}
    </div>
  );
}

function BeaconCard({
  beacon,
  account,
  now,
  onStop,
}: {
  beacon: LiveBeacon;
  account: MatrixAccount;
  now: number;
  onStop: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasPos = beacon.lat !== undefined && beacon.lon !== undefined;
  // Small bounding box around the point for the OSM embed; recentres whenever
  // lat/lon change, so the map visibly follows a moving beacon.
  const d = 0.004;
  const bbox = hasPos
    ? `${beacon.lon! - d},${beacon.lat! - d},${beacon.lon! + d},${beacon.lat! + d}`
    : "";
  const embedSrc = hasPos
    ? `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${beacon.lat},${beacon.lon}`
    : "";
  const openUrl = hasPos
    ? `https://www.openstreetmap.org/?mlat=${beacon.lat}&mlon=${beacon.lon}#map=16/${beacon.lat}/${beacon.lon}`
    : undefined;

  return (
    <div className="beacon-card">
      <div className="beacon-head">
        <span className="beacon-pin">
          <IconLocation size={16} />
        </span>
        <Avatar account={account} mxc={beacon.owner.avatarUrl} name={beacon.owner.name} id={beacon.owner.userId} size={28} />
        <div className="beacon-meta">
          <div className="beacon-name">
            {beacon.mine ? "You are sharing live location" : `${beacon.owner.name} is sharing live location`}
          </div>
          <div className="beacon-sub">
            {agoText(beacon.updatedTs, now)} · {expiresText(beacon.expiresTs, now)}
          </div>
        </div>
        {hasPos && (
          <button className="btn secondary small" onClick={() => setExpanded((v) => !v)}>
            {expanded ? "Hide map" : "Show map"}
          </button>
        )}
        {beacon.mine && (
          <button className="btn danger small" onClick={onStop}>
            Stop
          </button>
        )}
      </div>
      {expanded && hasPos && (
        <div className="beacon-map">
          {/* key on rounded coords so the iframe reloads (recenters) as it moves */}
          <iframe
            key={`${beacon.lat!.toFixed(4)},${beacon.lon!.toFixed(4)}`}
            title={`Live location of ${beacon.owner.name}`}
            src={embedSrc}
            loading="lazy"
          />
          <div className="beacon-map-foot">
            <span>
              {beacon.lat!.toFixed(5)}, {beacon.lon!.toFixed(5)}
              {beacon.accuracy ? ` · ±${Math.round(beacon.accuracy)}m` : ""}
            </span>
            {openUrl && (
              <a href={openUrl} target="_blank" rel="noopener noreferrer">
                Open in maps
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
