const { port } = require('./config');
const { getDb } = require('./db/connection');
const app = require('./app');

getDb();

app.listen(port, () => {
  console.log(`node-rounds-ledger listening on port ${port}`);
});
