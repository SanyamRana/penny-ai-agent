import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import { connectDB, getDB, findMatchingMerchant, getSpendAnalysis } from './db.js';
import { runAgentLoop } from './agent.js';
import { ObjectId } from 'mongodb';

dotenv.config();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5001;

// Setup live WebSocket log streams
io.on('connection', (socket) => {
  console.log('🔌 Client connected via WebSockets');
  socket.emit('status', { message: 'Connected to Penny Backend' });
});

// HTTP ENDPOINTS
// 1. Get dashboard data (Aggregations + Lists)
app.get('/api/dashboard', async (req, res) => {
  try {
    const db = getDB();
    
    // Retrieve budgets
    const budgets = await db.collection('budgets').find().toArray();
    
    // Run spend analysis aggregation pipeline
    const spendAnalysis = await getSpendAnalysis("user_default");
    
    // Merge spend stats into budgets
    const mergedBudgets = budgets.map(b => {
      const spend = spendAnalysis.find(s => s.category === b.category);
      return {
        ...b,
        spent: spend ? spend.totalSpent : 0,
        transactionCount: spend ? spend.count : 0
      };
    });

    // Get recent transactions
    const transactions = await db.collection('transactions')
      .find({ userId: "user_default" })
      .sort({ timestamp: -1 })
      .limit(10)
      .toArray();

    res.json({
      budgets: mergedBudgets,
      transactions,
      overallLimit: budgets.reduce((sum, b) => sum + b.limit, 0),
      overallSpent: spendAnalysis.reduce((sum, s) => sum + s.totalSpent, 0)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 2. Simulate transaction (inserts a document to fire the Change Stream!)
app.post('/api/simulate-transaction', async (req, res) => {
  try {
    const { merchantRaw, amount, location } = req.body;
    const db = getDB();
    
    const newTransaction = {
      userId: "user_default",
      merchantRaw,
      amount: parseFloat(amount),
      location: location || "London, UK",
      timestamp: new Date(),
      status: "PENDING_CLASSIFICATION", // Will be updated by agent
      category: "Uncategorized"
    };

    const result = await db.collection('transactions').insertOne(newTransaction);
    console.log(`📥 Simulated transaction inserted into DB: ID ${result.insertedId}`);
    
    res.status(201).json({ 
      message: "Transaction simulated", 
      transactionId: result.insertedId 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 3. Verify anomalous transaction (Human-in-the-loop resolution endpoint)
app.post('/api/verify-transaction', async (req, res) => {
  try {
    const { transactionId, approved } = req.body;
    const db = getDB();
    const transactionsCol = db.collection('transactions');

    const transaction = await transactionsCol.findOne({ _id: new ObjectId(transactionId) });
    if (!transaction) {
      return res.status(404).json({ error: "Transaction not found" });
    }

    if (approved) {
      // User approved: categorize and mark approved
      // In a real flow, Gemini could help decide the final category, or we default to the best match.
      const resolvedCategory = transaction.vectorMatchedCategory || "Uncategorized";
      await transactionsCol.updateOne(
        { _id: new ObjectId(transactionId) },
        { 
          $set: { 
            status: "APPROVED", 
            category: resolvedCategory,
            notes: "Verified by User (Human-in-the-loop)"
          } 
        }
      );
      
      io.emit('agent-thought', {
        transactionId,
        message: `👤 User verified transaction: Approved. Categorized under '${resolvedCategory}'.`,
        timestamp: new Date()
      });
      res.json({ message: "Transaction approved by user" });
    } else {
      // User denied: mark as fraudulent / blocked
      await transactionsCol.updateOne(
        { _id: new ObjectId(transactionId) },
        { 
          $set: { 
            status: "BLOCKED", 
            category: "Flagged Anomaly",
            notes: "Declined by User (Human-in-the-loop)"
          } 
        }
      );
      
      io.emit('agent-thought', {
        transactionId,
        message: `🚨 User verified transaction: Blocked as unauthorized. Account safety alert active!`,
        timestamp: new Date()
      });
      res.json({ message: "Transaction blocked by user" });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 4. Setup mock databases (Helper for first run)
app.post('/api/setup-demo', async (req, res) => {
  try {
    const db = getDB();
    
    // Clear collections
    await db.collection('budgets').deleteMany({});
    await db.collection('merchants').deleteMany({});
    await db.collection('transactions').deleteMany({});

    // 1. Seed Budgets
    const budgets = [
      { category: "Food & Dining", limit: 300 },
      { category: "Travel", limit: 200 },
      { category: "Shopping", limit: 400 },
      { category: "Groceries", limit: 250 },
      { category: "Entertainment", limit: 150 }
    ];
    await db.collection('budgets').insertMany(budgets);

    // 2. Seed Standard Merchants (for Vector Search matching)
    // Note: In Atlas, we will need to create a Vector Index named 'vector_index' on the 'embedding' field
    const merchants = [
      { name: "Uber", category: "Travel", description: "Ride sharing and transport services" },
      { name: "Starbucks", category: "Food & Dining", description: "Coffee shop and quick eats" },
      { name: "Amazon", category: "Shopping", description: "Online retail and electronics" },
      { name: "Tesco", category: "Groceries", description: "Supermarket food and groceries" },
      { name: "Netflix", category: "Entertainment", description: "Streaming subscription service" }
    ];

    // We generate vector embeddings for each merchant description
    const seededMerchants = [];
    for (const merchant of merchants) {
      // In db.js, this will call Gemini embeddings API or fallback to mock vector if key is missing
      const embedding = await db.client.db('penny_db').collection('dummy').findOne({}); // dummy query just to ensure db is loaded
      
      // Let's generate a vector using getVectorEmbedding
      const vector = await import('./db.js').then(m => m.getVectorEmbedding(merchant.name + " " + merchant.description));
      seededMerchants.push({
        ...merchant,
        embedding: vector
      });
    }
    await db.collection('merchants').insertMany(seededMerchants);

    // 3. Seed some past transactions
    const initialTransactions = [
      { userId: "user_default", merchantRaw: "Uber London Ride", category: "Travel", amount: 24.50, location: "London, UK", timestamp: new Date(Date.now() - 86400000 * 2), status: "APPROVED", notes: "Matched with Uber" },
      { userId: "user_default", merchantRaw: "Starbucks Coffee", category: "Food & Dining", amount: 6.80, location: "New York, USA", timestamp: new Date(Date.now() - 86400000 * 1), status: "APPROVED", notes: "Matched with Starbucks" },
      { userId: "user_default", merchantRaw: "Whole Foods Market", category: "Groceries", amount: 84.10, location: "London, UK", timestamp: new Date(Date.now() - 3600000 * 5), status: "APPROVED", notes: "Classified as Groceries" }
    ];
    await db.collection('transactions').insertMany(initialTransactions);

    res.json({ message: "Demo data seeded successfully", budgetsSeeded: budgets.length, merchantsSeeded: seededMerchants.length, transactionsSeeded: initialTransactions.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// START DATABASE AND RUN MAIN REAL-TIME LOOP
connectDB().then(() => {
  // Start Change Stream listener on 'transactions' collection
  const db = getDB();
  const transactionsCol = db.collection('transactions');

  console.log('⚡ Starting MongoDB Change Stream listener on transactions...');
  const changeStream = transactionsCol.watch([
    { $match: { operationType: 'insert' } }
  ]);

  changeStream.on('change', async (next) => {
    try {
      const fullDocument = next.fullDocument;
      console.log(`🔥 Change Stream fired: new transaction inserted!`, fullDocument._id);

      // 1. Vector Search for merchant matching
      const match = await findMatchingMerchant(fullDocument.merchantRaw);
      if (match) {
        await transactionsCol.updateOne(
          { _id: fullDocument._id },
          { 
            $set: { 
              vectorMatchedMerchant: match.name, 
              vectorMatchedCategory: match.category 
            } 
          }
        );
        fullDocument.vectorMatchedMerchant = match.name;
        fullDocument.vectorMatchedCategory = match.category;
      }

      // 2. Trigger Gemini reasoning loop
      await runAgentLoop(fullDocument, io);
    } catch (error) {
      console.error('❌ Error handling change stream event:', error);
    }
  });

  httpServer.listen(PORT, () => {
    console.log(`🚀 Penny Backend Server running on http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('Failed to initialize application:', err);
});
