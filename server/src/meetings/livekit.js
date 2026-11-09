// LiveKit access: signed join tokens (no network) and host actions via its admin API.
// Unconfigured => callers get NOT_CONFIGURED; nothing is simulated.
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';

export const configured = () => !!(process.env.LIVEKIT_URL && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET);
export const publicUrl = () => process.env.LIVEKIT_URL; // wss://… for browsers
const adminClient = () => new RoomServiceClient(process.env.LIVEKIT_URL.replace(/^ws/, 'http'), process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET);
let service = null; export const setRoomService = (s) => { service = s; }; // tests inject a fake admin API
const svc = () => service || adminClient();

/** Join token. Everyone may publish/subscribe/send chat data; hosts and co-hosts also get room-admin rights. */
export async function joinToken({ room, identity, name, admin }) {
  const at = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, { identity, name, ttl: '2h' });
  at.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true, canPublishData: true, roomAdmin: !!admin });
  return at.toJwt();
}
export const removeFromRoom = (room, identity) => svc().removeParticipant(room, identity).catch(() => {}); // already gone is fine
export const endRoom = (room) => svc().deleteRoom(room).catch(() => {});
export async function muteParticipant(room, identity) {
  const p = await svc().getParticipant(room, identity).catch(() => null);
  for (const t of p?.tracks || []) if (t.type === 0 /* AUDIO */ && !t.muted) await svc().mutePublishedTrack(room, identity, t.sid, true);
}
export async function muteAll(room, exceptIdentity) {
  for (const p of await svc().listParticipants(room).catch(() => [])) if (p.identity !== exceptIdentity) await muteParticipant(room, p.identity);
}
