import { settings, authorize, sameOrigin, readJson, json, fail, HttpError } from "../server/security.js";
import { decodeAudio, transcribe } from "../server/transcription.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") throw new HttpError(405, "Method not allowed.");
    const cfg = settings();
    await authorize(req, cfg);
    sameOrigin(req, cfg);
    const body = await readJson(req, 2_700_000);
    json(res, 200, { text: await transcribe(decodeAudio(body?.audio)) });
  } catch (error) { fail(res, error); }
}
