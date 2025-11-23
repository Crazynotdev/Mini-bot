const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    phoneNumber: { type: String, required: true },
    plan: { 
        type: String, 
        enum: ['starter', 'pro', 'enterprise'],
        default: 'starter'
    },
    status: {
        type: String,
        enum: ['active', 'inactive', 'suspended'],
        default: 'active'
    },
    limits: {
        sessions: { type: Number, default: 1 },
        messagesPerDay: { type: Number, default: 1000 }
    },
    billing: {
        stripeCustomerId: String,
        subscriptionId: String,
        currentPeriodEnd: Date
    },
    createdAt: { type: Date, default: Date.now },
    lastLogin: Date
});

module.exports = mongoose.model('User', userSchema);
