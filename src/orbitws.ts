import WebSocket from 'ws';
import http from 'http';
import url from 'url';
import fs from 'fs';
import { ChildProcess, spawn } from 'child_process'

const PORT = 8080;

const server = http.createServer();
const wss = new WebSocket.Server({ noServer: true });

let child: ChildProcess | undefined;

const writeFile = (path: string, res: http.ServerResponse, contentType: string) => {
  const s = fs.createReadStream(path);
  s.on('error', () => {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.write('Internal server error: Failed to read file');
    res.end();
  });
  s.on('open', () => {
    res.writeHead(200, { 'Content-Type': contentType });
  });
  s.on('data', (chunk) => {
    res.write(chunk);
  })
  s.on('end', () => res.end());
}

server.on('request', (req, res) => {
  const reqUrl = url.parse(req.url);
  if (reqUrl.pathname === '/') {
    writeFile('index.html', res, 'text/html; charset=utf-8');
  } else if (reqUrl.pathname === '/client.js') {
    writeFile('client.js', res, 'application/javascript');
  } else if (reqUrl.pathname === '/font.bin') {
    writeFile('font/font.bin', res, 'application/octec-stream');
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.on('upgrade', (req, socket, head) => {
  const reqUrl = url.parse(req.url);
  if (reqUrl.pathname === '/data') {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  } else {
    socket.destroy();
  }
});

wss.on('connection', (ws) => {
  if (child) {
    console.log('Already running');
    ws.close();
  } else {
    console.log('New child');
    child = spawn('../orbitc/orbitc', {
      cwd: '../orbitc/'
    });
    console.log(`Child process PID: ${child.pid}`);

    child.stdout?.on('data', (chunk) => {
      ws.send(chunk, {binary: true});
    });
    child.stderr?.pipe(process.stderr);
    child.on('exit', (code, sig) => {
      if (code !== 0) {
        console.log(`Abnormal termination, sig = ${sig}`);
      }
      ws.close();
    });
  }

  ws.on('message', (msg) => {
    if (child && child.stdin) {
      child.stdin.write(msg);
    }
  });

  ws.on('close', () => {
    console.log('Close');
    if (child) {
      child.kill();
    }
    child = undefined;
  });
});

server.listen(PORT);
