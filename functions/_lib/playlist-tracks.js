/* The tracks of a member's playlists, asked for once.
 *
 * Both the account page and the profile used to walk the playlists one at a
 * time and ask for each one's tracks separately - so a member with a dozen
 * playlists ran a dozen queries every time either page was read. The
 * account is read on every load and again after every save.
 *
 * So the tracks of all of the playlists are asked for in one go, in chunks
 * of ninety so the number of placeholders stays well inside what the
 * database will take.
 *
 * Returns a map of playlist id to its tracks, in the order they were added.
 */
export async function loadPlaylistTracks(db, playlists) {
  const byPlaylist = new Map();
  const ids = (playlists || [])
    .map((p) => Number(p.id))
    .filter((n) => Number.isFinite(n));
  if (!ids.length) return byPlaylist;

  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    if (!chunk.length) continue;
    const marks = chunk.map(() => "?").join(",");
    let rows;
    try {
      rows = await db.prepare(
        `SELECT playlist_id, id, title FROM playlist_tracks WHERE playlist_id IN (${marks}) ORDER BY playlist_id, id ASC`
      ).bind(...chunk).all();
    } catch (_) {
      rows = { results: [] };
    }
    for (const r of rows.results || []) {
      const key = Number(r.playlist_id);
      if (!byPlaylist.has(key)) byPlaylist.set(key, []);
      byPlaylist.get(key).push({ id: r.id, title: r.title });
    }
  }
  return byPlaylist;
}
