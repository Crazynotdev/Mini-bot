require('dotenv').config();
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const { Boom } = require('@hapi/boom');
const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, makeCacheableSignalKeyStore } = require('@whiskeysockets/baileys');
const pino = require('pino');
const path = require('path');
const fs = require('fs-extra');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 3000;

// Connexion base de données
require('./config/database');

// Middleware de sécurité
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com", "https://cdnjs.cloudflare.com"],
            scriptSrc: ["'self'", "https://cdnjs.cloudflare.com", "https://cdn.jsdelivr.net"],
            fontSrc: ["'self'", "https://cdnjs.cloudflare.com"],
        },
    },
}));

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100 // limite chaque IP à 100 requêtes par windowMs
});
app.use(limiter);

// Sessions
app.use(session({
    secret: process.env.SESSION_SECRET || 'your-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: process.env.NODE_ENV === 'production' }
}));

// Routes
app.use('/auth', require('./saas/routes/auth'));
app.use('/bot', require('./saas/routes/bot'));
app.use('/admin', require('./saas/routes/admin'));
app.use('/api', require('./saas/routes/analytics'));

// Servir les fichiers statiques
app.use(express.static('saas/views'));
app.use('/assets', express.static('saas/assets'));

// Gestionnaire de sessions utilisateurs amélioré
const userSessions = new Map();

class ProUserSession {
    constructor(userId, userData) {
        this.userId = userId;
        this.userData = userData;
        this.socket = null;
        this.isConnected = false;
        this.connectionTime = null;
        this.lastActivity = new Date();
        this.metrics = {
            messagesSent: 0,
            messagesReceived: 0,
            commandsExecuted: 0,
            uptime: 0
        };
        this.sessionPath = `./storage/sessions/${userId}`;
    }

    async initialize() {
        try {
            await fs.ensureDir(this.sessionPath);
            
            const { state, saveCreds } = await useMultiFileAuthState(this.sessionPath);
            const { version } = await fetchLatestBaileysVersion();
            
            this.socket = makeWASocket({
                version,
                logger: pino({ level: 'silent' }),
                printQRInTerminal: false,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' })),
                },
                markOnlineOnConnect: true,
            });

            this.socket.ev.on('creds.update', saveCreds);
            this.socket.ev.on('connection.update', this.handleConnectionUpdate.bind(this));
            this.socket.ev.on('messages.upsert', this.handleMessagesUpsert.bind(this));

            // Enregistrer la session en base
            await this.saveToDatabase();

        } catch (error) {
            console.error(`Erreur initialisation session ${this.userId}:`, error);
            throw error;
        }
    }

    handleConnectionUpdate(update) {
        const { connection, lastDisconnect, qr } = update;
        
        this.lastActivity = new Date();

        if (qr) {
            console.log(`🔐 QR Code généré pour ${this.userId}`);
            this.emitEvent('qr_generated', { userId: this.userId, qr });
        }

        if (connection === 'close') {
            this.isConnected = false;
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== 401;
            
            if (shouldReconnect) {
                console.log(`🔄 Reconnexion pour ${this.userId}`);
                setTimeout(() => this.initialize(), 5000);
            } else {
                console.log(`❌ Session expirée pour ${this.userId}`);
                this.cleanup();
            }
        } else if (connection === 'open') {
            this.isConnected = true;
            this.connectionTime = new Date();
            console.log(`✅ ${this.userId} connecté avec succès`);
            this.emitEvent('connected', { userId: this.userId });
        }
    }

    handleMessagesUpsert({ messages }) {
        if (!messages[0]) return;
        
        const message = messages[0];
        this.lastActivity = new Date();
        this.metrics.messagesReceived++;

        if (!message.key.fromMe && message.message) {
            this.metrics.commandsExecuted++;
            this.handleCommand(message);
        }

        this.updateMetrics();
    }

    async handleCommand(message) {
        const text = message.message.conversation || 
                    message.message.extendedTextMessage?.text || 
                    message.message.imageMessage?.caption || '';
        
        if (text.startsWith('!')) {
            const command = text.slice(1).toLowerCase().split(' ')[0];
            const args = text.slice(1).toLowerCase().split(' ').slice(1);
            
            try {
                switch(command) {
                    case 'ping':
                        await this.socket.sendMessage(message.key.remoteJid, { text: '🏓 Pong! Bot SaaS Pro actif' });
                        break;
                    case 'menu':
                        const menu = await this.generateMenu();
                        await this.socket.sendMessage(message.key.remoteJid, { text: menu });
                        break;
                    case 'stats':
                        const stats = this.getStats();
                        await this.socket.sendMessage(message.key.remoteJid, { text: stats });
                        break;
                    case 'broadcast':
                        if (this.userData.role === 'admin') {
                            await this.handleBroadcast(args, message);
                        }
                        break;
                    default:
                        await this.socket.sendMessage(message.key.remoteJid, { 
                            text: '❌ Commande non reconnue. Tapez !menu pour voir les commandes disponibles.' 
                        });
                }
            } catch (error) {
                await this.socket.sendMessage(message.key.remoteJid, { 
                    text: '⚠️ Erreur lors de l\'exécution de la commande.' 
                });
            }
        }
    }

    async generateMenu() {
        const uptime = Math.floor((new Date() - this.connectionTime) / 1000 / 60);
        return `
🤖 *CRAZY-MD SaaS PRO* 🤖

📊 *Statistiques:*
• Messages: ${this.metrics.messagesSent} envoyés
• Commandes: ${this.metrics.commandsExecuted} exécutées
• Uptime: ${uptime} minutes

🛠 *Commandes:*
!ping - Test de réponse
!menu - Afficher ce menu
!stats - Statistiques détaillées
!broadcast - Diffusion (admin)

👤 *Utilisateur:* ${this.userData.username}
📧 *Plan:* ${this.userData.plan || 'Starter'}

*Bot SaaS Professionnel by CrazyNotDev*
        `;
    }

    getStats() {
        const uptime = Math.floor((new Date() - this.connectionTime) / 1000 / 60);
        return `
📊 *STATISTIQUES DÉTAILLÉES*

🤖 Bot: CRAZY-MD SaaS Pro
👤 Utilisateur: ${this.userData.username}
🔗 Statut: ${this.isConnected ? '🟢 Connecté' : '🔴 Déconnecté'}
⏰ Uptime: ${uptime} minutes

📨 Messages envoyés: ${this.metrics.messagesSent}
📩 Messages reçus: ${this.metrics.messagesReceived}
⚡ Commandes exécutées: ${this.metrics.commandsExecuted}

🕒 Dernière activité: ${this.lastActivity.toLocaleTimeString()}
        `;
    }

    async requestPairingCode(phoneNumber) {
        if (!this.socket) await this.initialize();
        
        try {
            const code = await this.socket.requestPairingCode(phoneNumber.replace(/\s/g, ''));
            return { success: true, code };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    emitEvent(event, data) {
        // Pour les WebSockets en temps réel
        if (global.io) {
            global.io.emit(`user:${this.userId}:${event}`, data);
        }
    }

    async cleanup() {
        if (this.socket) {
            try {
                await this.socket.logout();
            } catch (error) {
                console.error('Erreur logout:', error);
            }
        }
        
        userSessions.delete(this.userId);
        
        try {
            await fs.remove(this.sessionPath);
        } catch (error) {
            console.error('Erreur nettoyage fichiers:', error);
        }
    }

    async saveToDatabase() {
        // Implémentation sauvegarde en base
        const Session = require('./saas/models/Session');
        await Session.findOneAndUpdate(
            { userId: this.userId },
            {
                userId: this.userId,
                isConnected: this.isConnected,
                connectionTime: this.connectionTime,
                lastActivity: this.lastActivity,
                metrics: this.metrics
            },
            { upsert: true, new: true }
        );
    }

    updateMetrics() {
        if (this.connectionTime) {
            this.metrics.uptime = Math.floor((new Date() - this.connectionTime) / 1000);
        }
        this.saveToDatabase();
    }
}

// Dashboard route
app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'saas/views/user/dashboard.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'saas/views/admin/index.html'));
});

const server = app.listen(PORT, () => {
    console.log(`🚀 CRAZY-MD SaaS Pro démarré sur le port ${PORT}`);
    console.log(`📊 Dashboard: http://localhost:${PORT}/dashboard`);
    console.log(`👨‍💼 Admin: http://localhost:${PORT}/admin`);
});

const io = require('socket.io')(server);
global.io = io;

io.on('connection', (socket) => {
    console.log('🔌 Client connecté via WebSocket');
    
    socket.on('disconnect', () => {
        console.log('🔌 Client déconnecté');
    });
});

module.exports = { ProUserSession, userSessions, app };
