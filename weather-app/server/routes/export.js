/**
 * /api/export  — Data export (Assessment 2.3)
 *
 * GET /api/export?format=json|csv|xml|markdown&type=searches|range|locations
 */

const express = require('express');
const { query, validationResult } = require('express-validator');
const { queries } = require('../db');
const { rangeDb } = require('./range');

const router = express.Router();

function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty())
    return res.status(422).json({ error: 'Validation failed', details: errors.array() });
  next();
}

// ── Formatters ────────────────────────────────────────────────────────────────

function toCSV(rows) {
  if (!rows.length) return '';
  // Flatten one level: nested objects become JSON strings
  const flat = rows.map(r => {
    const out = {};
    for (const [k, v] of Object.entries(r)) {
      if (k.startsWith('_') && k !== '_id') continue;  // skip NeDB internals
      out[k] = typeof v === 'object' && v !== null ? JSON.stringify(v) : v;
    }
    return out;
  });
  const headers = Object.keys(flat[0]);
  const escape  = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return [
    headers.join(','),
    ...flat.map(r => headers.map(h => escape(r[h])).join(',')),
  ].join('\n');
}

function toXML(rows, rootTag, itemTag) {
  const esc = s => String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  const objToXml = (obj, indent = '  ') => {
    return Object.entries(obj)
      .filter(([k]) => !k.startsWith('_') || k === '_id')
      .map(([k, v]) => {
        if (typeof v === 'object' && v !== null) {
          return `${indent}<${k}>${JSON.stringify(v)}</${k}>`;
        }
        return `${indent}<${k}>${esc(v)}</${k}>`;
      }).join('\n');
  };

  const items = rows.map(r =>
    `  <${itemTag}>\n${objToXml(r, '    ')}\n  </${itemTag}>`
  ).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>\n<${rootTag}>\n${items}\n</${rootTag}>`;
}

function toMarkdown(rows, title) {
  if (!rows.length) return `# ${title}\n\n_No records found._`;

  // Pick key columns for display
  const exclude = new Set(['raw_json', 'forecast', '__v']);
  const sampleKeys = Object.keys(rows[0]).filter(k => !exclude.has(k) && (!k.startsWith('_') || k === '_id'));

  const header = `| ${sampleKeys.join(' | ')} |`;
  const sep    = `| ${sampleKeys.map(() => '---').join(' | ')} |`;
  const bodyRows = rows.map(r =>
    `| ${sampleKeys.map(k => {
      const v = r[k];
      if (v == null) return '';
      if (typeof v === 'object') return JSON.stringify(v).replace(/\|/g, '\\|');
      return String(v).replace(/\|/g, '\\|');
    }).join(' | ')} |`
  );

  return `# ${title}\n\n_Exported: ${new Date().toISOString()}_\n\n${header}\n${sep}\n${bodyRows.join('\n')}`;
}

// ── Route ─────────────────────────────────────────────────────────────────────

router.get(
  '/',
  [
    query('format')
      .optional()
      .isIn(['json', 'csv', 'xml', 'markdown'])
      .withMessage('format must be: json, csv, xml, or markdown'),
    query('type')
      .optional()
      .isIn(['searches', 'range', 'locations'])
      .withMessage('type must be: searches, range, or locations'),
  ],
  validate,
  async (req, res) => {
    const format = req.query.format || 'json';
    const type   = req.query.type   || 'searches';

    try {
      let rows = [];
      let title = '';

      if (type === 'searches') {
        rows  = await queries.getAllSearches(500);
        title = 'Weather Search History';
        // strip raw_json to keep export lean
        rows  = rows.map(({ raw_json, ...r }) => r);

      } else if (type === 'range') {
        const result = await rangeDb.findAsync({}).sort({ createdAt: -1 }).limit(500);
        rows  = result.map(({ forecast, ...r }) => r);   // omit large forecast array
        title = 'Date-Range Weather Queries';

      } else if (type === 'locations') {
        rows  = await queries.getAllLocations();
        title = 'Saved Locations';
        rows  = rows.map(({ lat_lon, ...r }) => r);       // omit internal composite key
      }

      // ── Serialise ──────────────────────────────────────────────────────────

      if (format === 'json') {
        res.setHeader('Content-Disposition', `attachment; filename="skies-${type}.json"`);
        res.setHeader('Content-Type', 'application/json');
        return res.json({ exported_at: new Date().toISOString(), type, count: rows.length, data: rows });
      }

      if (format === 'csv') {
        res.setHeader('Content-Disposition', `attachment; filename="skies-${type}.csv"`);
        res.setHeader('Content-Type', 'text/csv');
        return res.send(toCSV(rows));
      }

      if (format === 'xml') {
        const tags = { searches: ['SearchHistory', 'search'], range: ['RangeQueries', 'query'], locations: ['Locations', 'location'] };
        const [rootTag, itemTag] = tags[type];
        res.setHeader('Content-Disposition', `attachment; filename="skies-${type}.xml"`);
        res.setHeader('Content-Type', 'application/xml');
        return res.send(toXML(rows, rootTag, itemTag));
      }

      if (format === 'markdown') {
        res.setHeader('Content-Disposition', `attachment; filename="skies-${type}.md"`);
        res.setHeader('Content-Type', 'text/markdown');
        return res.send(toMarkdown(rows, title));
      }

    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

module.exports = router;
