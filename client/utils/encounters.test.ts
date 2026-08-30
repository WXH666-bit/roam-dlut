import { findNearbyUnreadMessages, findUnannouncedEncounterIds } from './encounters';
import type { AliveMessageBrief } from './api';

const message = (id: string, lat: number, lng: number): AliveMessageBrief => ({
  id,
  lat,
  lng,
  created_at: 1,
});

describe('findNearbyUnreadMessages', () => {
  const origin = { lat: 38.88192768, lng: 121.52139591 };

  it('returns every unread message inside 50 metres, nearest first', () => {
    const result = findNearbyUnreadMessages(origin, [
      message('far', origin.lat + 0.00035, origin.lng),
      message('near', origin.lat + 0.00005, origin.lng),
      message('outside', origin.lat + 0.001, origin.lng),
    ], new Set(), 50);

    expect(result.map((item) => item.id)).toEqual(['near', 'far']);
  });

  it('filters read messages and invalid locations', () => {
    expect(findNearbyUnreadMessages(
      origin,
      [message('read', origin.lat, origin.lng), message('unread', origin.lat, origin.lng)],
      new Set(['read']),
      50
    ).map((item) => item.id)).toEqual(['unread']);
    expect(findNearbyUnreadMessages(null, [], new Set(), 50)).toEqual([]);
  });

  it('does not re-announce known messages when nearest order changes', () => {
    const first = [
      { id: 'a', distanceMeters: 8 },
      { id: 'b', distanceMeters: 12 },
    ];
    expect(findUnannouncedEncounterIds(first, new Set())).toEqual(['a', 'b']);
    expect(findUnannouncedEncounterIds(first.toReversed(), new Set(['a', 'b']))).toEqual([]);
    expect(findUnannouncedEncounterIds(first, new Set(['a']))).toEqual(['b']);
  });
});
