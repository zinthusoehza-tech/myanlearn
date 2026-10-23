const { connectToDatabase } = require('./db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'myanlearn_secret_126805';
const ADMIN_PASSWORD = '126805';

const send = (res, data, status = 200) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.end(JSON.stringify(data));
};

const parseBody = (req) => {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(body)); } 
      catch (e) { resolve({}); }
    });
  });
};

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, { success: true });

  try {
    const db = await connectToDatabase();
    const body = await parseBody(req);
    const { action } = body;

    // --- AUTHENTICATION ---
    if (action === 'register') {
      const { phone, password, name } = body;
      if (!phone || !password) return send(res, { success: false, error: 'Phone and password required' }, 400);
      
      const existing = await db.collection('users').findOne({ phone });
      if (existing) return send(res, { success: false, error: 'Phone number already registered' }, 400);

      const hashedPassword = await bcrypt.hash(password, 10);
      const newUser = {
        phone, password: hashedPassword, name: name || 'User', 
        profileImg: '', coins: 100, isAdmin: false, createdAt: new Date().toISOString()
      };
      
      const result = await db.collection('users').insertOne(newUser);
      const token = jwt.sign({ id: result.insertedId, phone }, JWT_SECRET);
      return send(res, { success: true, token, user: { ...newUser, password: undefined, id: result.insertedId } });
    }

    if (action === 'login') {
      const { phone, password } = body;
      const user = await db.collection('users').findOne({ phone });
      if (!user) return send(res, { success: false, error: 'User not found' }, 401);
      
      const isValid = await bcrypt.compare(password, user.password);
      if (!isValid) return send(res, { success: false, error: 'Invalid password' }, 401);

      const token = jwt.sign({ id: user._id, phone }, JWT_SECRET);
      return send(res, { success: true, token, user: { ...user, password: undefined, id: user._id } });
    }

    if (action === 'adminLogin') {
      if (body.password !== ADMIN_PASSWORD) return send(res, { success: false, error: 'Invalid Admin Password' }, 401);
      const token = jwt.sign({ admin: true }, JWT_SECRET);
      return send(res, { success: true, token, user: { name: 'Admin', isAdmin: true } });
    }

    // --- DATA FETCHING (Bootstrap) ---
    if (action === 'bootstrap') {
      const settings = await db.collection('settings').findOne({ id: 'main' }) || {};
      const subjects = await db.collection('subjects').find({}).toArray();
      const lessons = await db.collection('lessons').find({}).toArray();
      
      let user = null;
      if (body.phone) {
        user = await db.collection('users').findOne({ phone: body.phone });
        if (user) user = { ...user, password: undefined, id: user._id };
      }

      return send(res, { success: true, user, settings, subjects, lessons });
    }

    // --- ADMIN ACTIONS ---
    if (action.startsWith('admin_')) {
      // (Security Check here in production)
      if (action === 'admin_saveSettings') {
        await db.collection('settings').updateOne({ id: 'main' }, { $set: body.settings }, { upsert: true });
        return send(res, { success: true });
      }
      if (action === 'admin_addSubject') {
        await db.collection('subjects').insertOne({ ...body.subject, id: Date.now().toString() });
        return send(res, { success: true });
      }
      if (action === 'admin_addLesson') {
        await db.collection('lessons').insertOne({ ...body.lesson, id: Date.now().toString() });
        return send(res, { success: true });
      }
      if (action === 'admin_getUsers') {
        const users = await db.collection('users').find({}).project({ password: 0 }).toArray();
        return send(res, { success: true, users });
      }
      if (action === 'admin_addCoins') {
        await db.collection('users').updateOne({ phone: body.phone }, { $inc: { coins: body.amount } });
        return send(res, { success: true });
      }
    }

    // --- USER ACTIONS ---
    if (action === 'unlockLesson') {
      const { phone, lessonId, cost } = body;
      const user = await db.collection('users').findOne({ phone });
      if (user.coins < cost) return send(res, { success: false, error: 'Not enough coins' }, 400);
      
      await db.collection('users').updateOne({ phone }, { $inc: { coins: -cost }, $addToSet: { unlockedLessons: lessonId } });
      const updatedUser = await db.collection('users').findOne({ phone });
      return send(res, { success: true, user: { ...updatedUser, password: undefined, id: updatedUser._id } });
    }

    if (action === 'updateProfile') {
      const { phone, name, profileImg } = body;
      await db.collection('users').updateOne({ phone }, { $set: { name, profileImg } });
      const updatedUser = await db.collection('users').findOne({ phone });
      return send(res, { success: true, user: { ...updatedUser, password: undefined, id: updatedUser._id } });
    }

    return send(res, { success: false, error: 'Unknown Action' }, 400);
  } catch (err) {
    console.error(err);
    return send(res, { success: false, error: err.message }, 500);
  }
};