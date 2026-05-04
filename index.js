require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const JWT_SECRET = process.env.JWT_SECRET || "trackra_secret";

// ================= HEALTH =================
app.get("/", (req, res) => {
  res.json({ message: "Trackra Secure API Running 🔒" });
});

// ================= AUTH MIDDLEWARE =================
const auth = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: "No token provided" });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid token" });
  }
};

// ================= LOGIN (JWT) =================
app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    const result = await pool.query(
      "SELECT * FROM users WHERE email = $1",
      [email]
    );

    if (!result.rows.length) {
      return res.status(400).json({ error: "User not found" });
    }

    const user = result.rows[0];

    if (user.password !== password) {
      return res.status(400).json({ error: "Invalid password" });
    }

    const token = jwt.sign({ id: user.id }, JWT_SECRET, {
      expiresIn: "7d",
    });

    delete user.password;

    res.json({ user, token });

  } catch (err) {
    res.status(500).json({ error: "Login failed" });
  }
});

// ================= WALLET =================
app.get("/wallets/:user_id", auth, async (req, res) => {
  const { user_id } = req.params;

  try {
    const result = await pool.query(
      "SELECT * FROM wallets WHERE user_id = $1",
      [user_id]
    );

    if (!result.rows.length) {
      return res.json({
        wallets: { main: 0, savings: 0, business: 0 },
      });
    }

    res.json({ wallets: result.rows[0] });

  } catch (err) {
    res.status(500).json({ error: "Wallet error" });
  }
});

// ================= TRANSACTIONS =================
app.get("/transactions/:user_id", auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM transactions 
       WHERE user_id = $1 
       ORDER BY created_at DESC`,
      [req.params.user_id]
    );

    res.json({ transactions: result.rows });

  } catch (err) {
    res.status(500).json({ error: "Failed to fetch transactions" });
  }
});

// ================= INTERNAL TRANSFER (SECURE PIN) =================
app.post("/transfer", auth, async (req, res) => {
  const { user_id, from, to, amount, pin } = req.body;

  try {
    const userRes = await pool.query(
      "SELECT * FROM users WHERE id = $1",
      [user_id]
    );

    const user = userRes.rows[0];

    const validPin = await bcrypt.compare(pin, user.pin);

    if (!validPin) {
      return res.status(401).json({ error: "Invalid PIN" });
    }

    const walletRes = await pool.query(
      "SELECT * FROM wallets WHERE user_id = $1",
      [user_id]
    );

    const wallet = walletRes.rows[0];

    if (wallet[from] < amount) {
      return res.status(400).json({ error: "Insufficient balance" });
    }

    const newFrom = wallet[from] - amount;
    const newTo = wallet[to] + amount;

    await pool.query(
      `UPDATE wallets SET ${from} = $1 WHERE user_id = $2`,
      [newFrom, user_id]
    );

    await pool.query(
      `UPDATE wallets SET ${to} = $1 WHERE user_id = $2`,
      [newTo, user_id]
    );

    await pool.query(
      `INSERT INTO transactions (user_id, type, amount, category, note)
       VALUES ($1, $2, $3, $4, $5)`,
      [user_id, "transfer", amount, "wallet-transfer", `${from} → ${to}`]
    );

    res.json({ message: "Transfer successful" });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================= P2P TRANSFER =================
app.post("/transfer-user", auth, async (req, res) => {
  const { sender_id, receiver_id, amount, pin } = req.body;

  try {
    const senderRes = await pool.query(
      "SELECT * FROM users WHERE id = $1",
      [sender_id]
    );

    const sender = senderRes.rows[0];

    const validPin = await bcrypt.compare(pin, sender.pin);

    if (!validPin) {
      return res.status(401).json({ error: "Invalid PIN" });
    }

    const senderWallet = await pool.query(
      "SELECT * FROM wallets WHERE user_id = $1",
      [sender_id]
    );

    const receiverWallet = await pool.query(
      "SELECT * FROM wallets WHERE user_id = $1",
      [receiver_id]
    );

    if (senderWallet.rows[0].main < amount) {
      return res.status(400).json({ error: "Insufficient balance" });
    }

    const newSender = senderWallet.rows[0].main - amount;
    const newReceiver = receiverWallet.rows[0].main + amount;

    await pool.query(
      "UPDATE wallets SET main = $1 WHERE user_id = $2",
      [newSender, sender_id]
    );

    await pool.query(
      "UPDATE wallets SET main = $1 WHERE user_id = $2",
      [newReceiver, receiver_id]
    );

    await pool.query(
      `INSERT INTO transactions (user_id, type, amount, category, note)
       VALUES ($1, $2, $3, $4, $5)`,
      [sender_id, "transfer", amount, "p2p-out", `Sent to ${receiver_id}`]
    );

    await pool.query(
      `INSERT INTO transactions (user_id, type, amount, category, note)
       VALUES ($1, $2, $3, $4, $5)`,
      [receiver_id, "income", amount, "p2p-in", `Received from ${sender_id}`]
    );

    res.json({ message: "P2P transfer successful" });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================= SERVER =================
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log("Trackra Secure API running on port", PORT);
});
