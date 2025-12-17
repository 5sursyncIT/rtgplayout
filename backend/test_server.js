const http = require('http');
const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end('Hello world');
});
server.listen(3001, () => {
  console.log('Server running on port 3001');
});
