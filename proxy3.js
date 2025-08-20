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

// Función para testear conectividad al destino
function testConnection() {
    console.log("[TEST] Testing connection to " + dhost + ":" + dport);
    const testConn = net.createConnection({
        host: dhost, 
        port: dport,
        timeout: 5000
    });
    
    testConn.on('connect', function() {
        console.log("[TEST] ✓ Connection successful to " + dhost + ":" + dport);
        testConn.destroy();
    });
    
    testConn.on('error', function(error) {
        console.log("[TEST] ✗ Connection failed to " + dhost + ":" + dport + " - " + error.message);
        console.log("[TEST] Common issues:");
        console.log("[TEST] - Check if host is reachable: ping " + dhost);
        console.log("[TEST] - Check if port is open: telnet " + dhost + " " + dport);
        console.log("[TEST] - Verify firewall rules");
        console.log("[TEST] - Check DNS resolution");
    });
    
    testConn.on('timeout', function() {
        console.log("[TEST] ✗ Connection timeout to " + dhost + ":" + dport);
        testConn.destroy();
    });
}

const server = net.createServer();

server.on('connection', function(socket) {
    let packetCount = 0;
    let isFirstPacket = true;
    let remoteConnected = false;
    let dataBuffer = [];
    
    const clientAddr = parseRemoteAddr(socket.remoteAddress);
    console.log("[INFO] Connection received from " + clientAddr + ":" + socket.remotePort);
    
    // Crear conexión al destino con timeout
    const conn = net.createConnection({
        host: dhost, 
        port: dport,
        timeout: 10000 // 10 segundos timeout
    });
    
    conn.on('connect', function() {
        remoteConnected = true;
        console.log("[INFO] Connected to remote " + dhost + ":" + dport);
        
        // Procesar buffer de datos pendientes
        if (dataBuffer.length > 0) {
            console.log("[INFO] Processing buffered data packets: " + dataBuffer.length);
            dataBuffer.forEach(data => {
                try {
                    conn.write(data);
                } catch (error) {
                    console.log("[ERROR] Failed to write buffered data: " + error.message);
                }
            });
            dataBuffer = [];
        }
    });
    
    conn.on('error', function(error) {
        console.log("[REMOTE] Connection error to " + dhost + ":" + dport + " - " + error.message);
        
        // Enviar respuesta 502 Bad Gateway si es HTTP
        if (!socket.destroyed) {
            try {
                const errorResponse = "HTTP/1.1 502 Bad Gateway\r\n" +
                                    "Content-Type: text/html\r\n" +
                                    "Connection: close\r\n" +
                                    "Content-Length: 54\r\n\r\n" +
                                    "<html><body><h1>502 Bad Gateway</h1></body></html>";
                socket.write(errorResponse);
                setTimeout(() => socket.destroy(), 100);
            } catch (e) {
                socket.destroy();
            }
        }
    });
    
    conn.on('timeout', function() {
        console.log("[REMOTE] Connection timeout to " + dhost + ":" + dport);
        conn.destroy();
    });
    
    conn.on('close', function() {
        console.log("[REMOTE] Connection closed to " + dhost + ":" + dport);
        if (!socket.destroyed) {
            socket.destroy();
        }
    });
    
    // Manejar datos del cliente
    socket.on('data', function(data) {
        console.log("[DEBUG] Received " + data.length + " bytes from client");
        
        // Si es el primer paquete, verificar si es HTTP
        if (isFirstPacket) {
            const dataStr = data.toString();
            if (dataStr.startsWith('GET ') || dataStr.startsWith('POST ') || dataStr.startsWith('PUT ') || dataStr.startsWith('HEAD ')) {
                console.log("[INFO] HTTP request detected: " + dataStr.split('\n')[0]);
            }
            isFirstPacket = false;
        }
        
        // Si no está conectado al remoto, bufferear datos
        if (!remoteConnected) {
            console.log("[WARNING] Remote not connected, buffering data");
            dataBuffer.push(data);
            return;
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
            console.log("[DEBUG] Forwarded " + data.length + " bytes to remote");
        } catch (error) {
            console.log("[ERROR] Failed to write to remote: " + error.message);
            socket.destroy();
        }
    });
    
    // Manejar datos del destino
    conn.on('data', function(data) {
        console.log("[DEBUG] Received " + data.length + " bytes from remote");
        if (!socket.destroyed) {
            try {
                socket.write(data);
                console.log("[DEBUG] Forwarded " + data.length + " bytes to client");
            } catch (error) {
                console.log("[ERROR] Failed to write to client: " + error.message);
                conn.destroy();
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
        console.log("[INFO] Client connection terminated " + clientAddr + ":" + socket.remotePort);
        if (!conn.destroyed) {
            conn.destroy();
        }
    });
    
    socket.on('timeout', function() {
        console.log("[INFO] Client socket timeout " + clientAddr + ":" + socket.remotePort);
        socket.destroy();
    });
    
    // Establecer timeout para el cliente
    socket.setTimeout(30000); // 30 segundos
});

server.on('error', function(error) {
    console.log("[SERVER] Error: " + error.message);
});

server.listen(mainPort, function(){
    console.log("[INFO] Proxy server started on port: " + mainPort);
    console.log("[INFO] Redirecting requests to: " + dhost + ":" + dport);
    console.log("[INFO] Packets to skip: " + packetsToSkip);
    console.log("[INFO] WebSocket mode: " + (useWebSocket ? "enabled" : "disabled"));
    
    // Test inicial de conectividad
    setTimeout(testConnection, 1000);
});
