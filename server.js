const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const ExcelJS = require('exceljs');
const https = require('https');

const app = express();
app.use(cors());
app.use(express.json());

const MONGODB_URI = process.env.MONGODB_URI;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '9850';
const WX_APPID = process.env.WX_APPID || '';
const WX_SECRET = process.env.WX_SECRET || '';

// Schemas
const labSchema = new mongoose.Schema({
  name: { type: String, unique: true },
  qrCode: { type: String, default: '' },
  qrGenerated: { type: Boolean, default: false }
}, { collection: 'lab_list' });

const registerSchema = new mongoose.Schema({
  lab: String, name: String, studentId: String, phone: String,
  timeSlot: String, fromScan: Boolean, date: String, time: String, createdAt: Date
}, { collection: 'registers' });

const Lab = mongoose.model('Lab', labSchema);
const Register = mongoose.model('Register', registerSchema);

mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 15000 }).then(() => console.log('DB OK')).catch(e => console.error('DB err:', e.message));

function isValidPhone(p) { return /^1[3-9]\d{9}$/.test(p); }

// Helper: HTTPS request as Promise
function httpsRequest(url, options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let data = [];
      res.on('data', chunk => data.push(chunk));
      res.on('end', () => {
        const buf = Buffer.concat(data);
        const ct = res.headers['content-type'] || '';
        if (ct.includes('json')) resolve(JSON.parse(buf.toString()));
        else resolve(buf);
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// Get WeChat access_token
async function getWxToken() {
  if (!WX_APPID || !WX_SECRET) {
    throw new Error('未配置 WX_APPID 或 WX_SECRET 环境变量');
  }
  const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${WX_APPID}&secret=${WX_SECRET}`;
  const res = await httpsRequest(url, { method: 'GET' });
  if (res.access_token) return res.access_token;
  throw new Error('获取微信 access_token 失败: ' + JSON.stringify(res));
}

// Generate WeChat mini-program QR code
async function generateWxQR(scene, page) {
  const token = await getWxToken();
  const url = `https://api.weixin.qq.com/wxa/getwxacodeunlimit?access_token=${token}`;
  const body = JSON.stringify({
    scene: scene,
    page: page,
    width: 430,
    auto_color: false,
    line_color: { r: 7, g: 193, b: 96 }
  });
  return await httpsRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, body);
}

// Validate that a buffer is a real image (JPEG/PNG header)
function isImageBuffer(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 8) return false;
  // JPEG: starts with FF D8 FF
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return true;
  // PNG: starts with 89 50 4E 47
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return true;
  return false;
}

app.get('/', (req, res) => res.json({ status: 'ok', db: mongoose.connection.readyState }));

// Get labs (with qrGenerated flag)
app.get('/api/getLabList', async (req, res) => {
  try {
    const labs = await Lab.find({}).sort({ name: 1 });
    res.json({
      success: true,
      data: labs.map(l => ({
        name: l.name,
        qrGenerated: l.qrGenerated
      }))
    });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Generate QR for a lab
app.post('/api/generateLabQR', async (req, res) => {
  try {
    const { lab, password } = req.body;
    if (password !== ADMIN_PASSWORD) return res.status(403).json({ success: false, error: '密码错误' });
    if (!lab) return res.status(400).json({ success: false, error: '缺少实验室名称' });

    const labDoc = await Lab.findOne({ name: lab });
    if (!labDoc) return res.status(404).json({ success: false, error: '实验室不存在' });

    const force = req.body.force === true || req.body.force === 'true';
    if (labDoc.qrGenerated && labDoc.qrCode && !force) {
      return res.json({ success: true, message: '二维码已存在', existed: true });
    }

    // Generate WeChat QR code
    const qrBuffer = await generateWxQR(
      'lab=' + encodeURIComponent(lab),
      'pages/register/register'
    );

    // Check if it's an error JSON object (not a real image)
    if (!Buffer.isBuffer(qrBuffer) || qrBuffer.errcode) {
      const errMsg = qrBuffer.errmsg || qrBuffer.errcode || JSON.stringify(qrBuffer);
      return res.status(500).json({ success: false, error: '微信API错误: ' + errMsg });
    }

    // Validate it's a real image
    if (!isImageBuffer(qrBuffer)) {
      const preview = qrBuffer.toString('utf8', 0, Math.min(200, qrBuffer.length));
      return res.status(500).json({ success: false, error: '微信返回的不是图片: ' + preview });
    }

    // Store as base64
    const base64 = 'data:image/jpeg;base64,' + qrBuffer.toString('base64');
    labDoc.qrCode = base64;
    labDoc.qrGenerated = true;
    await labDoc.save();

    res.json({ success: true, message: '二维码生成成功' });
  } catch (e) {
    console.error('generateLabQR error:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// Get QR image for a lab
app.get('/api/getLabQR', async (req, res) => {
  try {
    const lab = req.query.lab;
    if (!lab) return res.status(400).json({ success: false, error: '缺少参数' });

    const labDoc = await Lab.findOne({ name: lab });
    if (!labDoc) return res.status(404).json({ success: false, error: '实验室不存在' });

    if (!labDoc.qrGenerated || !labDoc.qrCode) {
      return res.status(404).json({ success: false, error: '二维码未生成，请先在管理后台生成' });
    }

    res.json({ success: true, data: labDoc.qrCode });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Reset QR codes for all labs (admin only, for fixing corrupted data)
app.post('/api/resetAllQR', async (req, res) => {
  try {
    const { password } = req.body;
    if (password !== ADMIN_PASSWORD) return res.status(403).json({ success: false, error: '密码错误' });

    const result = await Lab.updateMany({}, { $set: { qrCode: '', qrGenerated: false } });
    res.json({ success: true, message: `已重置 ${result.modifiedCount} 个实验室的二维码` });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Reset QR code for a single lab (admin only)
app.post('/api/resetLabQR', async (req, res) => {
  try {
    const { lab, password } = req.body;
    if (password !== ADMIN_PASSWORD) return res.status(403).json({ success: false, error: '密码错误' });
    if (!lab) return res.status(400).json({ success: false, error: '缺少实验室名称' });

    const result = await Lab.updateOne({ name: lab }, { $set: { qrCode: '', qrGenerated: false } });
    if (result.matchedCount === 0) return res.status(404).json({ success: false, error: '实验室不存在' });
    res.json({ success: true, message: `已重置 ${lab} 的二维码` });
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
      lab, name, studentId, phone, timeSlot: timeSlot || '',
      fromScan: !!fromScan, date: now.toISOString().split('T')[0],
      time: now.toTimeString().split(' ')[0], createdAt: now
    });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Get registrations
app.get('/api/getRegisters', async (req, res) => {
  try {
    const { lab, date, keyword, page = 1, limit = 50 } = req.query;
    const filter = {};
    if (lab) filter.lab = lab;
    if (date) filter.date = date;
    if (keyword) filter.$or = [
      { name: { $regex: keyword, $options: 'i' } },
      { studentId: { $regex: keyword, $options: 'i' } },
      { phone: { $regex: keyword, $options: 'i' } }
    ];
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [records, total] = await Promise.all([
      Register.find(filter).sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit)),
      Register.countDocuments(filter)
    ]);
    res.json({ success: true, data: records, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Export Excel
app.get('/api/exportExcel', async (req, res) => {
  try {
    const { lab, date } = req.query;
    const filter = {};
    if (lab) filter.lab = lab;
    if (date) filter.date = date;
    const records = await Register.find(filter).sort({ createdAt: -1 });

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('登记记录');
    ws.columns = [
      { header: '实验室', key: 'lab', width: 20 },
      { header: '姓名', key: 'name', width: 15 },
      { header: '学号', key: 'studentId', width: 15 },
      { header: '电话', key: 'phone', width: 15 },
      { header: '时间段', key: 'timeSlot', width: 20 },
      { header: '登记方式', key: 'fromScan', width: 10 },
      { header: '日期', key: 'date', width: 12 },
      { header: '时间', key: 'time', width: 10 }
    ];
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF07C160' } };
    records.forEach(r => {
      ws.addRow({
        lab: r.lab, name: r.name, studentId: r.studentId, phone: r.phone,
        timeSlot: r.timeSlot || '', fromScan: r.fromScan ? '扫码' : '手动',
        date: r.date, time: r.time
      });
    });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=records.xlsx');
    await wb.xlsx.write(res);
    res.end();
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

app.post('/api/checkAdminPassword', (req, res) => {
  if (req.body.password === ADMIN_PASSWORD) res.json({ success: true });
  else res.status(403).json({ success: false });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server on port ' + PORT));
