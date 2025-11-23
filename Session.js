const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema({
    userId: { type: String, required: true, index: true },
    isConnected: { type: Boolean, default: false },
    connectionTime: Date,
    lastActivity: Date,
    metrics: {
        messagesSent: { type: Number, default: 0 },
        messagesReceived: { type: Number, default: 0 },
        commandsExecuted: { type: Number, default: 0 },
        uptime: { type: Number, default: 0 }
    },
    deviceInfo: {
        platform: String,
        browser: String,
        version: String
    }
});

module.exports = mongoose.model('Session', sessionSchema);
