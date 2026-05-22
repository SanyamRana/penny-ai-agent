// Note: Node 18+ has global fetch. Let's use global fetch or import it if needed.
import { getDB, connectDB } from './db.js';
import { ObjectId } from 'mongodb';

const BACKEND_URL = 'http://localhost:5001';

async function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function pollTransactionProcessed(db, transactionId, maxAttempts = 15) {
  for (let i = 0; i < maxAttempts; i++) {
    const doc = await db.collection('transactions').findOne({ _id: new ObjectId(transactionId) });
    if (doc && doc.status !== 'PENDING_CLASSIFICATION') {
      return doc;
    }
    await wait(1000);
  }
  return await db.collection('transactions').findOne({ _id: new ObjectId(transactionId) });
}

async function runTests() {
  console.log('🏁 Starting E2E Verification Tests...');

  try {
    // Connect to database directly to inspect results
    await connectDB();
    const db = getDB();

    // 1. Reset and Seed Demo Data
    console.log('\n--- Step 1: Reset & Seed Demo Data ---');
    const seedRes = await fetch(`${BACKEND_URL}/api/setup-demo`, { method: 'POST' });
    const seedJson = await seedRes.json();
    console.log('Seed response:', seedJson);

    // Verify seed values in DB
    const profileBefore = await db.collection('profile').findOne({ userId: 'user_default' });
    console.log(`Initial Checking Balance: $${profileBefore.checkingBalance}`);
    if (profileBefore.checkingBalance !== 2450.00) {
      throw new Error(`Expected checking balance to be 2450.00, got ${profileBefore.checkingBalance}`);
    }

    const budgetsBefore = await db.collection('budgets').find({}).toArray();
    console.log('Seeded Budgets:', budgetsBefore.map(b => `${b.category}: $${b.limit}`).join(', '));

    // 2. Simulate Normal Coffee Transaction
    console.log('\n--- Step 2: Simulate Normal Transaction (Starbucks) ---');
    const starbucksRes = await fetch(`${BACKEND_URL}/api/simulate-transaction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        merchantRaw: 'Starbucks Coffee',
        amount: '6.80',
        location: 'New York, USA'
      })
    });
    const starbucksJson = await starbucksRes.json();
    console.log('Starbucks Simulation response:', starbucksJson);

    console.log('Polling Starbucks transaction status...');
    const starbucksDoc = await pollTransactionProcessed(db, starbucksJson.transactionId);
    console.log('Starbucks processed document:', {
      merchantRaw: starbucksDoc.merchantRaw,
      category: starbucksDoc.category,
      status: starbucksDoc.status,
      notes: starbucksDoc.notes
    });

    if (starbucksDoc.status !== 'APPROVED') {
      throw new Error(`Expected Starbucks transaction to be APPROVED, got ${starbucksDoc.status}`);
    }
    if (starbucksDoc.category !== 'Food & Dining') {
      throw new Error(`Expected Starbucks transaction to be Food & Dining, got ${starbucksDoc.category}`);
    }

    // 3. Simulate Over-Budget Travel Transaction (Emirates Airlines $350.00)
    console.log('\n--- Step 3: Simulate Over-Budget Transaction (Emirates Airlines $350.00) ---');
    const emiratesRes = await fetch(`${BACKEND_URL}/api/simulate-transaction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        merchantRaw: 'Emirates Airlines',
        amount: '350.00',
        location: 'London, UK'
      })
    });
    const emiratesJson = await emiratesRes.json();
    console.log('Emirates Simulation response:', emiratesJson);

    console.log('Polling Emirates transaction status...');
    const emiratesDoc = await pollTransactionProcessed(db, emiratesJson.transactionId);
    console.log('Emirates processed document:', {
      merchantRaw: emiratesDoc.merchantRaw,
      category: emiratesDoc.category,
      status: emiratesDoc.status,
      notes: emiratesDoc.notes
    });

    if (emiratesDoc.status !== 'APPROVED') {
      throw new Error(`Expected Emirates transaction to be APPROVED, got ${emiratesDoc.status}`);
    }
    if (emiratesDoc.category !== 'Travel') {
      throw new Error(`Expected Emirates transaction to be Travel, got ${emiratesDoc.category}`);
    }

    // Verify Subscription status
    const gymSub = await db.collection('subscriptions').findOne({ name: 'Gym Membership', userId: 'user_default' });
    console.log('Gym Membership Subscription:', gymSub);
    if (gymSub.status !== 'Cancelled') {
      throw new Error(`Expected Gym Membership to be Cancelled, got ${gymSub.status}`);
    }

    // Verify Action Plan
    const actionPlan = await db.collection('plans').findOne({ transactionId: emiratesJson.transactionId });
    console.log('Action Plan Created:', actionPlan);
    if (!actionPlan) {
      throw new Error('Expected an action plan to be created for Emirates transaction');
    }
    if (actionPlan.status !== 'EXECUTED') {
      throw new Error(`Expected plan status to be EXECUTED, got ${actionPlan.status}`);
    }

    // Verify Executed Actions
    const loggedActions = await db.collection('actions').find({ userId: 'user_default' }).toArray();
    console.log('Logged Actions in DB:', loggedActions.map(a => `${a.actionType} - ${a.details}`).join('\n'));
    
    const cancelAction = loggedActions.find(a => a.actionType === 'CANCEL' && a.target === 'Gym Membership');
    const transferAction = loggedActions.find(a => a.actionType === 'TRANSFER' && a.target === 'Summer Trip');
    if (!cancelAction) throw new Error('Expected CANCEL action for Gym Membership to be logged');
    if (!transferAction) throw new Error('Expected TRANSFER action for Summer Trip to be logged');

    // Verify checking balance reduction
    const profileAfter = await db.collection('profile').findOne({ userId: 'user_default' });
    console.log(`Checking Balance after transfer: $${profileAfter.checkingBalance} (expected $2400.00)`);
    if (profileAfter.checkingBalance !== 2400.00) {
      throw new Error(`Expected checking balance to be 2400.00 after $50.00 transfer, got ${profileAfter.checkingBalance}`);
    }

    // Verify goals increase
    const summerGoal = await db.collection('goals').findOne({ title: 'Save for Summer Trip', userId: 'user_default' });
    console.log(`Summer Trip Goal: $${summerGoal.current} / $${summerGoal.target} (expected $200.00)`);
    if (summerGoal.current !== 200.00) {
      throw new Error(`Expected Summer Trip goal to have 200.00 current savings, got ${summerGoal.current}`);
    }

    // Verify savings bucket increase
    const summerSavings = await db.collection('savings').findOne({ name: 'Summer Trip', userId: 'user_default' });
    console.log(`Summer Trip Savings Bucket: $${summerSavings.balance} (expected $200.00)`);
    if (summerSavings.balance !== 200.00) {
      throw new Error(`Expected Summer Trip savings bucket to have 200.00, got ${summerSavings.balance}`);
    }

    // 4. Simulate Anomaly Transaction (Apple Store $850.00)
    console.log('\n--- Step 4: Simulate High-Risk Anomaly Transaction (Apple Store $850.00) ---');
    const appleRes = await fetch(`${BACKEND_URL}/api/simulate-transaction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        merchantRaw: 'Apple Store Regent St',
        amount: '850.00',
        location: 'London, UK'
      })
    });
    const appleJson = await appleRes.json();
    console.log('Apple Simulation response:', appleJson);

    console.log('Polling Apple transaction status...');
    const appleDoc = await pollTransactionProcessed(db, appleJson.transactionId);
    console.log('Apple processed document:', {
      merchantRaw: appleDoc.merchantRaw,
      status: appleDoc.status,
      anomalyReason: appleDoc.anomalyReason
    });

    if (appleDoc.status !== 'PENDING_REVIEW') {
      throw new Error(`Expected Apple transaction status to be PENDING_REVIEW, got ${appleDoc.status}`);
    }

    // 5. Verify anomalous transaction via Human-in-the-loop endpoint
    console.log('\n--- Step 5: Verify Anomalous Transaction (Human-in-the-loop) ---');
    const verifyRes = await fetch(`${BACKEND_URL}/api/verify-transaction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transactionId: appleJson.transactionId,
        approved: true
      })
    });
    const verifyJson = await verifyRes.json();
    console.log('Verify endpoint response:', verifyJson);

    // Verify status updated to APPROVED in DB
    const appleDocApproved = await db.collection('transactions').findOne({ _id: new ObjectId(appleJson.transactionId) });
    console.log('Apple transaction after user approval:', {
      merchantRaw: appleDocApproved.merchantRaw,
      status: appleDocApproved.status,
      category: appleDocApproved.category,
      notes: appleDocApproved.notes
    });

    if (appleDocApproved.status !== 'APPROVED') {
      throw new Error(`Expected Apple transaction status to become APPROVED after verification, got ${appleDocApproved.status}`);
    }

    // 6. Test Budget Modification Endpoint
    console.log('\n--- Step 6: Test Budget Modification ---');
    const updateBudgetRes = await fetch(`${BACKEND_URL}/api/budgets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category: 'Travel',
        limit: 500
      })
    });
    const updateBudgetJson = await updateBudgetRes.json();
    console.log('Update Budget response:', updateBudgetJson);

    const travelBudget = await db.collection('budgets').findOne({ category: 'Travel' });
    console.log('Updated Travel Budget Limit in DB:', travelBudget.limit);
    if (travelBudget.limit !== 500) {
      throw new Error(`Expected Travel budget limit to be 500, got ${travelBudget.limit}`);
    }

    console.log('\n🎉 ALL E2E VERIFICATION TESTS PASSED SUCCESSFULLY! 🎉');
    process.exit(0);

  } catch (error) {
    console.error('\n❌ E2E VERIFICATION TEST FAILED:', error.message || error);
    process.exit(1);
  }
}

runTests();
