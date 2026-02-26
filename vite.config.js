import { defineConfig } from 'vite';
import { WebSocketServer } from 'ws';

export default defineConfig({
    base: './',
    server: {
        host: true,
        port: 5173
    },
    plugins: [
        {
            name: 'ws-server',
            configureServer(server) {
                const wss = new WebSocketServer({
                    noServer: true
                });

                server.httpServer.on('upgrade', (request, socket, head) => {
                    if (request.url === '/keystroke-sync') {
                        wss.handleUpgrade(request, socket, head, (ws) => {
                            wss.emit('connection', ws, request);
                        });
                    }
                });

                wss.on('connection', ws => {
                    ws.on('message', msg => {
                        wss.clients.forEach(c => {
                            if (c !== ws && c.readyState === 1) {
                                c.send(msg.toString());
                            }
                        });
                    });
                });
            }
        }
    ]
});