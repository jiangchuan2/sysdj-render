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
  timeSlot: String, fromScan: Boolean, date: String, time: String, createdAt: Date
}, { collection: 'registers' });

const Lab = mongoose.model('Lab', labSchema);
const Register = mongoose.model('Register', registerSchema);

// Connect
mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 15000 }).then(() => console.log('DB OK')).catch(e => console.error('DB err:', e.message));

// Phone validation: check if it's a valid Chinese mobile number
function isValidPhone(phone) {
  return /^1[3-9]\d{9}$/.test(phone);
}

// Root
app.get('/', (req, res) => res.json({ status: 'ok', db: mongoose.connection.readyState }));

// Get labs
app.get('/api/getLabList', async (req, res) => {
  try {
    const labs = await Lab.find({}).sort({ name: 1 });
    res.json({ success: true, data: labs.map(l => l.name) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Submit registration
app.post('/api/submitRegister', async (req, res) => {
  try {
    const { lab, name, studentId, phone, timeSlot, fromScan } = req.body;
    if (!lab || !name || !studentId || !phone) return res.status(400).json({ success: false, error: '请填写完整信息' });
    if (!isValidPhone(phone)) return res.status(400).json({ success: false, error: '手机号格式不正确' });

    const now = new Date();
    await Register.create({
      lab, name, studentId, phone,
      timeSlot: timeSlot || '',
      fromScan: !!fromScan,
      date: now.toISOString().split('T')[0],
      time: now.toTimeString().split(' ')[0],
      createdAt: now
    });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Get registrations (with pagination + filter)
app.get('/api/getRegisters', async (req, res) => {
  try {
    const { lab, date, keyword, page = 1, limit = 50 } = req.query;
    const filter = {};
    if (lab) filter.lab = lab;
    if (date) filter.date = date;
    if (keyword) {
      filter.$or = [
        { name: { $regex: keyword, $options: 'i' } },
        { studentId: { $regex: keyword, $options: 'i' } },
        { phone: { $regex: keyword, $options: 'i' } }
      ];
    }
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [records, total] = await Promise.all([
      Register.find(filter).sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit)),
      Register.countDocuments(filter)
    ]);
    res.json({ success: true, data: records, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Export CSV
app.get('/api/exportCSV', async (req, res) => {
  try {
    const { lab, date } = req.query;
    const filter = {};
    if (lab) filter.lab = lab;
    if (date) filter.date = date;

    const records = await Register.find(filter).sort({ createdAt: -1 });
    
    // BOM for Excel UTF-8
    let csv = '\uFEFF实验室,姓名,学号,电话,时间段,登记方式,日期,时间\n';
    records.forEach(r => {
      csv += `"${r.lab}","${r.name}","${r.studentId}","${r.phone}","${r.timeSlot || ''}","${r.fromScan ? '扫码' : '手动'}","${r.date}","${r.time}"\n`;
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=records.csv');
    res.send(csv);
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Add lab
app.post('/api/addLab', async (req, res) => {
  try {
    const { name, password } = req.body;
    if (password !== ADMIN_PASSWORD) return res.status(403).json({ success: false, error: '密码错误' });
    if (!name) return res.status(400).json({ success: false, error: '请输入名称' });
    if (await Lab.findOne({ name })) return res.status(400).json({ success: false, error: '已存在' });
    await Lab.create({ name });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Delete lab
app.post('/api/deleteLab', async (req, res) => {
  try {
    const { name, password } = req.body;
    if (password !== ADMIN_PASSWORD) return res.status(403).json({ success: false, error: '密码错误' });
    await Lab.deleteOne({ name });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Delete record
app.post('/api/deleteRecord', async (req, res) => {
  try {
    const { id, password } = req.body;
    if (password !== ADMIN_PASSWORD) return res.status(403).json({ success: false, error: '密码错误' });
    await Register.deleteOne({ _id: id });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Check admin
app.post('/api/checkAdminPassword', (req, res) => {
  if (req.body.password === ADMIN_PASSWORD) res.json({ success: true });
  else res.status(403).json({ success: false });
});

// Generate QR data
app.get('/api/generateQR', (req, res) => {
  const lab = req.query.lab || '';
  res.json({ success: true, data: { lab, url: '/pages/register/register?lab=' + encodeURIComponent(lab) } });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server on port ' + PORT));