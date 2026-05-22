import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import { connectDB, getDB, findMatchingMerchant, getSpendAnalysis } from './db.js';
import { runAgentLoop, runChatAdvisor } from './agent.js';
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

    // Perceive Board components:
    const profile = await db.collection('profile').findOne({ userId: "user_default" });
    const checkingBalance = profile ? profile.checkingBalance : 2450.00;

    const subscriptions = await db.collection('subscriptions').find({ userId: "user_default" }).toArray();
    const goals = await db.collection('goals').find({ userId: "user_default" }).toArray();
    const savings = await db.collection('savings').find({ userId: "user_default" }).toArray();
    
    // Plan & Act boards:
    const plans = await db.collection('plans').find({ userId: "user_default" }).sort({ timestamp: -1 }).limit(5).toArray();
    const actions = await db.collection('actions').find({ userId: "user_default" }).sort({ timestamp: -1 }).limit(10).toArray();

    res.json({
      budgets: mergedBudgets,
      transactions,
      overallLimit: budgets.reduce((sum, b) => sum + b.limit, 0),
      overallSpent: spendAnalysis.reduce((sum, s) => sum + s.totalSpent, 0),
      checkingBalance,
      subscriptions,
      goals,
      savings,
      plans,
      actions
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

// 3.5. Update or set budget limits
app.post('/api/budgets', async (req, res) => {
  try {
    const { category, limit } = req.body;
    const db = getDB();
    await db.collection('budgets').updateOne(
      { category },
      { $set: { limit: parseFloat(limit) } },
      { upsert: true }
    );
    res.json({ message: `Budget for ${category} updated to $${limit}` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 3.6. Execute a specific plan step (Human-in-the-loop triggers)
app.post('/api/action-plans/execute', async (req, res) => {
  try {
    const { planId, stepIndex } = req.body;
    const db = getDB();
    
    const plan = await db.collection('plans').findOne({ _id: new ObjectId(planId) });
    if (!plan) return res.status(404).json({ error: "Plan not found" });

    const step = plan.steps[stepIndex];
    if (!step) return res.status(404).json({ error: "Step not found" });

    if (step.status === 'executed') {
      return res.json({ message: "Step already executed" });
    }

    // Execute based on step type
    if (step.type === 'cancel') {
      await db.collection('subscriptions').updateOne(
        { name: step.target, userId: "user_default" },
        { $set: { status: 'Cancelled' } }
      );
      await db.collection('actions').insertOne({
        userId: "user_default",
        actionType: "CANCEL",
        target: step.target,
        details: `Cancelled subscription to ${step.target} ($${step.cost}/mo) due to low usage.`,
        timestamp: new Date()
      });
    } else if (step.type === 'transfer') {
      const amount = parseFloat(step.amount);
      await db.collection('profile').updateOne(
        { userId: "user_default" },
        { $inc: { checkingBalance: -amount } }
      );
      await db.collection('savings').updateOne(
        { name: step.target, userId: "user_default" },
        { $inc: { balance: amount } }
      );
      await db.collection('goals').updateOne(
        { title: { $regex: new RegExp(step.target, 'i') }, userId: "user_default" },
        { $inc: { current: amount } }
      );
      await db.collection('actions').insertOne({
        userId: "user_default",
        actionType: "TRANSFER",
        target: step.target,
        details: `Transferred $${amount} from Checking to '${step.target}' savings bucket.`,
        timestamp: new Date()
      });
    } else if (step.type === 'negotiate') {
      await db.collection('subscriptions').updateOne(
        { name: step.target, userId: "user_default" },
        { $set: { status: 'Negotiating' } }
      );
      await db.collection('actions').insertOne({
        userId: "user_default",
        actionType: "NEGOTIATE",
        target: step.target,
        details: `Initiated discount renegotiation for ${step.target}.`,
        timestamp: new Date()
      });
    }

    // Mark step as executed
    const updatedSteps = [...plan.steps];
    updatedSteps[stepIndex].status = 'executed';

    await db.collection('plans').updateOne(
      { _id: new ObjectId(planId) },
      { $set: { steps: updatedSteps } }
    );

    io.emit('agent-thought', {
      transactionId: plan.transactionId || 'manual',
      message: `⚡ Executed Plan Step: ${step.description}`,
      timestamp: new Date()
    });

    res.json({ message: "Step executed successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 3.7. AI Chat Advisor Endpoint
app.post('/api/chat', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: "Message is required" });
    const reply = await runChatAdvisor(message);
    res.json({ reply });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 3.8. Create new financial goal
app.post('/api/goals', async (req, res) => {
  try {
    const { title, target, current } = req.body;
    if (!title || !target) return res.status(400).json({ error: "Title and target are required" });
    const db = getDB();
    const newGoal = {
      userId: "user_default",
      title,
      target: parseFloat(target),
      current: parseFloat(current || 0)
    };
    await db.collection('goals').insertOne(newGoal);
    
    // Automatically create/sync savings bucket
    await db.collection('savings').updateOne(
      { userId: "user_default", name: title },
      { $set: { balance: parseFloat(current || 0) } },
      { upsert: true }
    );

    io.emit('agent-thought', {
      transactionId: 'system',
      message: `🎯 Added financial goal: "${title}" (Target: $${parseFloat(target).toFixed(2)})`,
      timestamp: new Date()
    });

    res.status(201).json({ message: "Goal created successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 3.9. Add new subscription
app.post('/api/subscriptions', async (req, res) => {
  try {
    const { name, cost, frequency, usage } = req.body;
    if (!name || !cost) return res.status(400).json({ error: "Name and cost are required" });
    const db = getDB();
    const newSub = {
      userId: "user_default",
      name,
      cost: parseFloat(cost),
      frequency: frequency || "monthly",
      usage: usage || "Medium",
      status: "Active"
    };
    await db.collection('subscriptions').insertOne(newSub);

    io.emit('agent-thought', {
      transactionId: 'system',
      message: `🕵️‍♂️ Added subscription tracking for "${name}" ($${parseFloat(cost).toFixed(2)}/mo)`,
      timestamp: new Date()
    });

    res.status(201).json({ message: "Subscription added successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 3.9.5. Cancel subscription manually
app.post('/api/subscriptions/cancel', async (req, res) => {
  try {
    const { subId } = req.body;
    if (!subId) return res.status(400).json({ error: "Subscription ID is required" });
    const db = getDB();
    const subscription = await db.collection('subscriptions').findOne({ _id: new ObjectId(subId) });
    if (!subscription) return res.status(404).json({ error: "Subscription not found" });

    await db.collection('subscriptions').updateOne(
      { _id: new ObjectId(subId) },
      { $set: { status: 'Cancelled' } }
    );

    await db.collection('actions').insertOne({
      userId: "user_default",
      actionType: "CANCEL",
      target: subscription.name,
      details: `Manually cancelled subscription to ${subscription.name} ($${subscription.cost}/mo).`,
      timestamp: new Date()
    });

    io.emit('agent-thought', {
      transactionId: 'system',
      message: `🚫 Manually cancelled subscription: "${subscription.name}"`,
      timestamp: new Date()
    });

    res.json({ message: "Subscription cancelled successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 3.9.6. Negotiate subscription manually
app.post('/api/subscriptions/negotiate', async (req, res) => {
  try {
    const { subId } = req.body;
    if (!subId) return res.status(400).json({ error: "Subscription ID is required" });
    const db = getDB();
    const subscription = await db.collection('subscriptions').findOne({ _id: new ObjectId(subId) });
    if (!subscription) return res.status(404).json({ error: "Subscription not found" });

    await db.collection('subscriptions').updateOne(
      { _id: new ObjectId(subId) },
      { $set: { status: 'Negotiating' } }
    );

    await db.collection('actions').insertOne({
      userId: "user_default",
      actionType: "NEGOTIATE",
      target: subscription.name,
      details: `Manually initiated renegotiation for subscription ${subscription.name}.`,
      timestamp: new Date()
    });

    io.emit('agent-thought', {
      transactionId: 'system',
      message: `🤝 Manually initiated negotiation for subscription: "${subscription.name}"`,
      timestamp: new Date()
    });

    res.json({ message: "Subscription negotiation initiated successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 3.10. Delete a transaction
app.post('/api/transactions/delete', async (req, res) => {
  try {
    const { transactionId } = req.body;
    if (!transactionId) return res.status(400).json({ error: "Transaction ID is required" });
    const db = getDB();
    await db.collection('transactions').deleteOne({ _id: new ObjectId(transactionId) });
    
    io.emit('agent-thought', {
      transactionId: 'system',
      message: `⚙️ Deleted transaction from database.`,
      timestamp: new Date()
    });
    
    res.json({ message: "Transaction deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 3.11. Recategorize a transaction
app.post('/api/transactions/recategorize', async (req, res) => {
  try {
    const { transactionId, category } = req.body;
    if (!transactionId || !category) return res.status(400).json({ error: "Transaction ID and category are required" });
    const db = getDB();
    await db.collection('transactions').updateOne(
      { _id: new ObjectId(transactionId) },
      { $set: { category } }
    );
    
    io.emit('agent-thought', {
      transactionId: 'system',
      message: `⚙️ Recategorized transaction to "${category}".`,
      timestamp: new Date()
    });
    
    res.json({ message: "Transaction recategorized successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 3.12. Batch execute action-plan steps
app.post('/api/action-plans/execute-all', async (req, res) => {
  try {
    const { planId } = req.body;
    if (!planId) return res.status(400).json({ error: "Plan ID is required" });
    const db = getDB();
    const plan = await db.collection('plans').findOne({ _id: new ObjectId(planId) });
    if (!plan) return res.status(404).json({ error: "Plan not found" });

    const updatedSteps = [...plan.steps];
    for (let i = 0; i < updatedSteps.length; i++) {
      const step = updatedSteps[i];
      if (step.status === 'executed') continue;

      if (step.type === 'cancel') {
        await db.collection('subscriptions').updateOne(
          { name: step.target, userId: "user_default" },
          { $set: { status: 'Cancelled' } }
        );
        await db.collection('actions').insertOne({
          userId: "user_default",
          actionType: "CANCEL",
          target: step.target,
          details: `Cancelled subscription to ${step.target} ($${step.cost}/mo) due to low usage.`,
          timestamp: new Date()
        });
      } else if (step.type === 'transfer') {
        const amount = parseFloat(step.amount);
        await db.collection('profile').updateOne(
          { userId: "user_default" },
          { $inc: { checkingBalance: -amount } }
        );
        await db.collection('savings').updateOne(
          { name: step.target, userId: "user_default" },
          { $inc: { balance: amount } }
        );
        await db.collection('goals').updateOne(
          { title: { $regex: new RegExp(step.target, 'i') }, userId: "user_default" },
          { $inc: { current: amount } }
        );
        await db.collection('actions').insertOne({
          userId: "user_default",
          actionType: "TRANSFER",
          target: step.target,
          details: `Transferred $${amount} from Checking to '${step.target}' savings bucket.`,
          timestamp: new Date()
        });
      } else if (step.type === 'negotiate') {
        await db.collection('subscriptions').updateOne(
          { name: step.target, userId: "user_default" },
          { $set: { status: 'Negotiating' } }
        );
        await db.collection('actions').insertOne({
          userId: "user_default",
          actionType: "NEGOTIATE",
          target: step.target,
          details: `Initiated discount renegotiation for ${step.target}.`,
          timestamp: new Date()
        });
      }
      updatedSteps[i].status = 'executed';
    }

    await db.collection('plans').updateOne(
      { _id: new ObjectId(planId) },
      { $set: { steps: updatedSteps, status: 'EXECUTED' } }
    );

    io.emit('agent-thought', {
      transactionId: plan.transactionId || 'manual',
      message: `⚡ Executed all steps in recovery plan.`,
      timestamp: new Date()
    });

    res.json({ message: "All plan steps executed successfully" });
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
    await db.collection('profile').deleteMany({});
    await db.collection('goals').deleteMany({});
    await db.collection('subscriptions').deleteMany({});
    await db.collection('savings').deleteMany({});
    await db.collection('plans').deleteMany({});
    await db.collection('actions').deleteMany({});

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

    // 4. Seed user profile, goals, subscriptions, and savings
    await db.collection('profile').insertOne({ userId: "user_default", checkingBalance: 2450.00 });
    
    const goals = [
      { userId: "user_default", title: "Save for Summer Trip", target: 500, current: 150 },
      { userId: "user_default", title: "Emergency Fund", target: 1000, current: 400 }
    ];
    await db.collection('goals').insertMany(goals);

    const subscriptions = [
      { userId: "user_default", name: "Netflix Premium", cost: 15.99, frequency: "monthly", usage: "Low", status: "Active" },
      { userId: "user_default", name: "Gym Membership", cost: 50.00, frequency: "monthly", usage: "None", status: "Active" },
      { userId: "user_default", name: "Spotify Family", cost: 16.99, frequency: "monthly", usage: "High", status: "Active" }
    ];
    await db.collection('subscriptions').insertMany(subscriptions);

    const savings = [
      { userId: "user_default", name: "Summer Trip", balance: 150 },
      { userId: "user_default", name: "Emergency Fund", balance: 400 }
    ];
    await db.collection('savings').insertMany(savings);

    res.json({ 
      message: "Demo data seeded successfully", 
      budgetsSeeded: budgets.length, 
      merchantsSeeded: seededMerchants.length, 
      transactionsSeeded: initialTransactions.length,
      goalsSeeded: goals.length,
      subscriptionsSeeded: subscriptions.length,
      savingsSeeded: savings.length
    });
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
