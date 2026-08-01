const express = require('express');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

const app = express();

app.use(express.json());

app.use('/api/v1/devices', require('./routes/devices'));
app.use('/api/v1/checklists', require('./routes/checklists'));
app.use('/api/v1/rounds', require('./routes/rounds'));
app.use('/api/v1/exceptions', require('./routes/exceptions'));
app.use('/api/v1/stats', require('./routes/stats'));

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
