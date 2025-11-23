const mongoose = require('mongoose');

const connectDB = async () => {
    try {
        const conn = await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/crazymd-saas', {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });

        console.log(`🗄️ MongoDB Connecté: ${conn.connection.host}`);
    } catch (error) {
        console.error('❌ Erreur connexion MongoDB:', error);
        process.exit(1);
    }
};

module.exports = connectDB;
