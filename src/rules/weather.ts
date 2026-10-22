import type { DayForecast } from '../types';

/** Turns a daily forecast for the trip dates into the engine's weather bands. */

export function summariseForecast(days: DayForecast[], from?: string, to?: string): { temperature: 'hot' | 'warm' | 'mild' | 'cool' | 'cold'; rain: 'dry' | 'showers' | 'monsoon'; inRange: DayForecast[] } | undefined {
  if (!from) return undefined;
  const end = to ?? from;
  const inRange = days.filter((d) => d.date >= from && d.date <= end);
  if (!inRange.length) return undefined;
  const avgMax = inRange.reduce((s, d) => s + d.tMax, 0) / inRange.length;
  const minMin = Math.min(...inRange.map((d) => d.tMin));
  const rainy = inRange.filter((d) => d.rainProb >= 50 || d.rainMm >= 2).length;
  const heavy = inRange.reduce((s, d) => s + d.rainMm, 0) / inRange.length;
  let temperature: 'hot' | 'warm' | 'mild' | 'cool' | 'cold' = 'warm';
  if (avgMax >= 34) temperature = 'hot';
  else if (avgMax >= 27) temperature = 'warm';
  else if (avgMax >= 21) temperature = 'mild';
  else temperature = 'cool';
  if (minMin <= 10) temperature = 'cold';
  else if (minMin <= 15 && temperature !== 'hot') temperature = 'cool';
  const rain = heavy >= 8 ? 'monsoon' : rainy > 0 ? 'showers' : 'dry';
  return { temperature, rain, inRange };
}

