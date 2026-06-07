const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = 'zjmaicsy';

// ==================== DATA STORE ====================
// Vercel 用 /tmp，本地用 ./data
const DATA_DIR = process.env.VERCEL ? '/tmp/data' : path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'draws.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readData() {
  ensureDataDir();
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (e) {
    console.error('读取数据文件失败:', e.message);
  }
  return { draws: {}, tokens: {} };
}

function writeData(data) {
  ensureDataDir();
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

// ==================== HELPERS ====================
function getClientIP(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  // req.ip may be '::ffff:127.0.0.1' or '::1'
  const ip = req.ip || req.connection?.remoteAddress || 'unknown';
  return ip.replace(/^::ffff:/, '');
}

function generateToken() {
  return crypto.randomBytes(12).toString('base64url');
}

function requireAdmin(req, res, next) {
  const password = req.headers['x-admin-password'] || req.body?.password || req.query?.password;
  if (password === ADMIN_PASSWORD) {
    next();
  } else {
    res.status(403).json({ error: '密码错误' });
  }
}

// ==================== MIDDLEWARE ====================
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ==================== API ROUTES ====================

// GET /api/status — 查询当前 IP 抽奖状态
app.get('/api/status', (req, res) => {
  const ip = getClientIP(req);
  const data = readData();
  const record = data.draws[ip];
  if (record && record.drawn) {
    res.json({
      drawn: true,
      boxIndex: record.boxIndex,
      drawnAt: record.drawnAt,
    });
  } else {
    res.json({ drawn: false });
  }
});

// POST /api/draw — 抽奖
app.post('/api/draw', (req, res) => {
  const ip = getClientIP(req);
  const { boxIndex } = req.body;

  if (boxIndex === undefined || boxIndex === null) {
    return res.status(400).json({ error: '缺少 boxIndex' });
  }

  const data = readData();

  // 检查是否已抽过
  if (data.draws[ip] && data.draws[ip].drawn) {
    return res.json({
      success: false,
      message: '该IP已经抽过奖了',
      alreadyDrawn: true,
      previousBox: data.draws[ip].boxIndex,
    });
  }

  // 记录抽奖
  data.draws[ip] = {
    drawn: true,
    boxIndex: Number(boxIndex),
    drawnAt: new Date().toISOString(),
    userAgent: req.headers['user-agent'] || '',
  };
  writeData(data);

  console.log(`[抽奖] IP: ${ip} → 礼盒 ${Number(boxIndex) + 1}`);
  res.json({ success: true, message: '抽奖成功！' });
});

// POST /api/admin/reset-token — 生成重置 token（需管理员密码）
app.post('/api/admin/reset-token', requireAdmin, (req, res) => {
  const token = generateToken();
  const data = readData();
  data.tokens[token] = {
    used: false,
    createdAt: new Date().toISOString(),
  };
  writeData(data);
  console.log(`[Token] 生成重置token: ${token}`);
  res.json({ success: true, token });
});

// POST /api/reset/:token — 使用 token 重置（非管理员路径）
app.post('/api/reset/:token', (req, res) => {
  const ip = getClientIP(req);
  const { token } = req.params;
  const data = readData();

  const tokenRecord = data.tokens[token];
  if (!tokenRecord) {
    return res.json({ success: false, message: '无效的重置链接' });
  }
  if (tokenRecord.used) {
    return res.json({ success: false, message: '该重置链接已被使用过' });
  }

  // 标记 token 已用
  data.tokens[token].used = true;
  data.tokens[token].usedAt = new Date().toISOString();
  data.tokens[token].usedBy = ip;

  // 清除该 IP 的抽奖记录
  if (data.draws[ip]) {
    delete data.draws[ip];
  }

  writeData(data);
  console.log(`[重置] IP: ${ip} 通过token重置了抽奖状态`);
  res.json({ success: true, message: '重置成功！请刷新页面重新抽取' });
});

// POST /api/admin/clear-all — 清除所有记录（需管理员密码）
app.post('/api/admin/clear-all', requireAdmin, (req, res) => {
  writeData({ draws: {}, tokens: {} });
  console.log('[管理员] 清除所有抽奖记录');
  res.json({ success: true, message: '所有记录已清除' });
});

// GET /api/admin/stats — 查看统计（需管理员密码）
app.get('/api/admin/stats', requireAdmin, (req, res) => {
  const data = readData();
  const drawEntries = Object.entries(data.draws)
    .map(([ip, record]) => ({ ip, ...record }));
  const tokenEntries = Object.entries(data.tokens)
    .map(([token, record]) => ({ token: token.substring(0, 8) + '...', ...record }));

  res.json({
    totalDraws: drawEntries.length,
    totalTokens: tokenEntries.length,
    unusedTokens: tokenEntries.filter(t => !t.used).length,
    draws: drawEntries,
    tokens: tokenEntries,
  });
});

// ==================== FALLBACK: SPA-style ====================
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==================== START ====================
app.listen(PORT, () => {
  console.log(`🎁 神秘礼盒服务已启动: http://localhost:${PORT}`);
  console.log(`📁 数据存储: ${DATA_FILE}`);
});
