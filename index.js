require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();
app.use(cors());
app.use(express.json());

// 🔌 DB CONNECTION
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// =========================
// HOME
// =========================
app.get("/", (req, res) => {
  res.json({ message: "Trackra API Running 🚀" });
});

// =========================
// LOGIN
// =========================
app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await pool.query(
      "SELECT * FROM users WHERE email = $1 AND password = $2",
      [email, password]
    );

    if (user.rows.length === 0) {
      return res.status(400).json({ error: "Invalid login" });
    }

    const safeUser = user.rows[0];
    delete safeUser.password;

    res.json({ user: safeUser });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Login failed" });
  }
});

// =========================
// GET WALLET
// =========================
app.get("/wallets/:user_id", async (req, res) => {
  const { user_id } = req.params;

  try {
    const result = await pool.query(
      "SELECT * FROM wallets WHERE user_id = $1",
      [user_id]
    );

    if (result.rows.length === 0) {
      return res.json({
        wallets: { main: 0, savings: 0, business: 0 }
      });
    }

    res.json({ wallets: result.rows[0] });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Wallet error" });
  }
});

// =========================
// TRANSACTIONS
// =========================
app.get("/transactions/:user_id", async (req, res) => {
  const { user_id } = req.params;

  try {
    const result = await pool.query(
      "SELECT * FROM transactions WHERE user_id = $1 ORDER BY created_at DESC",
      [user_id]
    );

    res.json(result.rows);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Transaction error" });
  }
});

// =========================
// ADD TRANSACTION (FUND WALLET)
// =========================
app.post("/transaction", async (req, res) => {
  const { user_id, type, wallet, amount, category, note } = req.body;

  try {
    await pool.query(
      `INSERT INTO transactions (user_id, type, amount, category, note)
       VALUES ($1, $2, $3, $4, $5)`,
      [user_id, type, amount, category, note]
    );

    const value = type === "income" ? amount : -amount;

    await pool.query(
      `UPDATE wallets
       SET ${wallet} = COALESCE(${wallet}, 0) + $1
       WHERE user_id = $2`,
      [value, user_id]
    );

    res.json({ message: "Transaction added" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Transaction failed", details: err.message });
  }
});

// =========================
// 🔁 FIXED TRANSFER (NO SQL CONFLICT)
// =========================
app.post("/transfer", async (req, res) => {
  const { user_id, from, to, amount } = req.body;

  try {
    const result = await pool.query(
      "SELECT * FROM wallets WHERE user_id = $1",
      [user_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Wallet not found" });
    }

    const wallet = result.rows[0];

    if (wallet[from] < amount) {
      return res.status(400).json({ error: "Insufficient balance" });
    }

    const newFrom = wallet[from] - amount;
    const newTo = wallet[to] + amount;

    // ✅ SAFE: update separately (FIXED BUG)
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

    res.json({
      message: "Transfer successful",
      wallets: {
        ...wallet,
        [from]: newFrom,
        [to]: newTo
      }
    });

  } catch (err) {
    console.error("TRANSFER ERROR:", err.message);
    res.status(500).json({
      error: "Transfer failed",
      details: err.message
    });
  }
});

// =========================
// START SERVER
// =========================
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
