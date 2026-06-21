'use strict';

const dgram = require('dgram');

class UdpMulticastListener {
    constructor(config, onMessage) {
        this.multicastGroups = config.multicastGroups || [
            { address: '239.192.0.1', port: 8600, category: 48 },
            { address: '239.192.0.2', port: 8601, category: 62 }
        ];
        this.interface = config.interface || '0.0.0.0';
        this.onMessage = onMessage;
        this.sockets = [];
        this.stats = { packets: 0, bytes: 0, errors: 0 };
    }

    async start() {
        for (const group of this.multicastGroups) {
            await this._bindGroup(group);
        }
        console.log(`[UDP] Listening on ${this.sockets.length} multicast groups`);
    }

    _bindGroup(group) {
        return new Promise((resolve, reject) => {
            const socket = dgram.createSocket({
                type: 'udp4',
                reuseAddr: true
            });

            socket.on('error', (err) => {
                console.error(`[UDP] Socket error on ${group.address}:${group.port}:`, err.message);
                this.stats.errors++;
                try { socket.close(); } catch (e) {}
                setTimeout(() => this._bindGroup(group), 3000);
            });

            socket.on('listening', () => {
                try {
                    socket.addMembership(group.address, this.interface);
                    socket.setMulticastLoopback(false);
                    socket.setMulticastTTL(128);
                    console.log(`[UDP] Bound ${group.address}:${group.port} (CAT ${group.category})`);
                    this.sockets.push({ socket, group });
                    resolve();
                } catch (e) {
                    reject(e);
                }
            });

            socket.on('message', (msg, rinfo) => {
                this.stats.packets++;
                this.stats.bytes += msg.length;
                this.onMessage(msg, { ...group, from: rinfo });
            });

            socket.bind(group.port, this.interface);
        });
    }

    getStats() {
        return { ...this.stats };
    }

    stop() {
        for (const s of this.sockets) {
            try { s.socket.close(); } catch (e) {}
        }
        this.sockets = [];
    }
}

module.exports = UdpMulticastListener;
