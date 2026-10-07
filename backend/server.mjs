import http from 'node:http';
import handler from './api/chat.js';

const port = Number(process.env.PORT || 8787);
const server = http.createServer(async (request, response) => {
  if (request.url !== '/api/chat') {
    response.statusCode = 404;
    return response.end('Not found');
  }
  await handler(request, response);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Xinyu companion API listening on http://127.0.0.1:${port}`);
});
