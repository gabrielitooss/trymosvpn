/*
* Proxy Bridge - Fixed Version
* Copyright PANCHO7532 - P7COMUnications LLC (c) 2021
* Dedicated to Emanuel Miranda, for giving me the idea to make this :v
*/
const crypto = require("crypto");
const net = require('net');
const stream = require('stream');
const util = require('util');

var dhost = process.env.DHOST || "vps1.trymos.com";
var dport = process.env.DPORT || 22;
var mainPort = process.env.PORT || 8080;
var outputFile = "outputFile.txt";
var packetsToSkip = process.env.PACKSKIP || 0; // Cambiado a 0 por defecto
var gcwarn = true;
var useWebSocket = process.env.WEBSOCKET || false;

// Procesar argumentos de línea de comandos
for(let c = 0; c < process.argv.length; c++) {
    switch(process.argv[c]) {
        case "-skip":
            packetsToSkip = parseInt(process.argv[c + 1]) || 0;
            break;
        case "-dhost":
            dhost = process.argv[c + 1];
            break;
        case "-dport":
            dport = parseInt(process.argv[c + 1]) || 22;
            break;
        case "-mport":
            mainPort = parseInt(process.argv[c + 1]) || 8080;
            break;
        case "-o":
            outputFile = process.argv[c + 1];
            break;
        case "-websocket":
            useWebSocket = true;
            break;
    }
}

function gcollector() {
    if(!global.gc && gcwarn) {
        console.log("[WARNING] Garbage Collector isn't enabled! Memory leaks may occur.");
        gcwarn = false;
        return;
    } else if(global.gc) {
        global.gc();
        return;
    }
}

function parseRemoteAddr(raddr) {
    if(raddr && raddr.toString().indexOf("ffff") != -1) {
        return raddr.substring(7, raddr.length);
    }
    return raddr;
}

setInterval(gcollector, 5000); // Reducido la frecuencia

const server = net.createServer();

server.on('connection', function(socket) {
    let packetCount = 0;
    let isFirstPacket = true;
    let remoteConnected = false;
    
    const clientAddr = parseRemoteAddr(socket.remoteAddress);
    console.log("[INFO] Connection received from " + clientAddr + ":" + socket.remotePort);
    
    // Crear conexión al destino
    const conn = net.createConnection({host: dhost, port: dport});
    
    conn.on('connect', function() {
        remoteConnected = true;
        console.log("[INFO] Connected to remote " + dhost + ":" + dport);
    });
    
    conn.on('error', function(error) {
        console.log("[REMOTE] Error: " + error.message);
        if (!socket.destroyed) {
            socket.destroy();
        }
    });
    
    conn.on('close', function() {
        console.log("[REMOTE] Connection closed");
        if (!socket.destroyed) {
            socket.destroy();
        }
    });
    
    // Manejar datos del cliente
    socket.on('data', function(data) {
        if (!remoteConnected) {
            console.log("[WARNING] Remote not connected yet, buffering data");
            return;
        }
        
        // Solo enviar respuesta WebSocket si está habilitado y es el primer paquete
        if (useWebSocket && isFirstPacket) {
            const wsResponse = "HTTP/1.1 101 Switching Protocols\r\n" +
                              "Connection: Upgrade\r\n" +
                              "Date: " + new Date().toUTCString() + "\r\n" +
                              "Sec-WebSocket-Accept: " + Buffer.from(crypto.randomBytes(20)).toString("base64") + "\r\n" +
                              "Upgrade: websocket\r\n" +
                              "Server: p7ws/0.1a\r\n\r\n";
            socket.write(wsResponse);
            isFirstPacket = false;
        }
        
        // Lógica de skip mejorada
        if (packetCount < packetsToSkip) {
            packetCount++;
            console.log("[DEBUG] Skipping packet " + packetCount + "/" + packetsToSkip);
            return;
        }
        
        // Reenviar datos al destino
        try {
            conn.write(data);
        } catch (error) {
            console.log("[ERROR] Failed to write to remote: " + error.message);
        }
    });
    
    // Manejar datos del destino
    conn.on('data', function(data) {
        if (!socket.destroyed) {
            try {
                socket.write(data);
            } catch (error) {
                console.log("[ERROR] Failed to write to client: " + error.message);
            }
        }
    });
    
    // Manejar errores y cierre del cliente
    socket.on('error', function(error) {
        console.log("[SOCKET] Error from " + clientAddr + ":" + socket.remotePort + " - " + error.message);
        if (!conn.destroyed) {
            conn.destroy();
        }
    });
    
    socket.on('close', function() {
        console.log("[INFO] Connection terminated for " + clientAddr + ":" + socket.remotePort);
        if (!conn.destroyed) {
            conn.destroy();
        }
    });
    
    socket.on('timeout', function() {
        console.log("[INFO] Socket timeout for " + clientAddr + ":" + socket.remotePort);
        socket.destroy();
    });
    
    // Establecer timeout
    socket.setTimeout(300000); // 5 minutos
});

server.on('error', function(error) {
    console.log("[SERVER] Error: " + error.message);
});

server.listen(mainPort, function(){
    console.log("[INFO] Proxy server started on port: " + mainPort);
    console.log("[INFO] Redirecting requests to: " + dhost + ":" + dport);
    console.log("[INFO] Packets to skip: " + packetsToSkip);
    console.log("[INFO] WebSocket mode: " + (useWebSocket ? "enabled" : "disabled"));
});
