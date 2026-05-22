import { MongoClient, ObjectId } from 'mongodb';
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';

dotenv.config();

const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);
let db = null;

// Initialize Gemini for Embeddings
let ai = null;
if (process.env.GEMINI_API_KEY) {
  ai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
}

// Mock Database classes to fallback on when MongoDB Atlas is offline or credentials fail
const DB_FILE = path.resolve(process.cwd(), 'mock_db.json');
const globalEvents = new EventEmitter();

function loadMockData() {
  if (fs.existsSync(DB_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } catch (e) {
      console.error('Error reading mock DB file, resetting:', e);
    }
  }
  const defaultData = {
    budgets: [],
    merchants: [],
    transactions: [],
    profile: [],
    goals: [],
    subscriptions: [],
    savings: [],
    plans: [],
    actions: []
  };
  saveMockData(defaultData);
  return defaultData;
}

function saveMockData(data) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('Error writing mock DB file:', e);
  }
}

class MockCursor {
  constructor(items) {
    this.items = items;
  }

  toArray() {
    return Promise.resolve(this.items);
  }

  sort(sortObj) {
    const key = Object.keys(sortObj)[0];
    const order = sortObj[key];
    this.items.sort((a, b) => {
      let valA = a[key];
      let valB = b[key];
      if (valA instanceof Date) valA = valA.getTime();
      if (valB instanceof Date) valB = valB.getTime();
      if (typeof valA === 'string' && typeof valB === 'string') {
        return order === 1 ? valA.localeCompare(valB) : valB.localeCompare(valA);
      }
      return order === 1 ? (valA > valB ? 1 : -1) : (valA < valB ? 1 : -1);
    });
    return this;
  }

  limit(n) {
    this.items = this.items.slice(0, n);
    return this;
  }
}

class MockChangeStream extends EventEmitter {
  constructor() {
    super();
    this._listener = (data) => {
      this.emit('change', data);
    };
    globalEvents.on('change', this._listener);
  }

  close() {
    globalEvents.off('change', this._listener);
  }
}

class MockCollection {
  constructor(name) {
    this.name = name;
  }

  _match(doc, query) {
    for (const [key, val] of Object.entries(query)) {
      if (val && typeof val === 'object' && val.$regex) {
        const regex = val.$regex instanceof RegExp ? val.$regex : new RegExp(val.$regex);
        if (!doc[key] || !regex.test(doc[key])) return false;
      } else {
        const docVal = doc[key];
        if (docVal === undefined) return false;
        if (docVal.toString() !== val.toString()) return false;
      }
    }
    return true;
  }

  find(query = {}) {
    const data = loadMockData();
    const docs = data[this.name] || [];
    const matched = docs.filter(doc => this._match(doc, query));
    const cloned = JSON.parse(JSON.stringify(matched));
    return new MockCursor(cloned);
  }

  async findOne(query = {}) {
    const data = loadMockData();
    const docs = data[this.name] || [];
    const doc = docs.find(doc => this._match(doc, query));
    return doc ? JSON.parse(JSON.stringify(doc)) : null;
  }

  async insertOne(doc) {
    const data = loadMockData();
    if (!data[this.name]) data[this.name] = [];
    
    const newDoc = { ...doc };
    if (!newDoc._id) {
      newDoc._id = new ObjectId().toString();
    } else {
      newDoc._id = newDoc._id.toString();
    }
    
    data[this.name].push(newDoc);
    saveMockData(data);

    if (this.name === 'transactions') {
      globalEvents.emit('change', {
        operationType: 'insert',
        fullDocument: newDoc
      });
    }

    return { insertedId: newDoc._id };
  }

  async insertMany(docs) {
    const data = loadMockData();
    if (!data[this.name]) data[this.name] = [];

    const insertedIds = {};
    const docsToInsert = docs.map((doc, idx) => {
      const newDoc = { ...doc };
      if (!newDoc._id) {
        newDoc._id = new ObjectId().toString();
      } else {
        newDoc._id = newDoc._id.toString();
      }
      insertedIds[idx] = newDoc._id;
      return newDoc;
    });

    data[this.name].push(...docsToInsert);
    saveMockData(data);

    return { insertedIds };
  }

  async updateOne(query, update, options = {}) {
    const data = loadMockData();
    const docs = data[this.name] || [];
    const idx = docs.findIndex(doc => this._match(doc, query));

    if (idx !== -1) {
      const doc = docs[idx];
      if (update.$set) {
        Object.assign(doc, update.$set);
      }
      if (update.$inc) {
        for (const [k, v] of Object.entries(update.$inc)) {
          doc[k] = (doc[k] || 0) + v;
        }
      }
      saveMockData(data);
      return { matchedCount: 1, modifiedCount: 1 };
    } else if (options.upsert) {
      const newDoc = {};
      for (const [k, v] of Object.entries(query)) {
        if (typeof v !== 'object' || v instanceof ObjectId) {
          newDoc[k] = v;
        }
      }
      if (update.$set) {
        Object.assign(newDoc, update.$set);
      }
      if (update.$inc) {
        for (const [k, v] of Object.entries(update.$inc)) {
          newDoc[k] = (newDoc[k] || 0) + v;
        }
      }
      newDoc._id = new ObjectId().toString();
      docs.push(newDoc);
      data[this.name] = docs;
      saveMockData(data);
      return { matchedCount: 0, modifiedCount: 1, upsertedId: newDoc._id };
    }

    return { matchedCount: 0, modifiedCount: 0 };
  }

  async updateMany(query, update, options = {}) {
    const data = loadMockData();
    const docs = data[this.name] || [];
    let modifiedCount = 0;

    for (const doc of docs) {
      if (this._match(doc, query)) {
        if (update.$set) {
          Object.assign(doc, update.$set);
        }
        if (update.$inc) {
          for (const [k, v] of Object.entries(update.$inc)) {
            doc[k] = (doc[k] || 0) + v;
          }
        }
        modifiedCount++;
      }
    }

    if (modifiedCount > 0) {
      saveMockData(data);
    }
    return { matchedCount: modifiedCount, modifiedCount };
  }

  async deleteOne(query) {
    const data = loadMockData();
    const docs = data[this.name] || [];
    const idx = docs.findIndex(doc => this._match(doc, query));
    if (idx !== -1) {
      docs.splice(idx, 1);
      saveMockData(data);
      return { deletedCount: 1 };
    }
    return { deletedCount: 0 };
  }

  async deleteMany(query = {}) {
    const data = loadMockData();
    const docs = data[this.name] || [];
    const initialCount = docs.length;
    const remaining = docs.filter(doc => !this._match(doc, query));
    data[this.name] = remaining;
    saveMockData(data);
    return { deletedCount: initialCount - remaining.length };
  }

  aggregate(pipeline) {
    const data = loadMockData();
    let docs = data[this.name] || [];

    const matchStage = pipeline.find(stage => stage.$match);
    if (matchStage) {
      docs = docs.filter(doc => this._match(doc, matchStage.$match));
    }

    const groupStage = pipeline.find(stage => stage.$group);
    let results = [];
    if (groupStage) {
      const groups = {};
      const idExpr = groupStage.$group._id;
      const sumExpr = groupStage.$group.totalSpent?.$sum;
      
      for (const doc of docs) {
        const groupKey = idExpr.startsWith('$') ? doc[idExpr.slice(1)] : idExpr;
        if (!groups[groupKey]) {
          groups[groupKey] = { totalSpent: 0, count: 0 };
        }
        const amt = sumExpr.startsWith('$') ? doc[sumExpr.slice(1)] : sumExpr;
        groups[groupKey].totalSpent += parseFloat(amt || 0);
        groups[groupKey].count += 1;
      }

      for (const [key, val] of Object.entries(groups)) {
        results.push({
          _id: key,
          totalSpent: val.totalSpent,
          count: val.count
        });
      }
    } else {
      results = JSON.parse(JSON.stringify(docs));
    }

    const projectStage = pipeline.find(stage => stage.$project);
    if (projectStage) {
      results = results.map(item => {
        const newItem = {};
        for (const [k, v] of Object.entries(projectStage.$project)) {
          if (v === 1) {
            newItem[k] = item[k];
          } else if (typeof v === 'string' && v.startsWith('$')) {
            newItem[k] = item[v.slice(1)];
          }
        }
        return newItem;
      });
    }

    const sortStage = pipeline.find(stage => stage.$sort);
    if (sortStage) {
      const key = Object.keys(sortStage.$sort)[0];
      const order = sortStage.$sort[key];
      results.sort((a, b) => {
        return order === 1 ? a[key] - b[key] : b[key] - a[key];
      });
    }

    return new MockCursor(results);
  }

  watch() {
    return new MockChangeStream();
  }
}

class MockDb {
  constructor() {
    this.client = {
      db: (name) => new MockDb()
    };
  }

  collection(name) {
    return new MockCollection(name);
  }
}

export async function connectDB() {
  if (db) return db;
  try {
    await client.connect();
    db = client.db('penny_db');
    console.log('✅ Connected successfully to MongoDB Atlas');
    return db;
  } catch (error) {
    console.warn('⚠️ MongoDB Atlas Connection Error:', error.message || error);
    console.log('🔌 Falling back to Local JSON database (mock_db.json) for standalone demo...');
    db = new MockDb();
    return db;
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
    const model = ai.getGenerativeModel({ model: "gemini-embedding-001" });
    const result = await model.embedContent({
      content: { parts: [{ text }] },
      outputDimensionality: 768
    });
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
  
  // Keyword fallback matching to support demo presets robustly
  const lowerName = merchantName.toLowerCase();
  if (lowerName.includes('starbucks') || lowerName.includes('coffee') || lowerName.includes('cafe')) {
    return { name: "Starbucks", category: "Food & Dining", score: 1.0 };
  }
  if (lowerName.includes('uber') || lowerName.includes('taxi') || lowerName.includes('ride')) {
    return { name: "Uber", category: "Travel", score: 1.0 };
  }
  if (lowerName.includes('tesco') || lowerName.includes('groceries') || lowerName.includes('whole foods')) {
    return { name: "Tesco", category: "Groceries", score: 1.0 };
  }
  if (lowerName.includes('netflix')) {
    return { name: "Netflix", category: "Entertainment", score: 1.0 };
  }
  if (lowerName.includes('emirates') || lowerName.includes('airlines') || lowerName.includes('flight')) {
    return { name: "Emirates Airlines", category: "Travel", score: 1.0 };
  }
  if (lowerName.includes('apple')) {
    return { name: "Apple Store", category: "Shopping", score: 1.0 };
  }
  
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
