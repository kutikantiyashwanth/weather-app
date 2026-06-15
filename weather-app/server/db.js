/**
 * Database layer using NeDB — a pure-JavaScript embedded NoSQL document store.
 *
 * Collections (equivalent to tables):
 *   searches          — every weather query made by the user
 *   weather_snapshots — the weather data returned for each search
 *   saved_locations   — locations the user has bookmarked
 *
 * All CRUD operations are exposed via the `queries` object so routes stay clean.
 */

const Datastore = require('@seald-io/nedb');
const path = require('path');
const fs   = require('fs');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// ── Collections ───────────────────────────────────────────────────────────────

const searches = new Datastore({
  filename: path.join(dataDir, 'searches.db'),
  autoload: true,
  timestampData: true,   // adds createdAt / updatedAt automatically
});

const snapshots = new Datastore({
  filename: path.join(dataDir, 'snapshots.db'),
  autoload: true,
  timestampData: true,
});

const locations = new Datastore({
  filename: path.join(dataDir, 'locations.db'),
  autoload: true,
  timestampData: true,
});

// Unique constraint: same lat/lon can't be saved twice
locations.ensureIndex({ fieldName: 'lat_lon', unique: true });

// ── Queries object ────────────────────────────────────────────────────────────

const queries = {

  // ── searches ──────────────────────────────────────────────────────────────

  /** CREATE — insert a search record, return the new doc */
  insertSearch: (data) => searches.insertAsync(data),

  /** READ — get one search by internal _id */
  getSearchById: (id) => searches.findOneAsync({ _id: id }),

  /**
   * READ — get the N most recent searches, joined with their snapshot summary.
   * NeDB doesn't have JOIN, so we fetch both collections and merge in-memory.
   */
  getAllSearches: async (limit = 20) => {
    const recentSearches = await searches
      .findAsync({})
      .sort({ createdAt: -1 })
      .limit(limit);

    if (!recentSearches.length) return [];

    const ids = recentSearches.map((s) => s._id);
    const snaps = await snapshots.findAsync({ search_id: { $in: ids } });
    const snapMap = {};
    for (const s of snaps) snapMap[s.search_id] = s;

    return recentSearches.map((s) => ({
      ...s,
      temp_c:         snapMap[s._id]?.temp_c ?? null,
      condition:      snapMap[s._id]?.condition ?? null,
      condition_icon: snapMap[s._id]?.condition_icon ?? null,
    }));
  },

  /**
   * DELETE — remove a search and its associated snapshot.
   * NeDB has no cascade, so we delete both manually.
   */
  deleteSearch: async (id) => {
    const count = await searches.removeAsync({ _id: id }, {});
    await snapshots.removeAsync({ search_id: id }, {});
    return count;
  },

  // ── weather_snapshots ──────────────────────────────────────────────────────

  /** CREATE — insert a snapshot tied to a search */
  insertSnapshot: (data) => snapshots.insertAsync(data),

  /** READ — get snapshot for a search */
  getSnapshotBySearchId: (search_id) => snapshots.findOneAsync({ search_id }),

  /** UPDATE — overwrite snapshot data */
  updateSnapshot: (search_id, data) =>
    snapshots.updateAsync({ search_id }, { $set: data }, {}),

  // ── saved_locations ────────────────────────────────────────────────────────

  /** CREATE — save a location (unique by lat+lon) */
  insertLocation: async (data) => {
    // Build a composite key so we can enforce uniqueness
    const doc = { ...data, lat_lon: `${data.lat},${data.lon}` };
    try {
      return await locations.insertAsync(doc);
    } catch (e) {
      if (e.errorType === 'uniqueViolated') {
        const err = new Error('Location already saved');
        err.status = 409;
        throw err;
      }
      throw e;
    }
  },

  /** READ — all saved locations sorted by name */
  getAllLocations: () =>
    locations.findAsync({}).sort({ name: 1 }),

  /** READ — one location by _id */
  getLocationById: (id) => locations.findOneAsync({ _id: id }),

  /** UPDATE — rename a saved location */
  updateLocation: (id, name) =>
    locations.updateAsync({ _id: id }, { $set: { name } }, {}),

  /** DELETE — remove a saved location */
  deleteLocation: (id) => locations.removeAsync({ _id: id }, {}),

  /** READ — find recent coord search to prevent GPS duplicates */
  findRecentCoordSearch: (lat, lon, since) =>
    searches.findOneAsync({
      lat: { $gte: lat - 0.01, $lte: lat + 0.01 },
      lon: { $gte: lon - 0.01, $lte: lon + 0.01 },
      createdAt: { $gte: new Date(since) },
    }),
};

module.exports = { queries };
