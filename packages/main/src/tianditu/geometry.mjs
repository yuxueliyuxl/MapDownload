// Polygon conversion retained and extended from the previous local parser.
/** Validate Web Mercator XYZ tile coordinates. */
export function validateXYZ(tile) {
  const { x, y, z } = tile;
  if (![x, y, z].every(Number.isSafeInteger) || z < 0 || z > 30 ||
      x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) {
    throw new Error('Invalid XYZ: require integers, 0 <= z <= 30, 0 <= x,y < 2^z.');
  }
  return { x, y, z };
}

/** Twice the signed area; shifted origin reduces cancellation for lon/lat rings. */
export function area2(ring) {
  if (!ring.length) return 0;
  const [ox, oy] = ring[0];
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    sum += (a[0] - ox) * (b[1] - oy) - (b[0] - ox) * (a[1] - oy);
  }
  return sum;
}

function normalizeRing(points) {
  const ring = [];
  for (const p of points) {
    if (!Number.isSafeInteger(p.x) || !Number.isSafeInteger(p.y)) {
      throw new Error('A local geometry coordinate is not a safe integer.');
    }
    const previous = ring.at(-1);
    if (!previous || p.x !== previous[0] || p.y !== previous[1]) ring.push([p.x, p.y]);
  }
  if (ring.length && (ring[0][0] !== ring.at(-1)[0] || ring[0][1] !== ring.at(-1)[1])) {
    ring.push([...ring[0]]);
  }
  if (ring.length < 4 || area2(ring) === 0) {
    throw new Error('Degenerate polygon ring: fewer than three distinct vertices or zero area.');
  }
  return ring;
}

/**
 * MVT ordering assumption: each exterior is followed by its interiors.
 * First ring determines exterior winding, as in Mapbox's ring classifier.
 * This is NOT a topology-repair algorithm for arbitrarily ordered/invalid rings.
 */
export function groupPolygonRings(rings) {
  if (!rings.length) throw new Error('Polygon has no rings.');
  const polygons = [];
  let exteriorSign;
  for (const points of rings) {
    const ring = normalizeRing(points);
    const sign = Math.sign(area2(ring));
    exteriorSign ??= sign;
    if (sign === exteriorSign) polygons.push([ring]);
    else polygons.at(-1).push(ring);
  }
  return polygons;
}

/** Inverse Web Mercator. Do not clamp: valid tile-buffer geometry can exceed extent. */
export function projectPoint(point, extent, tile) {
  if (!Number.isSafeInteger(extent) || extent <= 0) throw new Error('Invalid layer extent.');
  const n = 2 ** tile.z;
  const u = (tile.x + point[0] / extent) / n;
  const v = (tile.y + point[1] / extent) / n;
  const lon = 360 * u - 180;
  const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * v))) * 180 / Math.PI;
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) throw new Error('Non-finite projected coordinate.');
  return [lon, lat];
}

/** Convert one decoded polygon; retain properties, holes and disconnected exteriors. */
export function polygonFeature(feature, layer, tile, featureIndex = 0) {
  validateXYZ(tile);
  if (feature.type !== 3) throw new Error('Expected decoded polygon type 3.');
  if (feature.id !== undefined && typeof feature.id !== 'string' && !Number.isSafeInteger(feature.id)) {
    throw new Error('Feature ID must be a safe integer or a decimal string.');
  }
  const coordinates = groupPolygonRings(feature.geometry).map(polygon =>
    polygon.map((ring, index) => {
      const projected = ring.map(p => projectPoint(p, layer.extent, tile));
      // GeoJSON right-hand rule: exterior CCW, interior CW in longitude/latitude.
      const area = area2(projected);
      if (area === 0) throw new Error('Projected polygon ring collapsed to zero area.');
      if ((area > 0) !== (index === 0)) projected.reverse();
      return projected;
    })
  );
  return {
    type: 'Feature',
    ...(feature.id !== undefined ? { id: feature.id } : {}),
    properties: { _layer: layer.name, ...feature.properties },
    geometry: coordinates.length === 1
      ? { type: 'Polygon', coordinates: coordinates[0] }
      : { type: 'MultiPolygon', coordinates },
    // GeoJSON foreign member: preserves provenance without overwriting source properties.
    tdt_source: { layer: layer.name, tile, featureIndex },
  };
}

/** Convert one decoded point feature to GeoJSON Point or MultiPoint. */
export function pointFeature(feature, layer, tile, featureIndex = 0) {
  validateXYZ(tile);
  if (feature.type !== 1) throw new Error('Expected decoded point type 1.');
  if (feature.id !== undefined && typeof feature.id !== 'string' && !Number.isSafeInteger(feature.id)) {
    throw new Error('Feature ID must be a safe integer or a decimal string.');
  }
  const pts = [];
  for (const group of feature.geometry) {
    for (const p of group) {
      pts.push(projectPoint([p.x, p.y], layer.extent, tile));
    }
  }
  if (!pts.length) throw new Error('Point feature has no coordinates.');
  return {
    type: 'Feature',
    ...(feature.id !== undefined ? { id: feature.id } : {}),
    properties: { _layer: layer.name, ...feature.properties },
    geometry: pts.length === 1
      ? { type: 'Point', coordinates: pts[0] }
      : { type: 'MultiPoint', coordinates: pts },
    tdt_source: { layer: layer.name, tile, featureIndex },
  };
}

/** Convert one decoded line feature to GeoJSON LineString or MultiLineString. */
export function lineFeature(feature, layer, tile, featureIndex = 0) {
  validateXYZ(tile);
  if (feature.type !== 2) throw new Error('Expected decoded line type 2.');
  const lines = feature.geometry.map(group =>
    group.map(p => projectPoint([p.x, p.y], layer.extent, tile))
  ).filter(line => line.length >= 2);
  if (!lines.length) return null;
  return {
    type: 'Feature',
    ...(feature.id !== undefined ? { id: feature.id } : {}),
    properties: { _layer: layer.name, ...feature.properties },
    geometry: lines.length === 1
      ? { type: 'LineString', coordinates: lines[0] }
      : { type: 'MultiLineString', coordinates: lines },
    tdt_source: { layer: layer.name, tile, featureIndex },
  };
}

/** Convert any supported feature (Point, LineString, Polygon) to GeoJSON. */
export function featureToGeoJSON(feature, layer, tile, featureIndex = 0) {
  if (feature.type === 3) return polygonFeature(feature, layer, tile, featureIndex);
  if (feature.type === 2) return lineFeature(feature, layer, tile, featureIndex);
  if (feature.type === 1) return pointFeature(feature, layer, tile, featureIndex);
  return null;
}


