const path = require('node:path');

module.exports = {
  port: process.env.PORT ? Number(process.env.PORT) : 18102,
  dbFile: process.env.DB_FILE || path.join(__dirname, '..', 'data', 'ledger.db'),
};
