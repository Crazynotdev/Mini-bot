#!/bin/bash

echo "🚀 Déploiement CRAZY-MD SaaS Pro..."

# Arrêter le service existant
sudo systemctl stop crazymd-saas

# Backup de la base de données
mongodump --uri="mongodb://localhost:27017/crazymd-saas" --out="/backup/$(date +%Y%m%d)"

# Mise à jour du code
git pull origin main

# Installation des dépendances
npm install --production

# Construction des assets
npm run build

# Démarrage du service
sudo systemctl start crazymd-saas

echo "✅ Déploiement terminé!"
