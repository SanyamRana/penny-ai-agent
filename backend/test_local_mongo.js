import { MongoClient } from 'mongodb';

async function testLocal() {
  try {
    const client = new MongoClient('mongodb://localhost:27017');
    await client.connect();
    console.log('✅ Local MongoDB is running!');
    await client.close();
  } catch (error) {
    console.log('❌ Local MongoDB is NOT running:', error.message);
  }
}

testLocal();
