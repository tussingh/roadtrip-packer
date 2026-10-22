// TEST-ONLY fictional road grid and places ("Testpur"). Never shipped as map data.
/**
 * A 6×6 grid of fictional roads, 0.15° apart, inside SYN_BBOX. Row 2 is a
 * fast "NH 900" highway; one diagonal one-way link; one isolated road island
 * that is deliberately unreachable.
 */
export function syntheticWays() {
  const ways = [];
  const x0 = 77.1;
  const y0 = 12.1;
  const step = 0.15;
  for (let r = 0; r < 6; r++) {
    const y = y0 + r * step;
    const coords = [];
    for (let c = 0; c < 6; c++) {
      coords.push([x0 + c * step, y]);
      if (c < 5) coords.push([x0 + c * step + step / 2, y + 0.0004]); // shape point
    }
    ways.push({ coords, tags: r === 2 ? { highway: 'trunk', ref: 'NH 900', name: 'Testpur Highway' } : { highway: 'secondary', name: `Row Road ${r}` } });
  }
  for (let c = 0; c < 6; c++) {
    const x = x0 + c * step;
    ways.push({ coords: Array.from({ length: 6 }, (_, r) => [x, y0 + r * step]), tags: { highway: 'tertiary', name: `Column Road ${c}` } });
  }
  ways.push({ coords: [[x0, y0], [x0 + step, y0 + step]], tags: { highway: 'primary', oneway: 'yes', name: 'Diagonal One-way' } });
  // isolated island (not connected to anything)
  ways.push({ coords: [[77.95, 12.95], [77.98, 12.98]], tags: { highway: 'secondary', name: 'Island Road' } });
  return ways;
}

export function syntheticPois() {
  const p = (lon, lat, tags) => ({ lon, lat, tags });
  return [
    p(77.1, 12.1, { place: 'town', name: 'Testpur' }),
    p(77.85, 12.85, { place: 'town', name: 'Mockanahalli', 'name:en': 'Mockanahalli' }),
    p(77.475, 12.4, { place: 'village', name: 'Sampleville' }),
    p(77.32, 12.402, { amenity: 'fuel', brand: 'Example Fuels' }),
    p(77.55, 12.401, { amenity: 'restaurant', name: 'Highway Dosa Corner' }),
    p(77.7, 12.399, { amenity: 'toilets' }),
    p(77.4, 12.42, { amenity: 'hospital', name: 'Testpur General Hospital' }),
    p(77.62, 12.38, { amenity: 'pharmacy', name: 'Care Pharmacy' }),
    p(77.25, 12.405, { highway: 'rest_area', name: 'NH 900 Rest Stop' }),
    p(80.5, 15.0, { amenity: 'fuel', name: 'Outside the box' }), // filtered by bbox
  ];
}

