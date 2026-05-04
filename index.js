const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const jwt = require("jsonwebtoken");

const app = express();

app.use(cors());
app.use(express.json());

// ================= DATABASE =================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ================= HEALTH CHECK =================
app.get("/", (req, res) => {
  res.json({ message: "Trackra API Running 🚀" });
});

// ================= LOGIN (FIXED - NO BCRYPT) =================
app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    const result = await pool.query(
      "SELECT * FROM users WHERE email = $1",
      [email]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: "User not found" });
    }

    const user = result.rows[0];

    // ✅ SIMPLE PASSWORD CHECK (FIXED)
    if (user.password !== password) {
      return res.status(401).json({ error: "Invalid password" });
    }

    const token = jwt.sign(
      { id: user.id },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({ user, token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================= WALLET =================
app.get("/wallets/:user_id", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM wallets WHERE user_id = $1",
      [req.params.user_id]
    );

    res.json({ wallets: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================= TRANSACTIONS =================
app.get("/transactions/:user_id", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM transactions WHERE user_id = $1 ORDER BY created_at DESC",
      [req.params.user_id]
    );

    res.json({ transactions: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================= TRANSFER =================
app.post("/transfer", async (req, res) => {
  const { user_id, from, to, amount } = req.body;

  try {
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
      `INSERT INTO transactions (user_id, type, amount, note)
       VALUES ($1, $2, $3, $4)`,
      [user_id, "transfer", amount, `${from} → ${to}`]
    );

    res.json({
      message: "Transfer successful",
      wallets: { ...wallet, [from]: newFrom, [to]: newTo },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================= SERVER =================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Trackra running on port", PORT);
});
