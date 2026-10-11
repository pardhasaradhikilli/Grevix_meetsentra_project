// How many people can be on VIDEO at once. Our calls are peer-to-peer (every person connects to every other),
// which gets heavy fast. Beyond this number, extra people join as AUDIENCE: they still get chat, polls,
// reactions, hand-raise and engagement features, but no video. A media server (SFU) would raise this limit.
export const MAX_VIDEO_PEERS = 6;

// entries: [[uid, { host, joinedAt }], ...]  ->  Set of uids who get video. The host always gets a slot.
export function pickVideoSet(entries, max = MAX_VIDEO_PEERS) {
  const sorted = [...entries].sort(([ua, a], [ub, b]) =>
    (b.host ? 1 : 0) - (a.host ? 1 : 0) || (a.joinedAt ?? 0) - (b.joinedAt ?? 0) || (ua < ub ? -1 : 1));
  return new Set(sorted.slice(0, max).map(([uid]) => uid));
}
