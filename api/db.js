const { MongoClient } = require('mongodb');
require('dotenv').config();

let cachedDb = null;

async function connectToDatabase() {
  if (cachedDb) return cachedDb;
  
  const client = new MongoClient(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
  
  await client.connect();
  const db = client.db('myanlearn');
  cachedDb = db;
  return db;
}

module.exports = { connectToDatabase };