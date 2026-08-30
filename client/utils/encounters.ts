import type { AliveMessageBrief } from './api';
import { haversineMeters } from './haversine';

export interface NearbyEncounter {
  id: string;
  distanceMeters: number;
}

/** Return unread messages inside the radius, nearest first. */
export const findNearbyUnreadMessages = (
  location: { lat: number; lng: number } | null | undefined,
  messages: AliveMessageBrief[],
  readIds: ReadonlySet<string>,
  radiusMeters: number
): NearbyEncounter[] => {
  if (
    !location
    || !Number.isFinite(location.lat)
    || !Number.isFinite(location.lng)
    || !Number.isFinite(radiusMeters)
    || radiusMeters < 0
  ) return [];

  return messages
    .filter((message) => !readIds.has(message.id))
    .map((message) => ({
      id: message.id,
      distanceMeters: haversineMeters(location.lat, location.lng, message.lat, message.lng),
    }))
    .filter((message) => Number.isFinite(message.distanceMeters) && message.distanceMeters <= radiusMeters)
    .sort((left, right) => left.distanceMeters - right.distanceMeters || left.id.localeCompare(right.id));
};

/** IDs that have never produced an encounter cue, independent of nearest-order jitter. */
export const findUnannouncedEncounterIds = (
  nearby: NearbyEncounter[],
  announcedIds: ReadonlySet<string>
): string[] => {
  const seen = new Set(announcedIds);
  const result: string[] = [];
  for (const encounter of nearby) {
    if (seen.has(encounter.id)) continue;
    seen.add(encounter.id);
    result.push(encounter.id);
  }
  return result;
};
