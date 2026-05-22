import { MongoClient } from 'mongodb';
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config();

const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);
let db = null;

// Initialize Gemini for Embeddings
let ai = null;
if (process.env.GEMINI_API_KEY) {
  ai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
}

export async function connectDB() {
  if (db) return db;
  try {
    await client.connect();
    db = client.db('penny_db');
    console.log('✅ Connected successfully to MongoDB Atlas');
    return db;
  } catch (error) {
    console.error('❌ MongoDB Connection Error:', error);
    throw error;
  }
}

export function getDB() {
  if (!db) throw new Error('Database not connected. Call connectDB() first.');
  return db;
}

/**
 * Generate a vector embedding for a given text using Gemini's text-embedding-004 model.
 */
export async function getVectorEmbedding(text) {
  if (!process.env.GEMINI_API_KEY) {
    console.warn('⚠️ GEMINI_API_KEY is not set. Returning a mock 768-dimension vector.');
    return Array(768).fill(0).map(() => Math.random());
  }

  try {
    if (!ai) {
      ai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    }
    const model = ai.getGenerativeModel({ model: "text-embedding-004" });
    const result = await model.embedContent(text);
    return result.embedding.values;
  } catch (error) {
    console.error('❌ Error generating embedding:', error);
    // Fallback to random vector for robustness during testing/scaffolding
    return Array(768).fill(0).map(() => Math.random());
  }
}

/**
 * Performs MongoDB Atlas Vector Search to match an incoming merchant name to a standardized merchant in database.
 */
export async function findMatchingMerchant(merchantName) {
  const database = getDB();
  const merchantsCol = database.collection('merchants');
  
  // 1. Get embedding for the input merchant name
  const queryVector = await getVectorEmbedding(merchantName);
  
  // 2. Perform Atlas Vector Search
  const pipeline = [
    {
      $vectorSearch: {
        index: "vector_index", // Name of the Atlas Vector Search Index
        path: "embedding",
        queryVector: queryVector,
        numCandidates: 10,
        limit: 1
      }
    },
    {
      $project: {
        name: 1,
        category: 1,
        score: { $meta: "vectorSearchScore" }
      }
    }
  ];

  try {
    const results = await merchantsCol.aggregate(pipeline).toArray();
    if (results.length > 0 && results[0].score > 0.7) {
      console.log(`🎯 Vector Search matched '${merchantName}' to standard merchant '${results[0].name}' (Score: ${results[0].score.toFixed(2)})`);
      return results[0];
    }
    
    console.log(`❓ No vector search match for '${merchantName}' (or score too low). Treating as new merchant.`);
    return null;
  } catch (error) {
    console.error('❌ Vector Search failed:', error);
    return null;
  }
}

/**
 * Aggregation Pipeline to calculate category-wise expenditures for a user.
 */
export async function getSpendAnalysis(userId = "user_default") {
  const database = getDB();
  const transactionsCol = database.collection('transactions');
  
  const pipeline = [
    { $match: { userId: userId } },
    {
      $group: {
        _id: "$category",
        totalSpent: { $sum: "$amount" },
        count: { $sum: 1 }
      }
    },
    {
      $project: {
        category: "$_id",
        totalSpent: 1,
        count: 1,
        _id: 0
      }
    },
    { $sort: { totalSpent: -1 } }
  ];

  try {
    return await transactionsCol.aggregate(pipeline).toArray();
  } catch (error) {
    console.error('❌ Spend analysis aggregation failed:', error);
    return [];
  }
}
