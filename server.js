const express = require('express');
const cors = require('cors');
const { MongoClient } = require('mongodb');

const app = express();
app.use(cors());
app.use(express.json());

const MONGODB_URI = process.env.MONGODB_URI;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '9850';

let client;
let clientPromise;

function getClient() {
  if (!clientPromise) {
    client = new MongoClient(MONGODB_URI);
    clientPromise = client.connect();
  }
  return clientPromise;
}

async function getDb() {
  const c = await getClient();
  return c.db('sysdj');
}

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'sysdj-lab-register' });
});

// Get lab list
app.get('/api/getLabList', async (req, res) => {
  try {
    const db = await getDb();
    const labs = await db.collection('lab_list').find({}).sort({ name: 1 }).toArray();
    res.json({ success: true, data: labs.map(lab => lab.name) });
  } catch (error) {
    console.error('getLabList error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Submit registration
app.post('/api/submitRegister', async (req, res) => {
  try {
    const db = await getDb();
    const { lab, name, studentId, phone, fromScan } = req.body;
    
    if (!lab || !name || !studentId || !phone) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }
    
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const timeStr = now.toTimeString().split(' ')[0];
    
    await db.collection('registers').insertOne({
      lab, name, studentId, phone,
      fromScan: !!fromScan,
      date: dateStr,
      time: timeStr,
      createdAt: now
    });
    
    res.json({ success: true, message: 'Registration successful' });
  } catch (error) {
    console.error('submitRegister error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get all registrations
app.get('/api/getRegisters', async (req, res) => {
  try {
    const db = await getDb();
    const records = await db.collection('registers')
      .find({})
      .sort({ createdAt: -1 })
      .limit(500)
      .toArray();
    res.json({ success: true, data: records });
  } catch (error) {
    console.error('getRegisters error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Add lab
app.post('/api/addLab', async (req, res) => {
  try {
    const { name, password } = req.body;
    if (password !== ADMIN_PASSWORD) {
      return res.status(403).json({ success: false, error: 'Wrong password' });
    }
    if (!name) {
      return res.status(400).json({ success: false, error: 'Lab name required' });
    }
    
    const db = await getDb();
    const exists = await db.collection('lab_list').findOne({ name });
    if (exists) {
      return res.status(400).json({ success: false, error: 'Lab already exists' });
    }
    
    await db.collection('lab_list').insertOne({ name });
    res.json({ success: true, message: 'Lab added' });
  } catch (error) {
    console.error('addLab error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete lab
app.post('/api/deleteLab', async (req, res) => {
  try {
    const { name, password } = req.body;
    if (password !== ADMIN_PASSWORD) {
      return res.status(403).json({ success: false, error: 'Wrong password' });
    }
    if (!name) {
      return res.status(400).json({ success: false, error: 'Lab name required' });
    }
    
    const db = await getDb();
    await db.collection('lab_list').deleteOne({ name });
    res.json({ success: true, message: 'Lab deleted' });
  } catch (error) {
    console.error('deleteLab error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Check admin password
app.post('/api/checkAdminPassword', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    res.json({ success: true });
  } else {
    res.status(403).json({ success: false, error: 'Wrong password' });
  }
});

// Generate QR code
app.get('/api/generateQR', (req, res) => {
  const lab = req.query.lab || 'default';
  const url = 'https://sysdj-render.onrender.com/pages/register/register?lab=' + encodeURIComponent(lab);
  res.json({ success: true, data: { url, lab } });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Server running on port ' + PORT);
});