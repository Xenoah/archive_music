import { loadTracks, reportTracks } from "./lib/tracks.mjs";
import { loadConfig } from "./lib/util.mjs";

const tracks = await loadTracks(await loadConfig());
if (reportTracks(tracks) > 0) process.exit(1);
