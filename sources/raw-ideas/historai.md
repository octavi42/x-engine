# Raw Ideas — HistorAI

---

- HistorAI uses Firecrawl Search to pull real-time info about a location, then feeds it to ElevenLabs Conversational AI — the latency from GPS ping to audio narration is under 3 seconds
- building HistorAI with Expo means I can test the GPS narrator on my actual phone while walking around Bucharest — the dev loop for location-based apps is surprisingly fast with EAS
- Nominatim reverse geocoding is free and accurate enough for HistorAI — considered Google Maps API but didn't want the cost at prototype stage
