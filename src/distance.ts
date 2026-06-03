const ORIGIN = 'South Jordan, UT 84095';

interface DistanceMatrixResponse {
  rows?: Array<{
    elements?: Array<{
      status: string;
      distance?: { value: number };
    }>;
  }>;
}

export async function getDrivingDistanceMiles(destination: string): Promise<number | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return null;

  const url = new URL('https://maps.googleapis.com/maps/api/distancematrix/json');
  url.searchParams.set('origins', ORIGIN);
  url.searchParams.set('destinations', destination);
  url.searchParams.set('mode', 'driving');
  url.searchParams.set('key', apiKey);

  const response = await fetch(url.toString());
  const data = await response.json() as DistanceMatrixResponse;

  const element = data.rows?.[0]?.elements?.[0];
  if (element?.status !== 'OK') return null;

  const meters = element.distance?.value;
  return meters != null ? Math.round(meters / 1609.34) : null;
}
