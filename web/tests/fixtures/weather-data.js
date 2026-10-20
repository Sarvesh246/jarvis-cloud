// Fixed provider-shaped data for renderer tests and the browser fixture.
export const forecast = {
  version: 1, title: 'College Station, Texas', timezone: 'America/Chicago', unit: '°F', windUnit: 'mp/h',
  localTime: '2026-10-20T10:00', retrieved: '2026-10-20T15:00:00+00:00',
  current: { time: '2026-10-20T10:00', temperature: 68, feels: 67, humidity: 54, wind: 7, condition: 'Clear sky', isDay: true },
  periods: ['2026-10-20','2026-10-21','2026-10-22'].map((day,i) => ({
    label: day, high: 83-i*3, low: i===2 ? null : 56-i, condition: i===2 ? 'Rain' : 'Clear sky', rain: i===2 ? 63 : 3, wind: 9, uv: 5.2,
    sunrise: `${day}T07:30`, sunset: `${day}T18:48`,
    hours: Array.from({length:24},(_,hour) => ({time:`${day}T${String(hour).padStart(2,'0')}:00`,temperature: Math.round(68+12*Math.sin(hour/24*Math.PI)),rain:i===2?63:3,condition:i===2?'Rain':'Clear sky',isDay:hour>=7&&hour<19})),
  })),
};
export const weatherContent = `\`\`\`weather\n${JSON.stringify(forecast)}\n\`\`\`\n\nWeather for College Station\n\n| Day | Conditions | High (°F) | Low (°F) |\n|---|---|---|---|\n| 2026-10-20 | Clear sky | 83 | 56 |\n\n[Open-Meteo](https://open-meteo.com/)`;
