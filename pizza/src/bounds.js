/*
 * The one geographic rule: what counts as "in the region" for an address and
 * for the coordinates that address geocodes to.
 *
 * The research validator checks an address by ZIP, the geocoder checks the
 * point Nominatim returns, and the dataset lint checks both. All three read
 * this module, and the box is drawn around the whole ZIP range, so an address
 * the validator accepts cannot fail the lint once it has coordinates.
 */

/* Region check by ZIP, not by city name: a chain opens somewhere a city list
 * has never heard of, and ZIP prefixes need no maintenance.
 *
 *   980xx  King and Snohomish suburbs (Bellevue, Kent, Mill Creek)
 *   981xx  Seattle proper
 *   982xx  Everett and north, to the border
 *   983xx  Kitsap and the Olympic Peninsula
 *   984xx  Pierce County (Tacoma)
 *   985xx  Thurston County (Olympia) and the south-west
 */
export const PUGET_SOUND_ZIP = /\b98[0-5]\d{2}\b/;
export const PUGET_SOUND_ZIP_LABEL = '980xx-985xx';

/* Everything those six prefixes cover: Winlock to Blaine, Neah Bay to the
 * Cascade crest. Wider than "Puget Sound" strictly means, for the same reason
 * the ZIP range is: this catches a geocode in another state, not a suburb. */
export const PUGET_SOUND_BOX = { latMin: 46.3, latMax: 49.05, lonMin: -124.8, lonMax: -120.9 };

export const inPugetSound = (lat, lon) =>
  typeof lat === 'number' && typeof lon === 'number'
  && lat > PUGET_SOUND_BOX.latMin && lat < PUGET_SOUND_BOX.latMax
  && lon > PUGET_SOUND_BOX.lonMin && lon < PUGET_SOUND_BOX.lonMax;

/* The map plots Seattle addresses only (the inclusion rule), so only these
 * are worth geocoding. Same test the page uses to decide what to plot. */
export const isSeattleAddress = address => /,\s*Seattle,\s*WA/i.test(String(address ?? ''));
