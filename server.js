const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();
app.use(cors());
app.use(express.json());

const MONGODB_URI = process.env.MONGODB_URI;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '9850';

// Schemas
const labSchema = new mongoose.Schema({ name: String }, { collection: 'lab_list' });
const registerSchema = new mongoose.Schema({
  lab: String, name: String, studentId: String, phone: String,
  fromScan: Boolean, date: String, time: String, createdAt: Date
}, { collection: 'registers' });

const Lab = mongoose.model('Lab', labSchema);
const Register = mongoose.model('Register', registerSchema);

// Connect
mongoose.connect(MONGODB_URI).then(() => console.log('MongoDB connected')).catch(err => console.error('MongoDB error:', err));

app.get('/', (req, res) => res.json({ status: 'ok' }));

app.get('/api/getLabList', async (req, res) => {
  try {
    const labs = await Lab.find({}).sort({ name: 1 });
    res.json({ success: true, data: labs.map(l => l.name) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/submitRegister', async (req, res) => {
  try {
    const { lab, name, studentId, phone, fromScan } = req.body;
    if (!lab || !name || !studentId || !phone) return res.status(400).json({ success: false, error: 'Missing fields' });
    const now = new Date();
    await Register.create({
      lab, name, studentId, phone, fromScan: !!fromScan,
      date: now.toISOString().split('T')[0],
      time: now.toTimeString().split(' ')[0],
      createdAt: now
    });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/getRegisters', async (req, res) => {
  try {
    const records = await Register.find({}).sort({ createdAt: -1 }).limit(500);
    res.json({ success: true, data: records });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/addLab', async (req, res) => {
  try {
    const { name, password } = req.body;
    if (password !== ADMIN_PASSWORD) return res.status(403).json({ success: false, error: 'Wrong password' });
    if (!name) return res.status(400).json({ success: false, error: 'Name required' });
    const exists = await Lab.findOne({ name });
    if (exists) return res.status(400).json({ success: false, error: 'Already exists' });
    await Lab.create({ name });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/deleteLab', async (req, res) => {
  try {
    const { name, password } = req.body;
    if (password !== ADMIN_PASSWORD) return res.status(403).json({ success: false, error: 'Wrong password' });
    await Lab.deleteOne({ name });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/checkAdminPassword', (req, res) => {
  if (req.body.password === ADMIN_PASSWORD) res.json({ success: true });
  else res.status(403).json({ success: false });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server on port ' + PORT));