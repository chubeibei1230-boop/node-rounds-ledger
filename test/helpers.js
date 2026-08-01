process.env.DB_FILE = ':memory:';

const app = require('../src/app');

function startServer() {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      resolve({ server, baseUrl: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

async function request(baseUrl, method, path, body) {
  const options = { method, headers: {} };
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  const response = await fetch(`${baseUrl}${path}`, options);
  const json = await response.json();
  return { status: response.status, body: json };
}

module.exports = { startServer, request };
