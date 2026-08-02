'use strict';

const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { applySchema } = require('./schema');

let db = null;

/**
 * Open (or reuse) the SQLite database connection.
 *
 * @param {string} [filename] Path to the SQLite file. Defaults to data/ledger.db.
 *                            Pass ':memory:' for an isolated in-memory database (used in tests).
 * @returns {import('node:sqlite').DatabaseSync}
 */
function getDb(filename) {
  if (db) {
    return db;
  }

  const target = filename || path.join(__dirname, '..', '..', 'data', 'ledger.db');
  db = new DatabaseSync(target);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA journal_mode = WAL;');
  applySchema(db);
  return db;
}

/**
 * Create a fresh, isolated in-memory database. Handy for tests so each suite
 * starts from a clean slate without touching the shared singleton.
 *
 * @returns {import('node:sqlite').DatabaseSync}
 */
function createMemoryDb() {
  const memory = new DatabaseSync(':memory:');
  memory.exec('PRAGMA foreign_keys = ON;');
  applySchema(memory);
  return memory;
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = { getDb, createMemoryDb, closeDb };
