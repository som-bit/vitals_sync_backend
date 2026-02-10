const express = require('express');
const router = express.Router();
const Habit = require('../models/Habit');
const HabitLog = require('../models/HabitLog');
const jwt = require('jsonwebtoken');

// Middleware to check token
const auth = (req, res, next) => {
  const token = req.header('x-auth-token');
  if (!token) return res.status(401).json({ msg: 'No token, authorization denied' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret_key_123');
    req.user = decoded;
    
    next();
  } catch (e) {
    res.status(400).json({ msg: 'Token is not valid' });
  }
};

// @route   POST /api/sync
// @desc    Sync offline data to cloud
router.post('/', auth, async (req, res) => {
  // Flutter sends { habits: [...], logs: [...] }
  const { habits, logs } = req.body; 
  const userId = req.user.userId;

  try {
    // 1. SYNC HABITS
    if (habits && habits.length > 0) {
      const habitOps = habits.map(h => {
        // Map Flutter's "id" to Mongo's "localId"
        const localId = h.id || h.localId;
        
        return {
          updateOne: {
            filter: { localId: localId, userId: userId },
            update: { 
              ...h, 
              localId: localId, // Ensure localId is set
              userId: userId, 
              lastSyncedAt: new Date() 
            },
            upsert: true
          }
        };
      });
      await Habit.bulkWrite(habitOps);
    }

    // 2. SYNC LOGS
    if (logs && logs.length > 0) {
      const logOps = logs.map(l => {
        // Map Flutter's "id" to "localId"
        // Map Flutter's "habitId" to "habitLocalId"
        const localId = l.id || l.localId;
        const habitLocalId = l.habitId || l.habitLocalId;

        return {
          updateOne: {
            filter: { localId: localId, userId: userId },
            update: { 
              ...l, 
              localId: localId,
              habitLocalId: habitLocalId,
              userId: userId, 
              syncedAt: new Date() 
            },
            upsert: true
          }
        };
      });
      await HabitLog.bulkWrite(logOps);
    }

    console.log(`✅ SYNC: Processed ${habits?.length || 0} habits and ${logs?.length || 0} logs for User ${userId}`);
    
    res.json({ success: true, timestamp: new Date() });

  } catch (err) {
    console.error('❌ SYNC ERROR:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// @route   GET /api/sync
// @desc    Download data (Pull)
router.get('/', auth, async (req, res) => {
  const userId = req.user.userId;
  
  try {
    // Return all active data for the user
    const habits = await Habit.find({ userId, isDeleted: false });
    const logs = await HabitLog.find({ userId, isDeleted: false });

    // Map "localId" back to "id" for Flutter if needed, 
    // but Drift usually handles the mapping if configured correctly.
    // For now, we return raw Mongo objects.
    res.json({ habits, logs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;