import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seattleAddressForm, isSeattleAddress, inPugetSound, PUGET_SOUND_ZIP } from '../src/bounds.js';
import { streetKey } from '../src/locations.js';

test('seattleAddressForm: a Seattle address comes back in the form a permit candidate carries', () => {
  const form = '1546 15th Ave, Seattle, WA 98122';
  for (const written of [form, '1546 15th Ave Seattle WA 98122', '1546 15th Ave, Seattle WA 98122', '1546 15th Ave,Seattle,WA,98122',
    '  1546 15th Ave ,  Seattle ,  WA   98122 ', '1546 15th Ave, Seattle, Washington 98122', '1546 15th Ave, seattle, wa 98122',
    '1546 15th Ave, Seattle, WA 98122-4028', '1546 15th Ave, Seattle, WA 98122, USA', '1546 15th Ave, Seattle, WA. 98122, United States']) {
    assert.equal(seattleAddressForm(written), form, written);
  }
  // the street line is kept as written, unit and all
  assert.equal(seattleAddressForm('2318 2nd Ave, Suite B, Seattle, WA 98121'), '2318 2nd Ave, Suite B, Seattle, WA 98121');
  assert.equal(seattleAddressForm('223 W Galer St, A, Seattle, WA 98119'), '223 W Galer St, A, Seattle, WA 98119');
  // a street that is itself named Seattle
  assert.equal(seattleAddressForm('4100 SW Seattle St, Seattle, WA 98116'), '4100 SW Seattle St, Seattle, WA 98116');
});

test('seattleAddressForm: anything that does not name Seattle with a Seattle ZIP is not one', () => {
  for (const other of ['12 Main St, Bellevue, WA 98004', '12 Main St, Seattle, WA', '12 Main St, Seattle, WA 98004', '12 Main St, Seattle, OR 97201',
    '12 Main St, Seattle, WA 97201', '12 Main St, WA 98122', '12 Seattle St, Tacoma, WA 98402', 'Seattle, WA 98122', '12 Main St', '',
    '12 Main St, Seattle, WA 98122 and more', '12 Main St, Seattle, WA 981220', null, undefined, 98122]) {
    assert.equal(seattleAddressForm(other), null, String(other));
  }
});

test('seattleAddressForm: what it returns is what the rest of the pipeline reads as a Seattle address', () => {
  for (const written of ['1546 15th Ave Seattle WA 98122', '2318 2nd Ave, Suite B, Seattle, Washington 98121-1234, USA']) {
    const form = seattleAddressForm(written);
    // the geocoder and the map look for ", Seattle, WA"; the validator for a Puget Sound ZIP
    assert.ok(isSeattleAddress(form), form);
    assert.match(form, PUGET_SOUND_ZIP);
    assert.match(form, /, Seattle, WA\b/);
    // already in the form, it is left exactly as it is
    assert.equal(seattleAddressForm(form), form);
  }
  // one door written two ways is one street key once it is in the form
  assert.equal(streetKey(seattleAddressForm('1546 15th Avenue Seattle WA 98122')), streetKey('1546 15TH AVE, Seattle, WA 98122'));
});

test('inPugetSound: two numbers inside the box, and nothing else', () => {
  assert.equal(inPugetSound(47.6062, -122.3321), true);
  for (const [lat, lon] of [[45.52, -122.68], [47.66, -117.43], [-122.33, 47.61], ['47.6', '-122.3'], [47.6, undefined], [null, null], [NaN, NaN]]) {
    assert.equal(inPugetSound(lat, lon), false, `${lat}, ${lon}`);
  }
});
