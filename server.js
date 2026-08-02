'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createApp } = require('./src/app');
const { getDb } = require('./src/db/connection');

const PORT = process.env.PORT ? Number(process.env.PORT) : 18102;

// Ensure the data directory exists before opening the SQLite file.
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = getDb();
const app = createApp(db);

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`rounds-ledger API listening on http://localhost:${PORT}`);
});
